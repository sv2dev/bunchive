export const encryptionAlgorithms = ["aes-128-ctr", "aes-192-ctr", "aes-256-ctr"] as const;
export type EncryptionAlgorithm = (typeof encryptionAlgorithms)[number];

export const compressionAlgorithms = ["zstd", "gzip", "brotli", "deflate"] as const;
export type CompressionAlgorithm = (typeof compressionAlgorithms)[number];

export const timestampFormats = ["iso", "unix", "none"] as const;
export type TimestampFormat = (typeof timestampFormats)[number];

export const COMPRESSION_ALG = (Bun.env.BACKUP_COMPRESSION ?? "zstd") as CompressionAlgorithm;
export const ENCRYPTION_ALG = (Bun.env.BACKUP_ENCRYPTION ?? "aes-256-ctr") as EncryptionAlgorithm;
export const TIMESTAMP_FORMAT = (Bun.env.BACKUP_FORMAT ?? "iso") as TimestampFormat;

if (!encryptionAlgorithms.includes(ENCRYPTION_ALG)) {
  throw new Error(`Invalid encryption algorithm: ${ENCRYPTION_ALG}`);
}
if (!compressionAlgorithms.includes(COMPRESSION_ALG)) {
  throw new Error(`Invalid compression algorithm: ${COMPRESSION_ALG}`);
}
if (!timestampFormats.includes(TIMESTAMP_FORMAT)) {
  throw new Error(`Invalid timestamp format: ${TIMESTAMP_FORMAT}`);
}

export const IV_SIZE = 16;
