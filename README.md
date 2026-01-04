# Backup Tool

A secure backup and restore utility that creates encrypted, compressed archives of files and directories. Supports multiple encryption and compression algorithms, with the ability to write backups to multiple destinations including local storage and S3.

## Features

- **Encryption**: AES-128-CTR, AES-192-CTR, or AES-256-CTR (default: AES-256-CTR)
- **Compression**: zstd, gzip, brotli, or deflate (default: zstd)
- **Checksum verification**: SHA-256 checksums stored alongside backups for integrity verification
- **Multiple destinations**: Write backups to multiple locations simultaneously
- **S3 support**: Direct backup to S3 buckets
- **Glob patterns**: Flexible file matching using glob patterns
- **Scheduled backups**: Run backups automatically on a schedule using cron patterns
- **Sliding backup window**: Automatically keep only the specified number of backups per destination
- **Timestamp formats**: Choose between ISO, Unix timestamp, or no timestamp in backup filenames

## Installation

```bash
bun install
```

## Usage

### Generate an Encryption Key

Generate a new encryption key (32 bytes, hex-encoded):

```bash
bun run bu key
```

Save this key securely - you'll need it to restore backups.

### Create a Backup

Backup files matching glob patterns to one or more destinations:

```bash
# Basic backup with key provided via command line
bun run bu backup -k <hex-key> -d ./backup "src/**/*.ts" "test/**/*.ts"

# Backup to multiple destinations
bun run bu backup -k <hex-key> -d ./backup -d s3://my-bucket/backups "src/**/*"

# Use custom encryption and compression algorithms
bun run bu backup -k <hex-key> -d ./backup -e aes-128-ctr -c gzip "**/*.txt"

# Use different timestamp formats
bun run bu backup -k <hex-key> -d ./backup -t iso "src/**/*.ts"    # ISO format (default)
bun run bu backup -k <hex-key> -d ./backup -t unix "src/**/*.ts"  # Unix timestamp
bun run bu backup -k <hex-key> -d ./backup -t none "src/**/*.ts"  # No timestamp

# Use sliding backup window (keep only last 5 backups)
bun run bu backup -k <hex-key> -d ./backup -n 5 "src/**/*.ts"

# Combine sliding window with custom timestamp format
bun run bu backup -k <hex-key> -d ./backup -t unix -n 10 "src/**/*.ts"

# Use environment variables
export BACKUP_KEY="<hex-key>"
export BACKUP_DESTINATIONS="./backup;s3://my-bucket/backups"
export BACKUP_PATTERNS="src/**/*.ts;test/**/*.ts"
export BACKUP_FORMAT="iso"
export BACKUP_COUNT="5"
bun run bu backup

# Schedule backups using cron pattern
bun run bu backup -k <hex-key> -d ./backup -s "0 2 * * *" "src/**/*.ts"

# Schedule backups with sliding window
bun run bu backup -k <hex-key> -d ./backup -s "0 2 * * *" -n 7 "src/**/*.ts"

# Schedule backups using environment variable
export BACKUP_SCHEDULE="0 2 * * *"
bun run bu backup -k <hex-key> -d ./backup "src/**/*.ts"
```

**Options:**

- `-k, --key`: Encryption key (hex-encoded). Can also use `BACKUP_KEY` environment variable.
- `-d, --destinations`: Target location(s) for backup (can specify multiple times). Can also use `BACKUP_DESTINATIONS` environment variable (semicolon-separated). Defaults to `./backup`.
- `-e, --encryption`: Encryption algorithm (`aes-128-ctr`, `aes-192-ctr`, `aes-256-ctr`). Defaults to `aes-256-ctr`.
- `-c, --compression`: Compression algorithm (`zstd`, `gzip`, `brotli`, `deflate`). Defaults to `zstd`.
- `-t, --timestamp`: Timestamp format for backup filenames (`iso`, `unix`, `none`). Defaults to `iso`. Can also use `BACKUP_FORMAT` environment variable.
- `-n, --count`: Number of backups to keep per destination (sliding window). Requires timestamp format to be enabled (cannot use with `-t none`). Can also use `BACKUP_COUNT` environment variable.
- `-s, --schedule`: Cron pattern for scheduled backups. When provided, the script runs continuously and executes backups on schedule. Can also use `BACKUP_SCHEDULE` environment variable.

**Sources:**

