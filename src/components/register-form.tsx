"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { registerStaff } from "@/app/register/actions";
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
      className="mt-6 space-y-4"
      action={preview ? undefined : submitRegistration}
      onSubmit={requestConfirm}
    >
      <label className="block text-sm">
        <span className="font-medium">ตำแหน่ง</span>
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
          className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-3 py-2"
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
        <label className="block text-sm">
          <span className="font-medium">ชื่อแพทย์</span>
          <select
            name="physicianId"
            required
            value={physicianId}
            onChange={(event) => {
              setPhysicianId(event.target.value);
              setConfirmedPreview(false);
            }}
            className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-3 py-2"
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
        <p className="rounded-xl bg-floor px-3 py-3 text-sm text-muted">
          ยังไม่มีรายชื่อพยาบาล จึงยังลงทะเบียนตำแหน่งนี้ไม่ได้
        </p>
      ) : null}

      {state?.error ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
          {state.error}
        </p>
      ) : null}

      {confirmedPreview && physician ? (
        <p className="rounded-xl bg-or px-3 py-2 text-sm text-label" role="status">
          ยืนยันชื่อ {physician.name} แล้วในโหมดตัวอย่าง ยังไม่ได้บันทึก
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit || pending}
        className="w-full rounded-full bg-label px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "กำลังบันทึก" : "ลงทะเบียน"}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        className="m-auto w-[min(24rem,calc(100%-2rem))] rounded-3xl border border-ink/10 bg-white p-6 shadow-lg backdrop:bg-ink/40"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          ยืนยันการลงทะเบียน
        </h2>
        <p className="mt-3 text-sm leading-6">
          คุณเลือกชื่อ <span className="font-medium">{physician?.name}</span>
        </p>
        <p className="text-sm leading-6 text-muted">สาขา {physician?.specialty}</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          ชื่อนี้จะผูกกับบัญชี LINE นี้ และครั้งถัดไปจะเข้าใช้งานได้เลย
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
            className="rounded-full border border-ink/15 px-4 py-2 text-sm"
          >
            กลับไปแก้
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            className="rounded-full bg-label px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {pending ? "กำลังบันทึก" : "ยืนยัน"}
          </button>
        </div>
      </dialog>
    </form>
  );
}
