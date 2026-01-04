import { afterEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { backup } from "./backup";
import { COMPRESSION_ALG, ENCRYPTION_ALG } from "./common";
import { generateKey } from "./generateKey";
import { restore } from "./restore";

describe("backup and restore", () => {
  afterEach(async () => {
    await rm("test/.tmp", { recursive: true });
  });

  it("should backup and restore files", async () => {
    const patterns = ["test/a.*", "test/b.txt"];
    const outputPaths = ["test/.tmp/backup1", "test/.tmp/backup2"];
    const key = generateKey();

    await backup({ patterns, outputPaths, key });
    await restore({
      source: outputPaths[0]!,
      outputDir: "test/.tmp/restore",
      key,
      encryptionAlgorithm: ENCRYPTION_ALG,
      compressionAlgorithm: COMPRESSION_ALG,
    });

    expect(await Bun.file("test/.tmp/restore/test/a.txt").text()).toBe("b");
    expect(await Bun.file("test/.tmp/restore/test/b.txt").text()).toBe("a");
  });
});
