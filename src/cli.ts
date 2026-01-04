#!/usr/bin/env bun

import * as cron from "node-cron";
import { parseArgs } from "node:util";
import { backup } from "./backup";
import { cleanupOldBackups } from "./cleanup";
import {
  COMPRESSION_ALG,
  compressionAlgorithms,
  ENCRYPTION_ALG,
  encryptionAlgorithms,
  timestampFormats,
  type CompressionAlgorithm,
  type EncryptionAlgorithm,
  type TimestampFormat,
} from "./common";
import { generateKey } from "./generateKey";
import { restore } from "./restore";

const commands = ["backup", "restore", "key"] as const;
type Command = (typeof commands)[number];

const usage = `\
Usage:
  bunchive backup [options] <...sources>
  bunchive restore [options] <source>
  bunchive key

If used with s3, you need to provide the credentials via environment variables.

commands:
  backup - Backup files from source to destination
    sources: Glob patterns matching files to backup. Can be extended with environment variable BACKUP_PATTERNS.
    options:
      -d, --destinations: A target location for the backup. Can be local or remote.
        Alternatively, you can use the environment variable BACKUP_DESTINATIONS.
      -k, --key: The encryption key to use for the backup. Alternatively you can
        use the environment variable BACKUP_KEY.
      -e, --encryption: The encryption algorithm to use for the backup. Defaults to ${ENCRYPTION_ALG}.
        Allowed values: ${encryptionAlgorithms.join(", ")}.
      -c, --compression: The compression algorithm to use for the backup. Defaults to ${COMPRESSION_ALG}.
        Allowed values: ${compressionAlgorithms.join(", ")}.
      -t, --timestamp: The timestamp format for backup filenames. Defaults to iso.
        Allowed values: ${timestampFormats.join(", ")}.
      -n, --count: Number of backups to keep (sliding window). Requires timestamp format to be enabled.
        Can also use the environment variable BACKUP_COUNT.
      -s, --schedule: Cron pattern for scheduled backups. When provided, the script runs continuously
        and executes backups on schedule. Alternatively, you can use the environment variable BACKUP_SCHEDULE.
      --no-checksum: Disable checksum generation. Can also use the environment variable BACKUP_CHECKSUM=false.
      -C, --cwd: Change working directory before processing globs. Globs and file paths in the tar archive will be
        relative to this directory. Alternatively, you can use the environment variable BACKUP_CWD.
      -v, --verbose: Enable verbose debug logging. Logs files and their sizes as they are added to the backup.
        Alternatively, you can use the environment variable BACKUP_VERBOSE=true.
  restore - Restore files from previously backed up archive
    source: The source archive file. Can be local or remote.
    options:
      -o, --output: The output directory for the restored files. Defaults to ./restored
      -k, --key: The encryption key to use for the backup. Alternatively you can
        use the environment variable BACKUP_KEY.
      -e, --encryption: The encryption algorithm used in the backup. Defaults to ${ENCRYPTION_ALG}.
        Allowed values: ${encryptionAlgorithms.join(", ")}.
      -c, --compression: The compression algorithm used in the backup. Defaults to ${COMPRESSION_ALG}.
        Allowed values: ${compressionAlgorithms.join(", ")}.
      --verify-checksum: Verify checksum if .sha256 file exists. Defaults to true.
        Set to false to skip checksum verification.
  key - Generate a new encryption key\
`;

const { cmd, args, opts } = getArgs();

