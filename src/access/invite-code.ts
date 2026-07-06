import { createHmac, timingSafeEqual } from "node:crypto";

export function normalizeInviteCode(code: string): string {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

export function hashInviteCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeInviteCode(code)).digest("hex");
}

export function inviteCodeHashMatches(code: string, secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashInviteCode(code, secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
