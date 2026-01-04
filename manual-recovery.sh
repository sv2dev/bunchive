#!/bin/bash
set -e

if [ -f .env ]; then
  source .env
fi

BACKUP_FILE="${1}"
KEY="${2:-$BACKUP_KEY}"
OUTPUT_DIR="${3:-./restored}"

echo KEY: $KEY

if [ -z "$KEY" ]; then
  echo "Error: Encryption key required"
  echo "Usage: $0 <backup-file> <hex-key> [output-dir]"
  exit 1
fi

echo "Extracting IV..."
dd if="$BACKUP_FILE" of=iv.bin bs=1 count=16 2>/dev/null
FILE_SIZE=$(stat -f%z "$BACKUP_FILE")
ENCRYPTED_SIZE=$((FILE_SIZE - 16))
dd if="$BACKUP_FILE" of=encrypted.bin bs=1 skip=16 count=$ENCRYPTED_SIZE 2>/dev/null

echo "Converting key to binary..."
echo -n "$KEY" | xxd -r -p > key.bin

echo "Decrypting..."
openssl enc -d -aes-256-ctr \
  -iv $(xxd -p -c 256 iv.bin | tr -d '\n') \
  -K $(xxd -p -c 256 key.bin | tr -d '\n') \
  -in encrypted.bin \
  -out compressed.tar || {
  echo "Error: OpenSSL decryption failed. Ensure OpenSSL is installed."
  exit 1
}

echo "Decompressing..."
zstd -d compressed.tar -o archive.tar

echo "Extracting archive..."
mkdir -p "$OUTPUT_DIR"
tar -xf archive.tar -C "$OUTPUT_DIR"

if [ -f "${BACKUP_FILE}.sha256" ]; then
  echo "Verifying checksum..."
  COMPUTED_HASH=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
  EXPECTED_HASH=$(cat "${BACKUP_FILE}.sha256" | tr -d '\n')
  if [ "$COMPUTED_HASH" = "$EXPECTED_HASH" ]; then
    echo "Checksum verified: OK"
  else
    echo "Warning: Checksum verification failed!"
    echo "Expected: $EXPECTED_HASH"
    echo "Got:      $COMPUTED_HASH"
  fi
fi

echo "Cleaning up temporary files..."
rm -f iv.bin encrypted.bin key.bin compressed.tar archive.tar

echo "Recovery complete! Files extracted to $OUTPUT_DIR"