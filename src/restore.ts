import { createDecipheriv, createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { extract } from "tar-stream";
import {
  COMPRESSION_ALG,
  ENCRYPTION_ALG,
  IV_SIZE,
  type CompressionAlgorithm,
  type EncryptionAlgorithm,
} from "./common";

export async function restore({
  source,
  outputDir,
  key,
  encryptionAlgorithm = ENCRYPTION_ALG,
  compressionAlgorithm = COMPRESSION_ALG,
  verifyChecksum = true,
}: {
  source: string;
  outputDir: string;
  key: Buffer;
  encryptionAlgorithm?: EncryptionAlgorithm;
  compressionAlgorithm?: CompressionAlgorithm;
  verifyChecksum?: boolean;
}) {
  const file = Bun.file(source);
  const stream = file.stream();
  const reader = stream.getReader();

  const firstChunk = await reader.read();
  if (firstChunk.done || firstChunk.value.length < IV_SIZE) {
    throw new Error("Backup file is too small to contain IV");
  }

  const iv = Buffer.from(firstChunk.value.slice(0, IV_SIZE));
  const remainingFirstChunk = firstChunk.value.slice(IV_SIZE);

  const encryptedStream = createEncryptedStream(reader, remainingFirstChunk);
  const decryptedStream = encryptedStream.pipeThrough(
    new DecryptionStream(encryptionAlgorithm, key, iv),
  );
  const extractStream = decryptedStream.pipeThrough(new DecompressionStream(compressionAlgorithm));

  await extractFiles(extractStream, outputDir);

  if (verifyChecksum) {
    const backupFileHash = await computeFileHash(source, key);
    await verifyChecksumFile(source, backupFileHash);
  }
}

function createEncryptedStream(
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
  firstChunk: Uint8Array,
): ReadableStream<Uint8Array> {
  let buffer = Buffer.from(firstChunk);
  let done = false;

  return new ReadableStream({
    async pull(controller) {
      if (done) {
        controller.close();
        return;
      }

      if (buffer.length > 0) {
        controller.enqueue(buffer);
        buffer = Buffer.alloc(0);
      }

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) {
          done = true;
          controller.close();
          break;
        }

        if (value && value.length > 0) {
          controller.enqueue(Buffer.from(value));
        }
      }
    },
  });
}

class DecryptionStream extends TransformStream {
  constructor(algorithm: EncryptionAlgorithm, key: Buffer, iv: Buffer) {
    const decipher = createDecipheriv(algorithm, key, iv);

    super({
      transform(chunk, controller) {
        controller.enqueue(decipher.update(chunk));
      },
      flush(controller) {
        controller.enqueue(decipher.final());
      },
    });
  }
}

async function computeFileHash(filePath: string, key: Buffer): Promise<string> {
  if (filePath.startsWith("s3")) {
    throw new Error("Cannot compute hash for S3 files");
  }

  const file = Bun.file(filePath);
  const hmac = createHmac("sha256", key);
  const stream = file.stream();
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      hmac.update(value);
    }
  }

  return hmac.digest("hex");
}

async function verifyChecksumFile(source: string, computedHash: string) {
  const checksumPath = `${source}.sha256`;
  const checksumFile = Bun.file(checksumPath);
  if (!(await checksumFile.exists())) {
    return;
  }

  const expectedHash = (await checksumFile.text()).trim();
  if (computedHash !== expectedHash) {
    throw new Error(`Checksum verification failed. Expected ${expectedHash}, got ${computedHash}`);
  }
}

async function extractFiles(stream: ReadableStream<Uint8Array>, outputDir: string) {
  mkdirSync(outputDir, { recursive: true });

  const nodeStream = Readable.fromWeb(stream);
  const extractStream = extract();

  return new Promise<void>((resolve, reject) => {
    extractStream.on(
      "entry",
      async (header: { name: string }, entryStream: NodeJS.ReadableStream, next: () => void) => {
        const outputPath = join(outputDir, header.name);
        mkdirSync(dirname(outputPath), { recursive: true });

        const writer = Bun.file(outputPath).writer();

        try {
          entryStream.on("data", (chunk: Buffer) => {
            writer.write(chunk);
          });

          entryStream.on("end", async () => {
            await writer.end();
            next();
          });

          entryStream.on("error", async (err: Error) => {
            await writer.end();
            reject(err);
          });
        } catch (err) {
          await writer.end();
          reject(err);
        }
      },
    );

    extractStream.on("finish", () => {
      resolve();
    });

    extractStream.on("error", (err: Error) => {
      reject(err);
    });

    nodeStream.pipe(extractStream);
  });
}
