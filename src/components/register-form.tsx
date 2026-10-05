"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { registerStaff } from "@/app/register/actions";
import { Notice } from "@/components/auth-shell";
import { JOBS, PHYSICIAN_GROUPS, getPhysician, type JobId } from "@/lib/physicians";

export function RegisterForm({ preview = false }: { preview?: boolean }) {
  const [job, setJob] = useState<JobId | "">("");
  const [physicianId, setPhysicianId] = useState("");
  const [confirmedPreview, setConfirmedPreview] = useState(false);
  const [state, submitRegistration, pending] = useActionState(registerStaff, null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const physician = useMemo(() => getPhysician(physicianId), [physicianId]);
  const canSubmit = job === "physician" && physician !== null;

  useEffect(() => {
    if (state?.error) dialogRef.current?.close();
  }, [state]);

  function requestConfirm(event: React.FormEvent<HTMLFormElement>) {
    if (!confirmedRef.current) {
      event.preventDefault();
      if (!canSubmit) return;
      dialogRef.current?.showModal();
      return;
    }
    confirmedRef.current = false;
    if (preview) {
      event.preventDefault();
      dialogRef.current?.close();
      setConfirmedPreview(true);
    }
  }

  function confirm() {
    confirmedRef.current = true;
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      className="mt-5 space-y-5"
      action={preview ? undefined : submitRegistration}
      onSubmit={requestConfirm}
    >
      <label className="block">
        <span className="text-sm font-semibold text-ink">ตำแหน่ง</span>
        <select
          name="job"
          required
          value={job}
          onChange={(event) => {
            const next = event.target.value as JobId | "";
            setJob(next);
            if (next !== "physician") setPhysicianId("");
            setConfirmedPreview(false);
          }}
          className="field mt-1.5"
        >
          <option value="">เลือกตำแหน่ง</option>
          {JOBS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      {job === "physician" ? (
        <label className="block">
          <span className="text-sm font-semibold text-ink">ชื่อแพทย์</span>
          <select
            name="physicianId"
            required
            value={physicianId}
            onChange={(event) => {
              setPhysicianId(event.target.value);
              setConfirmedPreview(false);
            }}
            className="field mt-1.5"
          >
            <option value="">เลือกชื่อ</option>
            {PHYSICIAN_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.names.map((name, index) => (
                  <option key={`${group.id}-${index + 1}`} value={`${group.id}-${index + 1}`}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}

      {job === "nurse" ? (
        <Notice tone="info">ยังไม่มีรายชื่อพยาบาล จึงยังลงทะเบียนตำแหน่งนี้ไม่ได้</Notice>
      ) : null}

      {state?.error ? (
        <Notice tone="warning" role="alert">
          {state.error}
        </Notice>
      ) : null}

      {confirmedPreview && physician ? (
        <Notice tone="success" role="status">
          ยืนยันชื่อ {physician.name} แล้วในโหมดตัวอย่าง ยังไม่ได้บันทึก
        </Notice>
      ) : null}

      <button type="submit" disabled={!canSubmit || pending} className="btn btn-primary w-full">
        {pending ? "กำลังบันทึก" : "ลงทะเบียน"}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        className="m-auto w-[min(26rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-6 text-ink shadow-[0_24px_60px_rgb(20_38_44/0.28)] backdrop:bg-ink/55"
      >
        <h2 id="confirm-title" className="text-lg font-bold">
          ยืนยันการลงทะเบียน
        </h2>
        <dl className="mt-4 space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <div>
            <dt className="text-muted">ชื่อที่เลือก</dt>
            <dd className="mt-0.5 font-semibold text-ink">{physician?.name}</dd>
          </div>
          <div>
            <dt className="text-muted">สาขา</dt>
            <dd className="mt-0.5 font-semibold text-ink">{physician?.specialty}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-6 text-muted">
          ชื่อนี้จะผูกกับบัญชี LINE นี้ และครั้งถัดไปจะเข้าใช้งานได้เลย
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
            className="btn btn-secondary"
          >
            กลับไปแก้
          </button>
          <button type="button" disabled={pending} onClick={confirm} className="btn btn-primary">
            {pending ? "กำลังบันทึก" : "ยืนยัน"}
          </button>
        </div>
      </dialog>
    </form>
  );
}