- Provide glob patterns as positional arguments
- Can also use `BACKUP_PATTERNS` environment variable (semicolon-separated)

### Restore a Backup

Restore files from a backup archive:

```bash
# Basic restore
bun run bu restore -k <hex-key> backup/backup_2026-1-3T11-46-21.tar.zstd.crypt

# Restore to custom output directory
bun run bu restore -k <hex-key> -o ./restored backup/backup_2026-1-3T11-46-21.tar.zstd.crypt

# Restore from S3
bun run bu restore -k <hex-key> s3://my-bucket/backups/backup_2026-1-3T11-46-21.tar.zstd.crypt

# Restore backup with Unix timestamp format
bun run bu restore -k <hex-key> backup/backup_1704304150.tar.zstd.crypt

# Restore backup without timestamp
bun run bu restore -k <hex-key> backup/backup.tar.zstd.crypt

# Specify encryption/compression if different from defaults
bun run bu restore -k <hex-key> -e aes-128-ctr -c gzip backup/backup_2026-1-3T11-46-21.tar.gzip.crypt

# Skip checksum verification
bun run bu restore -k <hex-key> --no-verify-checksum backup/backup_2026-1-3T11-46-21.tar.zstd.crypt
```

**Options:**

- `-k, --key`: Encryption key (hex-encoded). Can also use `BACKUP_KEY` environment variable.
- `-o, --output`: Output directory for restored files. Defaults to `./restored`.
- `-e, --encryption`: Encryption algorithm used in the backup. Defaults to `aes-256-ctr`.
- `-c, --compression`: Compression algorithm used in the backup. Defaults to `zstd`.
- `--verify-checksum`: Verify checksum if `.sha256` file exists. Defaults to `true`. Set to `false` to skip verification.

### Scheduled Backups

You can schedule backups to run automatically using cron patterns. When a schedule is provided, the script runs continuously and executes backups according to the cron pattern.

**Cron Pattern Format:**

```
┌──────────────── second (0 - 59) (optional)
│ ┌────────────── minute (0 - 59)
│ │ ┌──────────── hour (0 - 23)
│ │ │ ┌────────── day of month (1 - 31)
│ │ │ │ ┌──────── month (1 - 12)
│ │ │ │ │ ┌────── day of week (0 - 7) (Sunday is 0 or 7)
│ │ │ │ │ │
* * * * * *
```

**Examples:**

```bash
# Run backup every day at 2:00 AM
bun run bu backup -k <hex-key> -d ./backup -s "0 2 * * *" "src/**/*.ts"

# Run backup every hour
bun run bu backup -k <hex-key> -d ./backup -s "0 * * * *" "src/**/*.ts"

# Run backup every Monday at 3:00 AM
bun run bu backup -k <hex-key> -d ./backup -s "0 3 * * 1" "src/**/*.ts"

# Run backup every 30 minutes
bun run bu backup -k <hex-key> -d ./backup -s "*/30 * * * *" "src/**/*.ts"
```

When a schedule is active, the script will run continuously. Press `Ctrl+C` to stop the scheduled backups.

### Sliding Backup Window

The sliding backup window feature automatically keeps only the specified number of backups per destination, deleting older backups. This helps manage disk space while maintaining a history of recent backups.

**Important:** The sliding backup window requires timestamps to be enabled (cannot use with `-t none`). The cleanup happens automatically after each backup is created.

**Examples:**

```bash
# Keep only the last 5 backups
bun run bu backup -k <hex-key> -d ./backup -n 5 "src/**/*.ts"

# Keep last 10 backups with Unix timestamp format
bun run bu backup -k <hex-key> -d ./backup -t unix -n 10 "src/**/*.ts"

# Sliding window works per destination
bun run bu backup -k <hex-key> -d ./backup1 -d ./backup2 -n 5 "src/**/*.ts"
# Each destination (backup1 and backup2) will keep its own 5 backups

# Sliding window with S3 destinations
bun run bu backup -k <hex-key> -d s3://my-bucket/backups -n 7 "src/**/*.ts"
```

The cleanup process:

1. Lists all backup files matching the pattern `backup_*.tar.[compression-alg].crypt` in each destination
2. Sorts them by filename (newest first, based on timestamp in filename)
3. Keeps the first N files (where N is the count specified)
4. Deletes the remaining older backups and their checksum files

**Note:** The sliding window feature works independently for each destination, so if you backup to multiple locations, each will maintain its own set of backups.

