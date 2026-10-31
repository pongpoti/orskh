"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/auth-shell";
import { waitText } from "@/lib/format";

type Step = "phone" | "code";

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
  /** sending a code: the number as shown (081-234-5678) and the SMS's reference */
  phone?: string;
  ref?: string;
  /** a refused send: this LINE account has a usable code for the number, so it can still be typed in */
  codePending?: boolean;
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

/**
 * Thai (๐-๙) and full-width digits -> ASCII; keeps only what a phone number is typed with; max 20 characters (after
 * cleaning, so a pasted "+66 (0) 81 234 5678" is never cut short).
 */
export function cleanPhoneInput(v: string): string {
  return v
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[^\d+\- ().]/g, "")
    .slice(0, 20);
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
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  // The number as the server read it (081-234-5678) and the reference printed in the SMS.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  // The digits typed for the last code that was sent: a refused resend for another number must not show the old one.
  const sentDigits = useRef("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // The digits of the number the running countdown was set for: on the number step it holds back only that number.
  const [waitFor, setWaitFor] = useState("");
  // Only an error about the number itself marks the field invalid (not the daily cap or a network error).
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [locked, setLocked] = useState(false);
  const [restart, setRestart] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const resendRef = useRef<HTMLButtonElement>(null);
  const codeErrorRef = useRef<HTMLDivElement>(null);
  // Set by "เปลี่ยนเบอร์": the button that had focus is removed with the code step, so focus goes to the number field
  // (not on the first render, which must not steal focus).
  const backToPhone = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") {
      codeRef.current?.focus();
    } else if (backToPhone.current) {
      backToPhone.current = false;
      phoneRef.current?.focus();
      phoneRef.current?.select();
    }
  }, [step]);

  // A button that becomes disabled while it has focus drops focus to the page, so focus is put back explicitly once
  // React has rendered (the next frame).
  function focusPhone() {
    requestAnimationFrame(() => {
      phoneRef.current?.focus();
      phoneRef.current?.select();
    });
  }
  /** The code field, or the error when the field is locked. */
  function focusCodeStep() {
    requestAnimationFrame(() => {
      const input = codeRef.current;
      if (input && !input.disabled) input.focus();
      else codeErrorRef.current?.focus();
    });
  }

  async function sendCode() {
    if (busy) return;
    const from = step;
    const digitsNow = phone.replace(/\D/g, "");
    setBusy(true);
    setError(null);
    setPhoneInvalid(false);
    try {
      const { status, data } = await postJson("/api/auth/otp/send", { phone });
      if (status === 200 && data.ok) {
        setSentTo(data.phone ?? null);
        setRef(data.ref || null);
        sentDigits.current = digitsNow;
        setCooldown(data.cooldown ?? 60);
        setWaitFor(digitsNow);
        setCode("");
        setLocked(false);
        setStep("code");
        // A resend: the step does not change, so the step effect does not focus the field.
        if (from === "code") focusCodeStep();
        return;
      }
      setError(data.error ?? NETWORK_ERROR);
      if (data.retryAfter) {
        setCooldown(Math.min(data.retryAfter, 24 * 3600));
        setWaitFor(digitsNow);
      }
      if (status === 429 && data.codePending) {
        // A code for this number is still usable: let the user enter it.
        if (sentDigits.current !== digitsNow) {
          setSentTo(null);
          setRef(null);
        }
        if (locked) {
          setLocked(false);
          setCode("");
        }
        setStep("code");
        if (from === "code") focusCodeStep();
        return;
      }
      if (data.restart) setRestart(true);
      setPhoneInvalid(data.field === "phone");
      if (from === "phone") {
        focusPhone();
      } else if (status === 429) {
        // No usable code for this number: asking for one makes no sense, so back to the number with the error.
        backToPhone.current = true;
        setStep("phone");
      } else {
        focusCodeStep();
      }
    } catch {
      setError(NETWORK_ERROR);
      if (from === "phone") focusPhone();
      else focusCodeStep();
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (busy || locked || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await postJson("/api/auth/otp/verify", { phone, code: value });
      if (status === 200 && data.ok) {
        window.location.assign(data.redirect ?? "/");
        return;
      }
      if (data.restart) setRestart(true);
      setError(data.error ?? NETWORK_ERROR);
      // The provider could not be reached: the code still works, keep it for another try.
      if (data.reason !== "unavailable") setCode("");
      if (data.reason === "locked" || data.reason === "expired") {
        // The field is disabled now: focus the way forward (a new code), or the error while the countdown runs.
        setLocked(true);
        requestAnimationFrame(() => {
          const resend = resendRef.current;
          if (resend && !resend.disabled) resend.focus();
          else codeErrorRef.current?.focus();
        });
      } else {
        codeRef.current?.focus();
      }
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

  const phoneDigits = phone.replace(/\D/g, "");
  const digits = phoneDigits.length;
  // A countdown set for this very number (a refused or uncertain send) holds the button back; another number may try.
  const phoneWait = cooldown > 0 && waitFor === phoneDigits ? cooldown : 0;

  if (step === "phone") {
    return (
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
        noValidate
      >
        <StepHeading step="ขั้นที่ 1 จาก 2">กรอกเบอร์มือถือ</StepHeading>
        <p className="text-sm leading-6 text-muted">
          ใช้เบอร์มือถือของคุณเอง ระบบจะส่งรหัส 6&nbsp;หลักทาง SMS ครั้งต่อไปใช้เบอร์เดิม
        </p>
        <label className={`${LABEL} mt-4`} htmlFor="phone">
          เบอร์มือถือ
        </label>
        <input
          ref={phoneRef}
          id="phone"
          name="phone"
          className="field field-text text-lg tracking-wide tabular-nums"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          spellCheck={false}
          required
          maxLength={24}
          value={phone}
          onChange={(e) => {
            setPhone(cleanPhoneInput(e.target.value));
            setPhoneInvalid(false);
          }}
          placeholder="0xx-xxx-xxxx"
          aria-describedby={error ? "phone-error" : undefined}
          aria-invalid={phoneInvalid || undefined}
        />
        {error ? (
          <div id="phone-error" className="mt-3">
            <Notice tone="warning" role="alert">
              {error}
            </Notice>
          </div>
        ) : null}
        <button className="btn btn-primary mt-4 min-h-12 w-full" type="submit" disabled={busy || digits < 9 || phoneWait > 0}>
          {busy ? "กำลังส่ง…" : phoneWait > 0 ? `ส่งรหัสได้ใน ${waitText(phoneWait)}` : "ส่งรหัสทาง SMS"}
        </button>
        <p className="mt-4 text-[0.8125rem] leading-5 text-muted">
          ครั้งแรก ยืนยันรหัสแล้วเลือกชื่อของคุณจากรายชื่อ หากไม่พบชื่อ ส่งคำขอเข้าใช้งานได้
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
      {sentTo ? (
        <div id="otp-info" className="mb-3" data-testid="otp-info">
          <Notice tone="success" role="status">
            ส่งรหัสทาง SMS ไปที่ <strong className="font-semibold whitespace-nowrap tabular-nums">{sentTo}</strong> แล้ว
            {ref ? (
              <>
                {/* The reference gets a line of its own (the notice is too narrow for one line at any width); the
                    separator stays in the text for copying, but is not shown. */}
                <span className="hidden"> · </span>
                <span className="block whitespace-nowrap">
                  รหัสอ้างอิง <strong className="font-semibold tracking-wide" data-testid="otp-ref">{ref}</strong>
                </span>
              </>
            ) : null}
          </Notice>
        </div>
      ) : null}
      <p id="code-help" className="text-sm leading-6 text-muted">
        รหัสใช้ได้ 5&nbsp;นาที{ref ? " ใช้รหัสจาก SMS ที่มีรหัสอ้างอิงตรงกัน" : null}
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
        pattern="[0-9]{6}"
        enterKeyHint="done"
        aria-describedby={[sentTo ? "otp-info" : null, "code-help", "code-error"].filter(Boolean).join(" ")}
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
        disabled={locked}
        placeholder="••••••"
      />
      <div id="code-error" ref={codeErrorRef} tabIndex={-1} className="outline-none" aria-live="polite">
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
            backToPhone.current = true;
            setStep("phone");
            setError(null);
          }}
        >
          เปลี่ยนเบอร์
        </button>
        {/* aria-disabled while busy (sendCode ignores the tap): a disabled button would drop keyboard focus. */}
        <button
          ref={resendRef}
          type="button"
          className="text-btn -mr-1.5"
          onClick={() => void sendCode()}
          disabled={cooldown > 0}
          aria-disabled={busy || undefined}
          data-testid="resend"
        >
          {cooldown > 0 ? `ส่งรหัสอีกครั้งได้ใน ${waitText(cooldown)}` : "ส่งรหัสอีกครั้ง"}
        </button>
      </div>
    </form>
  );
}
