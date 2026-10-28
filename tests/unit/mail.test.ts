import "./_setup";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { buildApprovalMessage, buildOtpMessage, sendApprovalMail, sendOtpMail } from "@/lib/mail";
import { setTestEnv } from "./_setup";

afterEach(() => setTestEnv());

describe("OTP email", () => {
  test("Thai subject contains the code; body states validity and the ignore notice", () => {
    const m = buildOtpMessage("012345");
    assert.equal(m.subject, "รหัสเข้าสู่ระบบ 012345 · ORSKH.APP ตารางห้องผ่าตัด");
    assert.match(m.text, /012345/);
    assert.match(m.text, /10 นาที/);
    assert.match(m.text, /ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร/);
    assert.match(m.html, /012345/);
  });

  test("file transport writes {to, subject, text, code} into EMAIL_OUTBOX_DIR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orskh-outbox-"));
    process.env.EMAIL_TRANSPORT = "file";
    process.env.EMAIL_OUTBOX_DIR = dir;
    await sendOtpMail("doc2@example.com", "654321");
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const msg = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
    assert.equal(msg.to, "doc2@example.com");
    assert.equal(msg.code, "654321");
    assert.match(msg.subject, /654321/);
  });

  test("approval email: Thai subject, approval sentence and the sign-in address", async () => {
    const m = buildApprovalMessage("https://orskh.vercel.app", "สมหญิง ใจดี");
    assert.equal(m.subject, "อนุมัติการเข้าใช้งานแล้ว · ORSKH.APP ตารางห้องผ่าตัด");
    assert.match(m.text, /^เรียน คุณสมหญิง ใจดี\n/);
    assert.match(m.text, /คำขอเข้าใช้งาน ORSKH\.APP ตารางห้องผ่าตัด ของคุณได้รับอนุมัติแล้ว/);
    assert.match(m.text, /เข้าสู่ระบบด้วย LINE ได้ที่ https:\/\/orskh\.vercel\.app\/login/);
    // the LINE account is bound only by the waiting page: whoever closed it is asked for a code again
    assert.match(m.text, /\nระบบอาจขอให้ยืนยันอีเมลนี้ด้วยรหัส 6 หลักอีกครั้ง\n/);
    assert.match(m.html, /ระบบอาจขอให้ยืนยันอีเมลนี้ด้วยรหัส 6 หลักอีกครั้ง/);
    assert.match(m.html, /href="https:\/\/orskh\.vercel\.app\/login"/);
    assert.ok(!buildApprovalMessage("https://x.test", "<b>").html.includes("<b>"), "name is escaped in HTML");

    const dir = mkdtempSync(join(tmpdir(), "orskh-outbox-"));
    process.env.EMAIL_TRANSPORT = "file";
    process.env.EMAIL_OUTBOX_DIR = dir;
    await sendApprovalMail("newcomer@example.com", "สมหญิง ใจดี");
    const msg = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"));
    assert.deepEqual(Object.keys(msg).sort(), ["kind", "subject", "text", "to"]);
    assert.equal(msg.kind, "access_approved");
    assert.match(msg.text, /http:\/\/localhost:3999\/login/);
  });

  test("on Vercel the file transport is refused (SMTP required)", async () => {
    process.env.VERCEL = "1";
    process.env.EMAIL_TRANSPORT = "file";
    process.env.EMAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "orskh-outbox-"));
    delete process.env.SMTP_USER;
    await assert.rejects(sendOtpMail("doc2@example.com", "111111"), /SMTP_USER/);
    assert.equal(readdirSync(process.env.EMAIL_OUTBOX_DIR).length, 0);
  });
});
