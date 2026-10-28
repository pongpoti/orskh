import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { appUrl, mailConfig, type MailConfig } from "./env";
import { CODE_TTL_MIN } from "./otp";

export interface MailMessage {
  subject: string;
  text: string;
  html: string;
}

// Colours of the board (brown primary on a warm canvas), inline because mail clients drop stylesheets.
const BODY_STYLE =
  "margin:0;padding:24px;background:#faf5ee;font-family:'Noto Sans Thai Looped','Noto Sans Thai',Tahoma,sans-serif;color:#241c16";
const CARD_STYLE = "max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e9e0d5;border-radius:14px;padding:24px";

export function buildOtpMessage(code: string): MailMessage {
  const subject = `รหัสเข้าสู่ระบบ ${code} · ORSKH.APP ตารางห้องผ่าตัด`;
  const text = [
    "รหัสเข้าสู่ระบบ ORSKH.APP ตารางห้องผ่าตัด",
    "",
    `รหัสของคุณคือ ${code}`,
    `รหัสนี้ใช้ได้ ${CODE_TTL_MIN} นาที และใช้ได้ครั้งเดียว`,
    "",
    "ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร",
  ].join("\n");
  const html = `<!doctype html><html lang="th"><body style="${BODY_STYLE}">
<div style="${CARD_STYLE}">
<p style="margin:0 0 12px;font-size:15px">รหัสเข้าสู่ระบบ ORSKH.APP ตารางห้องผ่าตัด</p>
<p style="margin:0 0 12px;font-size:32px;font-weight:700;letter-spacing:6px;color:#3f2f24">${code}</p>
<p style="margin:0 0 16px;font-size:14px;color:#4a3b30">รหัสนี้ใช้ได้ ${CODE_TTL_MIN} นาที และใช้ได้ครั้งเดียว</p>
<p style="margin:0;font-size:13px;color:#5f5045">ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร</p>
</div></body></html>`;
  return { subject, text, html };
}

let smtp: { key: string; t: Transporter } | null = null;

function smtpTransport(cfg: MailConfig): Transporter {
  const key = `${cfg.host}|${cfg.port}|${cfg.user}`;
  if (!smtp || smtp.key !== key) {
    smtp = {
      key,
      t: nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        requireTLS: cfg.port !== 465,
        auth: { user: cfg.user, pass: cfg.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    };
  }
  return smtp.t;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Sent when an administrator approves an access request. `name` was validated (letters, spaces, . - ' only).
 * Only the waiting page binds the LINE account, so someone who closed it confirms the email with a code once more.
 */
export function buildApprovalMessage(origin: string, name: string): MailMessage {
  const login = `${origin}/login`;
  const subject = "อนุมัติการเข้าใช้งานแล้ว · ORSKH.APP ตารางห้องผ่าตัด";
  const text = [
    `เรียน คุณ${name}`,
    "",
    "คำขอเข้าใช้งาน ORSKH.APP ตารางห้องผ่าตัด ของคุณได้รับอนุมัติแล้ว",
    `เข้าสู่ระบบด้วย LINE ได้ที่ ${login}`,
    "ระบบอาจขอให้ยืนยันอีเมลนี้ด้วยรหัส 6 หลักอีกครั้ง",
    "",
    "ถ้าคุณไม่ได้ส่งคำขอนี้ กรุณาแจ้งผู้ดูแลระบบ",
  ].join("\n");
  const html = `<!doctype html><html lang="th"><body style="${BODY_STYLE}">
<div style="${CARD_STYLE}">
<p style="margin:0 0 12px;font-size:15px">เรียน คุณ${escapeHtml(name)}</p>
<p style="margin:0 0 16px;font-size:15px">คำขอเข้าใช้งาน ORSKH.APP ตารางห้องผ่าตัด ของคุณ<strong style="color:#126b34">ได้รับอนุมัติแล้ว</strong></p>
<p style="margin:0 0 16px"><a href="${escapeHtml(login)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#3f2f24;color:#ffffff;font-weight:700;text-decoration:none">เข้าสู่ระบบด้วย LINE</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#4a3b30;word-break:break-all">${escapeHtml(login)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#4a3b30">ระบบอาจขอให้ยืนยันอีเมลนี้ด้วยรหัส 6 หลักอีกครั้ง</p>
<p style="margin:0;font-size:13px;color:#5f5045">ถ้าคุณไม่ได้ส่งคำขอนี้ กรุณาแจ้งผู้ดูแลระบบ</p>
</div></body></html>`;
  return { subject, text, html };
}

/**
 * Sends a message. On Vercel only SMTP is possible (lib/env.ts ignores EMAIL_TRANSPORT there).
 * The "file" and "console" transports are for local development and tests only; `extra` goes into the file.
 */
async function deliver(to: string, msg: MailMessage, extra: Record<string, string>): Promise<void> {
  const cfg = mailConfig();
  if (cfg.kind === "file") {
    await mkdir(cfg.outboxDir, { recursive: true });
    const file = join(cfg.outboxDir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`);
    await writeFile(file, JSON.stringify({ to, subject: msg.subject, text: msg.text, ...extra }, null, 2));
    return;
  }
  if (cfg.kind === "console") {
    console.info(`[mail:console] to=${to} subject=${msg.subject}`);
    return;
  }
  await smtpTransport(cfg).sendMail({ from: cfg.from, to, subject: msg.subject, text: msg.text, html: msg.html });
}

/** Sends the one-time code. */
export async function sendOtpMail(to: string, code: string): Promise<void> {
  await deliver(to, buildOtpMessage(code), { code });
}

/** Tells the requester that access was approved and where to sign in. */
export async function sendApprovalMail(to: string, name: string): Promise<void> {
  await deliver(to, buildApprovalMessage(appUrl().origin, name), { kind: "access_approved" });
}
