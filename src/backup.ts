import { Glob } from "bun";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pack } from "tar-stream";
import {
  COMPRESSION_ALG,
  ENCRYPTION_ALG,
  type CompressionAlgorithm,
  type EncryptionAlgorithm,
} from "./common";

export async function backup({
  patterns,
  outputPaths,
  key,
  encryptionAlgorithm = ENCRYPTION_ALG,
  compressionAlgorithm = COMPRESSION_ALG,
}: {
  patterns: string[];
  outputPaths: string[];
  key: Buffer;
  encryptionAlgorithm?: EncryptionAlgorithm;
  compressionAlgorithm?: CompressionAlgorithm;
}) {
  const encryptionStream = new EncryptionStream(encryptionAlgorithm, key);
  const compressedStream = createFileStream(patterns).pipeThrough(
    new CompressionStream(compressionAlgorithm) as ReadableWritablePair<unknown, Uint8Array>,
  );

  const encryptedStream = compressedStream.pipeThrough(encryptionStream.stream);
  const streamWithIv = prependIv(encryptionStream.iv, encryptedStream);

  const { stream: checksumStream, hashPromise } = createChecksumStream();
  const [finalStream, checksumTeeStream] = streamWithIv.tee();

  const sinks = prepareOutputs(outputPaths);
  checksumTeeStream.pipeTo(checksumStream);
  await writeToMultipleSinks(finalStream, sinks);

  const checksum = await hashPromise;
  await writeChecksumFiles(outputPaths, checksum);

  return checksum;
}

function prependIv(iv: Buffer, stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(iv);
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          if (value) {
            controller.enqueue(value);
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

async function writeToMultipleSinks(encryptedStream: ReadableStream<any>, writers: Bun.FileSink[]) {
  const reader = encryptedStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await Promise.allSettled(
      writers.map(async (writer) => {
        writer.write(value);
        await writer.flush();
      }),
    );
  }
  for (const writer of writers) {
    await writer.end();
  }
}

function prepareOutputs(outputPaths: string[]) {
  const sinks = [] as Bun.FileSink[];
  for (const outPath of outputPaths) {
    const out = Bun.file(outPath);
    if (!outPath.startsWith("s3")) {
      mkdirSync(dirname(outPath), { recursive: true });
    }
    sinks.push(out.writer());
  }
  return sinks;
}

function createFileStream(patterns: string[]) {
  const tarPack = pack();
  const nodeStream = Readable.toWeb(tarPack, {
    strategy: { highWaterMark: 64 * 1024 },
  }) as ReadableStream<Uint8Array>;

  (async () => {
    try {
      for await (const path of readFiles(patterns)) {
        const file = Bun.file(path);
        const stats = await file.stat();
        const entry = tarPack.entry(
          {
            name: path,
            size: stats.size,
          },
          (err) => {
            if (err) {
              tarPack.destroy(err);
            }
          },
        );

        const fileStream = file.stream();
        const reader = fileStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            entry.write(Buffer.from(value));
          }
        }
        entry.end();
      }
      tarPack.finalize();
    } catch (error) {
      tarPack.destroy(error as Error);
    }
  })();

  return nodeStream;
}

async function* readFiles(patterns: string[]) {
  for (const pattern of patterns) {
    for await (const path of new Glob(pattern).scan()) {
      yield path;
    }
  }
}

class EncryptionStream {
  iv: Buffer;
  stream: TransformStream;

  constructor(algorithm: EncryptionAlgorithm, key: Buffer, iv: Buffer = randomBytes(16)) {
    this.iv = iv;
    const cipher = createCipheriv(algorithm, key, iv);
    this.stream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(cipher.update(chunk));
      },
      flush(controller) {
        controller.enqueue(cipher.final());
      },
    });
  }
}

function createChecksumStream(): {
  stream: WritableStream<Uint8Array>;
  hashPromise: Promise<string>;
} {
  const hash = createHash("sha256");
  let hashResolve: ((hash: string) => void) | null = null;
  const hashPromise = new Promise<string>((resolve) => {
    hashResolve = resolve;
  });

  const stream = new WritableStream({
    write(chunk) {
      hash.update(chunk);
    },
    close() {
      if (hashResolve) {
        hashResolve(hash.digest("hex"));
      }
    },
  });

  return { stream, hashPromise };
}

async function writeChecksumFiles(outputPaths: string[], checksum: string) {
  for (const outputPath of outputPaths) {
    const checksumPath = `${outputPath}.sha256`;
    await Bun.file(checksumPath).write(checksum + "\n");
  }
}