switch (cmd) {
  case "backup": {
    if (!opts.key) throw new Error("No key provided");
    const patterns = [...args, ...(process.env.BACKUP_PATTERNS?.split(";") || [])];
    if (patterns.length === 0) throw new Error("No sources provided");
    const key = Buffer.from(opts.key, "hex");
    const encryptionAlgorithm = opts.encryption as EncryptionAlgorithm | undefined;
    const compressionAlgorithm =
      (opts.compression as CompressionAlgorithm | undefined) ?? COMPRESSION_ALG;
    const timestampFormat = (opts.timestamp as TimestampFormat | undefined) ?? "iso";
    const backupCount = opts.count ? parseInt(opts.count as string, 10) : undefined;

    if (backupCount !== undefined && timestampFormat === "none") {
      throw new Error(
        "Sliding backup window requires timestamp format to be enabled (cannot use --count with --timestamp none)",
      );
    }

    const executeBackup = async () => {
      const filename = createBackupFilename(timestampFormat, compressionAlgorithm);
      const outputPaths = opts.destinations.map((dest) => {
        if (dest.startsWith("s3://")) {
          const separator = dest.endsWith("/") ? "" : "/";
          return `${dest}${separator}${filename}`;
        }
        const separator = dest.endsWith("/") ? "" : "/";
        return `${dest}${separator}${filename}`;
      });
      const generateChecksum = opts.checksum !== false;
      const cwd = opts.cwd as string | undefined;
      const verbose = opts.verbose === true;
      const startTime = Date.now();
      const { checksum, bytesWritten } = await backup({
        patterns,
        outputPaths,
        key,
        encryptionAlgorithm,
        compressionAlgorithm,
        generateChecksum,
        cwd,
        verbose,
      });
      console.log(`Backup completed (${bytesWritten}B, ${(Date.now() - startTime) / 1000}s)`);
      if (checksum && verbose) {
        console.log(`Checksum: ${checksum}`);
      }

      if (backupCount !== undefined) {
        for (const destination of opts.destinations) {
          await cleanupOldBackups({
            destination,
            count: backupCount,
            timestampFormat,
            compressionAlgorithm,
          });
        }
      }
    };

    if (opts.schedule) {
      if (!cron.validate(opts.schedule)) {
        throw new Error(`Invalid cron pattern: ${opts.schedule}`);
      }
      cron.schedule(opts.schedule, executeBackup);
      console.log(`Backup scheduled: ${opts.schedule}`);
      console.log("Backup will run according to the schedule. Press Ctrl+C to stop.");
    } else {
      await executeBackup();
    }
    break;
  }
  case "restore": {
    if (!opts.key) throw new Error("No key provided");
    const source = args[0];
    if (!source) throw new Error("No source file provided");
    const outputDir = opts.output as string;
    const key = Buffer.from(opts.key, "hex");
    const encryptionAlgorithm = opts.encryption as EncryptionAlgorithm | undefined;
    const compressionAlgorithm = opts.compression as CompressionAlgorithm | undefined;
    const verifyChecksum = opts.verifyChecksum !== false;
    await restore({
      source,
      outputDir,
      key,
      encryptionAlgorithm,
      compressionAlgorithm,
      verifyChecksum,
    });
    console.log("Restore completed");
    break;
  }
  case "key":
    console.log(generateKey().toString("hex"));
    break;
}

function createTimestamp(format: TimestampFormat): string {
  if (format === "none") return "";
  if (format === "unix") return Math.floor(Date.now() / 1000).toString();
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(
      2,
      "0",
    )}-${d.getDate().toString().padStart(2, "0")}T${d.getHours().toString().padStart(2, "0")}-${d.getMinutes().toString().padStart(2, "0")}-${d.getSeconds().toString().padStart(2, "0")}`;
}

function createBackupFilename(
  timestampFormat: TimestampFormat,
  compressionAlgorithm: CompressionAlgorithm,
): string {
  const timestamp = createTimestamp(timestampFormat);
  if (timestampFormat === "none") {
    return `backup.tar.${compressionAlgorithm}.crypt`;
  }
  return `backup_${timestamp}.tar.${compressionAlgorithm}.crypt`;
}

export function getArgs() {
  try {
    const {
      values: { help, ...opts },
      positionals: [cmd, ...args],
    } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        help: {
          type: "boolean",
          short: "h",
          default: false,
        },
        destinations: {
          type: "string",
          short: "d",
          multiple: true,
          default: process.env.BACKUP_DESTINATIONS?.split(";") ?? ["./backup"],
        },
        key: {
          type: "string",
          short: "k",
          default: process.env.BACKUP_KEY,
        },
        output: {
          type: "string",
          short: "o",
          default: process.env.BACKUP_OUTPUT ?? "./restored",
        },
        encryption: {
          type: "string",
          short: "e",
          default: process.env.BACKUP_ENCRYPTION,
        },
        compression: {
          type: "string",
          short: "c",
          default: process.env.BACKUP_COMPRESSION,
        },
        timestamp: {
          type: "string",
          short: "t",
          default: process.env.BACKUP_FORMAT,
        },
        count: {
          type: "string",
          short: "n",
          default: process.env.BACKUP_COUNT,
        },
        checksum: {
          type: "boolean",
          default: process.env.BACKUP_CHECKSUM !== "false",
        },
        verifyChecksum: {
          type: "boolean",
          default: process.env.BACKUP_VERIFY_CHECKSUM !== "false",
        },
        schedule: {
          type: "string",
          short: "s",
          default: process.env.BACKUP_SCHEDULE,
        },
        cwd: {
          type: "string",
          default: process.env.BACKUP_CWD,
          short: "C",
        },
        verbose: {
          type: "boolean",
          short: "v",
          default: process.env.BACKUP_VERBOSE === "true",
        },
      },
      strict: true,
      allowPositionals: true,
    });
    if (help) {
      console.log(usage);
      process.exit(0);
    }
    if (!cmd || !commands.includes(cmd as Command)) {
      console.error(`Unknown command: ${cmd}`);
      console.log(usage);
      process.exit(1);
    }
    return { cmd: cmd as Command, opts, args };
  } catch (error) {
    console.error(error);
    console.log(usage);
    process.exit(1);
  }
}
