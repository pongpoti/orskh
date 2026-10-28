"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/auth-shell";
import { NETWORK_ERROR, postJson, type ApiResult } from "../verify/verify-form";

export type PanelView = "form" | "pending" | "approved" | "rejected" | "signin" | "error";
type Field = "firstName" | "lastName" | "position";

const POLL_MS = 10_000;
/** Polling stops after this long; a button resumes it. */
const POLL_FOR_MS = 30 * 60_000;
const EXPIRED = "หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง";

function toView(status: string | undefined): PanelView | null {
  return status === "form" || status === "pending" || status === "approved" || status === "rejected" || status === "signin"
    ? status
    : null;
}

const ICONS = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5l9 15.5H3z" />
      <path d="M12 10v4.2M12 17.2h.01" />
    </>
  ),
} as const;

const TONES = {
  wait: "bg-brand-tint text-brand ring-line-strong",
  ok: "bg-live-tint text-live ring-[rgb(21_127_61/0.25)]",
  bad: "bg-[rgb(253_236_234)] text-[var(--stop)] ring-[rgb(192_57_43/0.22)]",
} as const;

/** A round status icon above a state's heading; the heading says the same in words. */
function StateIcon({ icon, tone }: { icon: keyof typeof ICONS; tone: keyof typeof TONES }) {
  return (
    <div className={`mx-auto mb-3 grid size-14 place-items-center rounded-full ring-1 ${TONES[tone]}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[icon]}
      </svg>
    </div>
  );
}

const H2 = "text-lg leading-snug font-bold text-ink";
const HELP = "mt-2 text-sm leading-6 text-muted";
const NOTE = "mt-3 text-[0.8125rem] leading-5 text-muted";
const LABEL = "mb-1.5 block text-sm font-semibold text-ink-2";

/** Back to the email step (LINE again, then another address), e.g. after verifying a personal address by mistake. */
function OtherEmail() {
  return (
    <a className="text-btn mt-2" href="/api/auth/line/start" data-testid="other-email">
      ใช้อีเมลอื่น
    </a>
  );
}

export function RequestPanel({ initial, email }: { initial: PanelView; email: string }) {
  const [view, setView] = useState<PanelView>(initial);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<Field | null>(null);
  const [paused, setPaused] = useState(false);
  const [restart, setRestart] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef(`${initial}|`);
  const checkNow = useRef(false);

  // Move focus to the new heading when the state changes (not on first render).
  useEffect(() => {
    const key = `${view}|${restart ?? ""}`;
    if (shown.current === key) return;
    shown.current = key;
    headingRef.current?.focus();
  }, [view, restart]);

  // Waiting: ask for the decision every 10 s while the page is visible, for up to 30 min. One loop only, however
  // often the tab is hidden and shown: no check starts while one is in flight, and at most one timer is pending.
  useEffect(() => {
    if (view !== "pending" || paused || restart) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let alive = true;
    async function check() {
      timer = undefined;
      if (!alive || document.hidden || inFlight) return; // hidden: resumed by visibilitychange
      inFlight = true;
      try {
        const res = await fetch("/api/auth/access/status", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as ApiResult;
        if (!alive) return;
        if (res.status === 401) {
          setRestart(data.error ?? EXPIRED);
          return;
        }
        const next = res.ok ? toView(data.status) : null;
        if (next && next !== "pending") {
          setView(next);
          return;
        }
      } catch {
        // offline for a moment: try again on the next tick
      } finally {
        inFlight = false;
      }
      if (alive) later();
    }
    function later() {
      clearTimeout(timer);
      timer = undefined;
      if (Date.now() - started >= POLL_FOR_MS) setPaused(true);
      else timer = setTimeout(check, POLL_MS);
    }
    function onVisibility() {
      // A check in flight schedules the next one itself; otherwise check now that the page is visible again.
      if (document.hidden || inFlight) return;
      clearTimeout(timer);
      timer = undefined;
      void check();
    }
    if (checkNow.current) {
      checkNow.current = false;
      void check();
    } else {
      timer = setTimeout(check, POLL_MS);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [view, paused, restart]);

  // Approved for this LINE account: exchange the access cookie for a session and open the report.
  useEffect(() => {
    if (view !== "approved") return;
    let alive = true;
    (async () => {
      try {
        const { status, data } = await postJson("/api/auth/access/complete", {});
        if (!alive) return;
        if (status === 200 && data.ok) {
          window.location.assign(data.redirect ?? "/");
          return;
        }
        if (status === 401) setRestart(data.error ?? EXPIRED);
        else setError(data.error ?? NETWORK_ERROR);
      } catch {
        if (alive) setError(NETWORK_ERROR);
      }
    })();
    return () => {
      alive = false;
    };
  }, [view, attempt]);

  async function submit() {
    if (busy) return;
    const missing: Field | null = !firstName.trim() ? "firstName" : !lastName.trim() ? "lastName" : !position ? "position" : null;
    if (missing) {
      setErrorField(missing);
      setError(
        missing === "position" ? "กรุณาเลือกตำแหน่ง" : missing === "firstName" ? "กรุณากรอกชื่อ" : "กรุณากรอกนามสกุล",
      );
      document.getElementById(missing)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setErrorField(null);
    try {
      const { status, data } = await postJson("/api/auth/access/request", { firstName, lastName, position });
      const next = toView(data.status);
      if (status === 200 && data.ok && next) {
        setView(next);
      } else if (status === 401) {
        setRestart(data.error ?? EXPIRED);
      } else if (next === "rejected") {
        setView("rejected");
      } else {
        const field = data.field === "firstName" || data.field === "lastName" || data.field === "position" ? data.field : null;
        setErrorField(field);
        setError(data.error ?? NETWORK_ERROR);
        if (field) document.getElementById(field)?.focus();
      }
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const invalid = (f: Field) => (errorField === f ? { "aria-invalid": true, "aria-describedby": "request-error" } : {});

  if (restart) {
    return (
      <div role="alert">
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          หมดเวลา
        </h2>
        <div className="mt-3">
          <Notice tone="warning">{restart}</Notice>
        </div>
        <a className="btn btn-primary mt-4 min-h-12 w-full" href="/login">
          เข้าสู่ระบบด้วย LINE อีกครั้ง
        </a>
      </div>
    );
  }

  if (view === "pending") {
    return (
      <div className="text-center" data-testid="request-pending">
        <StateIcon icon="clock" tone="wait" />
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ
        </h2>
        <p className={HELP}>
          เมื่อได้รับอนุมัติ หน้านี้จะเข้าสู่ระบบให้อัตโนมัติ และระบบจะส่งอีเมลแจ้งไปที่{" "}
          <strong className="font-semibold break-words text-ink">{email}</strong> ด้วย
        </p>
        <p className="mt-4 rounded-xl border border-line bg-white/70 px-3 py-2.5 text-sm text-ink-2" role="status" data-testid="poll-status">
          {paused ? "หยุดตรวจสอบอัตโนมัติแล้ว" : <span className="waiting">กำลังรอการอนุมัติ ตรวจสอบทุก 10&nbsp;วินาที</span>}
        </p>
        {paused && (
          <button
            type="button"
            className="btn btn-secondary mt-3 w-full"
            onClick={() => {
              checkNow.current = true;
              setPaused(false);
            }}
          >
            ตรวจสอบสถานะอีกครั้ง
          </button>
        )}
        <p className={NOTE}>
          ปิดหน้านี้ได้ เมื่อได้รับอีเมลแจ้งอนุมัติ ให้เข้าสู่ระบบด้วย LINE แล้วยืนยันอีเมลด้วยรหัส 6&nbsp;หลักอีกครั้ง
        </p>
        <OtherEmail />
      </div>
    );
  }

  if (view === "approved") {
    return (
      <div className="text-center" data-testid="request-approved">
        <StateIcon icon="check" tone="ok" />
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          ได้รับอนุมัติแล้ว
        </h2>
        {error ? (
          <>
            <div className="mt-3 text-left">
              <Notice tone="warning" role="alert">
                {error}
              </Notice>
            </div>
            <button
              type="button"
              className="btn btn-primary mt-4 min-h-12 w-full"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              ลองอีกครั้ง
            </button>
          </>
        ) : (
          <p className={HELP} role="status">
            <span className="waiting">กำลังเข้าสู่ระบบ…</span>
          </p>
        )}
      </div>
    );
  }

  if (view === "rejected") {
    return (
      <div className="text-center" data-testid="request-rejected">
        <StateIcon icon="alert" tone="bad" />
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          คำขอนี้ไม่ได้รับอนุมัติ
        </h2>
        <p className={HELP}>หากต้องการใช้งาน กรุณาติดต่อผู้ดูแลระบบ</p>
        <p className={NOTE}>ส่งคำขอใหม่จากอีเมลนี้ได้หลังจาก 24&nbsp;ชั่วโมง</p>
        <a className="btn btn-secondary mt-4 w-full" href="/login">
          กลับไปหน้าเข้าสู่ระบบ
        </a>
      </div>
    );
  }

  if (view === "signin") {
    return (
      <div className="text-center" data-testid="request-signin">
        <StateIcon icon="check" tone="ok" />
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          อีเมลนี้ได้รับอนุญาตแล้ว
        </h2>
        <p className={HELP}>กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง แล้วยืนยันอีเมลด้วยรหัส 6&nbsp;หลัก</p>
        <a className="btn btn-primary mt-4 min-h-12 w-full" href="/login">
          เข้าสู่ระบบด้วย LINE
        </a>
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="text-center" role="alert">
        <StateIcon icon="alert" tone="bad" />
        <h2 className={H2}>ระบบยังไม่พร้อม</h2>
        <p className={HELP}>กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแล</p>
        <a className="btn btn-secondary mt-4 w-full" href="/login/request">
          ลองอีกครั้ง
        </a>
      </div>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      data-testid="request-form"
    >
      <h2 className={H2} ref={headingRef} tabIndex={-1}>
        อีเมลนี้ยังไม่อยู่ในรายชื่อ
      </h2>
      <p className={HELP}>กรอกข้อมูลด้านล่างเพื่อส่งคำขอให้ผู้ดูแลอนุมัติ</p>
      <div className="mt-4 grid gap-4">
        <div>
          <label className={LABEL} htmlFor="firstName">
            ชื่อ
          </label>
          <input
            id="firstName"
            name="firstName"
            className="field field-text"
            type="text"
            autoComplete="given-name"
            maxLength={60}
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            {...invalid("firstName")}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="lastName">
            นามสกุล
          </label>
          <input
            id="lastName"
            name="lastName"
            className="field field-text"
            type="text"
            autoComplete="family-name"
            maxLength={60}
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            {...invalid("lastName")}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="position">
            ตำแหน่ง
          </label>
          <select
            id="position"
            name="position"
            className="field"
            required
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            {...invalid("position")}
          >
            <option value="">เลือกตำแหน่ง</option>
            <option value="doctor">แพทย์</option>
            <option value="nurse">พยาบาล</option>
          </select>
        </div>
      </div>
      <div id="request-error" aria-live="polite">
        {error && (
          <div className="mt-4" data-testid="request-error">
            <Notice tone="warning" role="alert">
              {error}
            </Notice>
          </div>
        )}
      </div>
      <button className="btn btn-primary mt-5 min-h-12 w-full" type="submit" disabled={busy}>
        {busy ? "กำลังส่ง…" : "ส่งคำขอ"}
      </button>
      <p className={NOTE}>ผู้ดูแลจะพิจารณาคำขอ เมื่ออนุมัติแล้วระบบจะแจ้งทางอีเมล</p>
      <OtherEmail />
    </form>
  );
}
