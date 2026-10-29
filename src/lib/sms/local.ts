import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SmsConfig } from "../env";
import { CODE_TTL_MIN } from "../otp";

/**
 * Local mode (SMS_PROVIDER=console or file; development and tests only, refused on Vercel by lib/env.ts): the app
 * makes the code itself and "sends" the SMS to the log or to a JSON file {to, text, code, ref, at} in SMS_OUTBOX_DIR.
 */

// No 0/O, 1/I: the reference is read off a phone screen.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A 4-character reference, like the provider's, so the code screen looks the same in every mode. */
export function generateRef(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += REF_ALPHABET[randomInt(0, REF_ALPHABET.length)];
  return s;
}

/** The SMS text: one line, no link (Thai SMS rules), well under 70 Thai characters (one SMS). */
export function otpText(code: string): string {
  return `รหัส ORSKH ของคุณคือ ${code} ใช้ได้ ${CODE_TTL_MIN} นาที ห้ามบอกผู้อื่น`;
}

/** Writes the SMS to the console or the outbox folder. */
export async function deliverLocal(cfg: SmsConfig, sms: { to: string; code: string; ref: string }): Promise<void> {
  const text = otpText(sms.code);
  if (cfg.kind === "file") {
    await mkdir(cfg.outboxDir, { recursive: true });
    const file = join(cfg.outboxDir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`);
    await writeFile(file, JSON.stringify({ to: sms.to, text, code: sms.code, ref: sms.ref, at: new Date().toISOString() }, null, 2));
    return;
  }
  console.info(`[sms:console] to=${sms.to} ref=${sms.ref} text=${text}`);
}
