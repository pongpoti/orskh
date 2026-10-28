"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/auth-shell";
import { waitText } from "@/lib/format";

type Step = "email" | "code";

export interface ApiResult {
  ok?: boolean;
  error?: string;
  message?: string;
  cooldown?: number;
  retryAfter?: number;
  reason?: string;
  remaining?: number;
  restart?: boolean;
  redirect?: string;
  /** access requests: the request's state and the form field an error refers to */
  status?: string;
  field?: string;
}

export const NETWORK_ERROR = "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";

export async function postJson(url: string, body: unknown): Promise<{ status: number; data: ApiResult }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: ApiResult = {};
  try {
    data = (await res.json()) as ApiResult;
  } catch {
    // keep empty
  }
  return { status: res.status, data };
}

/** Thai (๐-๙) and full-width digits -> ASCII; drops everything else; max 6 digits. */
export function cleanCode(v: string): string {
  return v
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/\D/g, "")
    .slice(0, 6);
}

/** Step counter and heading of a sign-in step. */
export function StepHeading({ step, children }: { step?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      {step ? <p className="text-xs font-semibold text-muted">{step}</p> : null}
      <h2 className="text-lg leading-snug font-bold text-ink">{children}</h2>
    </div>
  );
}

const LABEL = "mb-1.5 block text-sm font-semibold text-ink-2";

export function VerifyForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [locked, setLocked] = useState(false);
  const [restart, setRestart] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  // Set by "เปลี่ยนอีเมล": the button that had focus is removed with the code step, so focus goes to the email field
  // (not on the first render, which must not steal focus).
  const backToEmail = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") {
      codeRef.current?.focus();
    } else if (backToEmail.current) {
      backToEmail.current = false;
      emailRef.current?.focus();
      emailRef.current?.select();
    }
  }, [step]);

  async function sendCode() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await postJson("/api/auth/otp/send", { email });
      if (status === 200 && data.ok) {
        setInfo(data.message ?? null);
        setCooldown(data.cooldown ?? 60);
        setCode("");
        setLocked(false);
        setStep("code");
      } else if (status === 429) {
        // A code may already be on its way: let the user enter it.
        setError(data.error ?? NETWORK_ERROR);
        setCooldown(Math.min(data.retryAfter ?? 60, 24 * 3600));
        setStep("code");
      } else {
        if (data.restart) setRestart(true);
        setError(data.error ?? NETWORK_ERROR);
      }
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (busy || locked || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await postJson("/api/auth/otp/verify", { email, code: value });
      if (status === 200 && data.ok) {
        window.location.assign(data.redirect ?? "/");
        return;
      }
      if (data.restart) setRestart(true);
      if (data.reason === "locked" || data.reason === "expired") setLocked(true);
      setError(data.error ?? NETWORK_ERROR);
      setCode("");
      codeRef.current?.focus();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(raw: string) {
    const v = cleanCode(raw);
    setCode(v);
    if (v.length === 6) void verify(v);
  }

  if (restart) {
    return (
      <div role="alert">
        <Notice tone="warning">{error}</Notice>
        <a className="btn btn-primary mt-4 min-h-12 w-full" href="/login">
          เข้าสู่ระบบด้วย LINE อีกครั้ง
        </a>
      </div>
    );
  }

  if (step === "email") {
    return (
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
        noValidate
      >
        <StepHeading step="ขั้นที่ 1 จาก 2">กรอกอีเมล</StepHeading>
        <p className="text-sm leading-6 text-muted">
          ใช้อีเมลที่ลงทะเบียนไว้กับโรงพยาบาล ระบบจะส่งรหัส 6&nbsp;หลักไปให้
        </p>
        <label className={`${LABEL} mt-4`} htmlFor="email">
          อีเมล
        </label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          className="field field-text"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-describedby={error ? "email-error" : undefined}
        />
        {error ? (
          <div id="email-error" className="mt-3">
            <Notice tone="warning" role="alert">
              {error}
            </Notice>
          </div>
        ) : null}
        <button className="btn btn-primary mt-4 min-h-12 w-full" type="submit" disabled={busy || email.trim().length < 3}>
          {busy ? "กำลังส่ง…" : "ส่งรหัสยืนยัน"}
        </button>
        <p className="mt-4 text-[0.8125rem] leading-5 text-muted">
          อีเมลยังไม่อยู่ในรายชื่อ? ยืนยันรหัสก่อน แล้วส่งคำขอเข้าใช้งานได้ในขั้นถัดไป
        </p>
      </form>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
      noValidate
    >
      <StepHeading step="ขั้นที่ 2 จาก 2">กรอกรหัส 6&nbsp;หลัก</StepHeading>
      {info ? (
        <div className="mb-3" data-testid="otp-info">
          <Notice tone="success" role="status">
            {info}
          </Notice>
        </div>
      ) : null}
      <p className="text-sm leading-6 break-words text-muted">
        ส่งไปที่ <strong className="font-semibold text-ink">{email.trim().toLowerCase()}</strong> รหัสใช้ได้ 10&nbsp;นาที
      </p>
      <label className={`${LABEL} mt-4`} htmlFor="code">
        รหัสยืนยัน
      </label>
      <input
        ref={codeRef}
        id="code"
        name="code"
        className="field field-text min-h-14 text-center text-2xl font-bold tracking-[0.4em] tabular-nums placeholder:tracking-[0.3em]"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        enterKeyHint="done"
        aria-describedby="code-error"
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
        disabled={locked}
        placeholder="••••••"
      />
      <div id="code-error" aria-live="polite">
        {error ? (
          <div className="mt-3" data-testid="otp-error">
            <Notice tone="warning" role="alert">
              {error}
            </Notice>
          </div>
        ) : null}
      </div>
      <button className="btn btn-primary mt-4 min-h-12 w-full" type="submit" disabled={busy || locked || code.length !== 6}>
        {busy ? "กำลังตรวจสอบ…" : "ยืนยันรหัส"}
      </button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
        <button
          type="button"
          className="text-btn -ml-1.5"
          onClick={() => {
            backToEmail.current = true;
            setStep("email");
            setError(null);
            setInfo(null);
          }}
        >
          เปลี่ยนอีเมล
        </button>
        <button
          type="button"
          className="text-btn -mr-1.5"
          onClick={() => void sendCode()}
          disabled={busy || cooldown > 0}
          data-testid="resend"
        >
          {cooldown > 0 ? `ส่งรหัสอีกครั้งได้ใน ${waitText(cooldown)}` : "ส่งรหัสอีกครั้ง"}
        </button>
      </div>
    </form>
  );
}