## Manual Recovery

In case you need to recover a backup without the tool (e.g., the tool is unavailable), you can manually extract backups using standard command-line tools.

### Backup File Format

The backup file has the following structure:

- **First 16 bytes**: Initialization Vector (IV/nonce) for AES-CTR encryption
- **Remaining bytes**: Encrypted, compressed tar archive

Additionally, a checksum file (`.sha256`) is created alongside each backup file containing the SHA-256 hash of the **backup file itself** (including IV and encrypted data). This allows you to verify the integrity of the backup file without needing to decrypt it.

### Manual Recovery Steps

#### 1. Extract IV

```bash
BACKUP_FILE="backup/backup_2026-1-3T11-46-21.tar.zstd.crypt"
KEY="<your-hex-key>"

# Extract IV (first 16 bytes)
dd if="$BACKUP_FILE" of=iv.bin bs=1 count=16

# Extract encrypted data (everything after first 16 bytes)
FILE_SIZE=$(stat -f%z "$BACKUP_FILE")
ENCRYPTED_SIZE=$((FILE_SIZE - 16))
dd if="$BACKUP_FILE" of=encrypted.bin bs=1 skip=16 count=$ENCRYPTED_SIZE
```

#### 2. Decrypt the Data

Decrypt using OpenSSL:

```bash
# Convert hex key to binary
echo -n "$KEY" | xxd -r -p > key.bin

# Decrypt (AES-256-CTR)
openssl enc -d -aes-256-ctr \
  -iv $(xxd -p -c 256 iv.bin | tr -d '\n') \
  -K $(xxd -p -c 256 key.bin | tr -d '\n') \
  -in encrypted.bin \
  -out compressed.tar
```

**Note:** For AES-128-CTR or AES-192-CTR, replace `aes-256-ctr` with `aes-128-ctr` or `aes-192-ctr` respectively, and adjust key size (16 bytes for AES-128, 24 bytes for AES-192).

#### 3. Decompress the Archive

Decompress based on the compression algorithm used:

**For zstd (default):**

```bash
zstd -d compressed.tar -o archive.tar
```

**For gzip:**

```bash
mv compressed.tar archive.tar.gz
gunzip archive.tar.gz
```

**For brotli:**

```bash
mv compressed.tar compressed.br
brotli -d compressed.br -o archive.tar
```

**For deflate:**

```bash
# Deflate can be decompressed using zlib-flate (part of qpdf package) or other tools
# On macOS with Homebrew: brew install qpdf
zlib-flate -uncompress < compressed.tar > archive.tar

# Alternative: Use openssl zlib (if available)
openssl zlib -d -in compressed.tar -out archive.tar
```

#### 4. Extract the Tar Archive

```bash
mkdir -p restored
tar -xf archive.tar -C restored
```

#### 5. Verify Checksum (Optional)

If a `.sha256` checksum file exists alongside the backup, you can verify the integrity of the backup file:

```bash
# Compute SHA-256 hash of the backup file
sha256sum "${BACKUP_FILE}"

# Compare with the checksum file
cat "${BACKUP_FILE}.sha256"
```

The hashes should match. If they don't, the backup file may be corrupted.

**Note:** The checksum is of the backup file itself (including IV and encrypted data), so you can verify it without decrypting.

### Complete Manual Recovery Script

Here's a complete bash script for manual recovery (assumes zstd compression and AES-256-CTR):
[manual-recovery.sh](./manual-recovery.sh)

## S3 Configuration

When using S3 destinations, configure credentials via environment variables:

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"  # Optional, for AWS S3
export AWS_ENDPOINT="https://s3.us-east-1.amazonaws.com"  # Optional, for S3-compatible services
```

**Note:** For S3-compatible services (like Cloudflare R2, DigitalOcean Spaces, MinIO), you may need to set `AWS_ENDPOINT` to the service's endpoint URL. Bun's S3 API works with any S3-compatible storage service.

## Project Structure

- `src/cli.ts` - Command-line interface
- `src/backup.ts` - Backup functionality
- `src/restore.ts` - Restore functionality
- `src/common.ts` - Shared constants and types
- `src/generateKey.ts` - Key generation utility
- `src/cleanup.ts` - Sliding backup window cleanup functionality

## Development

```bash
# Run tests
bun test

# Build standalone executable
bun run build

# Format code
bun run format
```
