import { randomBytes } from "node:crypto";

export function generateKey(): Buffer {
  return randomBytes(32); // 32 bytes = 256 bits
}
