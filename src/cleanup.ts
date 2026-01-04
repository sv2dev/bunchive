import { S3Client } from "bun";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { CompressionAlgorithm, TimestampFormat } from "./common";

export async function cleanupOldBackups(
  destination: string,
  count: number,
  timestampFormat: TimestampFormat,
  compressionAlgorithm: CompressionAlgorithm,
) {
  if (timestampFormat === "none") {
    throw new Error("Sliding backup window requires timestamp format to be enabled");
  }

  const backupPattern = `backup_*.tar.${compressionAlgorithm}.crypt`;

  if (destination.startsWith("s3://")) {
    await cleanupS3Backups(destination, count, backupPattern);
  } else {
    await cleanupLocalBackups(destination, count, backupPattern);
  }
}

async function cleanupLocalBackups(destination: string, count: number, backupPattern: string) {
  const files = await readdir(destination);
  const backupFiles = files.filter((file) => {
    const patternRegex = backupPattern.replace(/\*/g, ".*");
    return new RegExp(`^${patternRegex}$`).test(file);
  });

  if (backupFiles.length <= count) {
    return;
  }

  backupFiles.sort((a, b) => {
    const timestampA = extractTimestamp(a);
    const timestampB = extractTimestamp(b);
    if (!timestampA || !timestampB) return 0;
    return timestampB.localeCompare(timestampA);
  });

  const filesToDelete = backupFiles.slice(count);
  for (const file of filesToDelete) {
    const filePath = join(destination, file);
    const checksumPath = join(destination, `${file}.sha256`);
    await unlink(filePath).catch(() => {});
    await unlink(checksumPath).catch(() => {});
  }
}

async function cleanupS3Backups(destination: string, count: number, backupPattern: string) {
  const { bucket, prefix } = parseS3Url(destination);

  const listPrefix = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const listResult = await S3Client.list({ prefix: listPrefix }, { bucket });

  if (!listResult.contents) {
    return;
  }

  const backupFiles = listResult.contents
    .map((obj) => obj.key)
    .filter((key) => {
      const filename = key.split("/").pop() || "";
      const patternRegex = backupPattern.replace(/\*/g, ".*");
      return new RegExp(`^${patternRegex}$`).test(filename);
    });

  if (backupFiles.length <= count) {
    return;
  }

  backupFiles.sort((a, b) => {
    const filenameA = a.split("/").pop() || "";
    const filenameB = b.split("/").pop() || "";
    const timestampA = extractTimestamp(filenameA);
    const timestampB = extractTimestamp(filenameB);
    if (!timestampA || !timestampB) return 0;
    return timestampB.localeCompare(timestampA);
  });

  const filesToDelete = backupFiles.slice(count);
  for (const fileKey of filesToDelete) {
    const checksumKey = `${fileKey}.sha256`;
    await S3Client.delete(fileKey, { bucket }).catch(() => {});
    await S3Client.delete(checksumKey, { bucket }).catch(() => {});
  }
}

function parseS3Url(url: string): { bucket: string; prefix: string } {
  const match = url.match(/^s3:\/\/([^\/]+)(?:\/(.+))?$/);
  if (!match) {
    throw new Error(`Invalid S3 URL: ${url}`);
  }
  return {
    bucket: match[1]!,
    prefix: match[2] || "",
  };
}

function extractTimestamp(filename: string): string | null {
  const match = filename.match(/^backup_(.+?)\.tar\./);
  return match ? match[1]! : null;
}
