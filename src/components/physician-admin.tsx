"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/auth-shell";
import { SPECIALTIES, SPECIALTY_CODES, isSpecialtyCode, specialtyOf, type SpecialtyCode } from "@/lib/specialties";

export type AdminPhysician = { id: string; name: string; specialty: SpecialtyCode };

const ORDER = new Map<string, number>(SPECIALTY_CODES.map((code, index) => [code, index]));

function sorted(list: readonly AdminPhysician[]): AdminPhysician[] {
  return [...list].sort(
    (a, b) => (ORDER.get(a.specialty) ?? 99) - (ORDER.get(b.specialty) ?? 99) || a.name.localeCompare(b.name, "th"),
  );
}

/** Thai names are compared without the spaces people type inconsistently. */
function normalise(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

const icon = {
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.2-4.2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 19l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />,
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof icon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon[name]}
    </svg>
  );
}

/** The specialty code on its department colour; `small` sits inline in a line of text. */
function SpecialtyChip({ code, small = false, className = "" }: { code: string; small?: boolean; className?: string }) {
  const specialty = specialtyOf(code);
  return (
    <span
      className={`chip shrink-0 justify-center tracking-[0.02em] ${small ? "min-h-0 px-2 py-0 text-[0.6875rem] leading-5" : "w-[5.75rem] px-2 text-xs"} ${className}`}
      style={{ "--chip": specialty?.color, color: specialty?.text } as React.CSSProperties}
    >
      {specialty?.label ?? code}
    </span>
  );
}

const DIALOG =
  "m-auto w-[min(28rem,calc(100%-2rem))] rounded-[18px] border border-line bg-surface p-6 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px]";

/**
 * The admin's physician list: search, filter by specialty, and add, edit or delete a physician.
 * Changes are kept in this page's state; saving to the database comes with the admin route.
 */
export function PhysicianAdmin({ initial }: { initial: readonly AdminPhysician[] }) {
  const [people, setPeople] = useState<AdminPhysician[]>(() => sorted(initial));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SpecialtyCode | "">("");
  const [editing, setEditing] = useState<AdminPhysician | null>(null);
  const [removing, setRemoving] = useState<AdminPhysician | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSpecialty, setDraftSpecialty] = useState<SpecialtyCode | "">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const editRef = useRef<HTMLDialogElement>(null);
  const removeRef = useRef<HTMLDialogElement>(null);
  const nextId = useRef(initial.length + 1);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of people) map.set(person.specialty, (map.get(person.specialty) ?? 0) + 1);
    return map;
  }, [people]);

  const shown = useMemo(() => {
    const needle = normalise(query);
    return people.filter((person) => (!filter || person.specialty === filter) && (!needle || person.name.includes(needle)));
  }, [people, query, filter]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(""), 4000);
    return () => clearTimeout(timer);
  }, [done]);

  function openEditor(person: AdminPhysician | null) {
    setEditing(person);
    setDraftName(person?.name ?? "");
    setDraftSpecialty(person?.specialty ?? filter);
    setError("");
    editRef.current?.showModal();
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = normalise(draftName);
    if (!name) return setError("กรุณากรอกชื่อ-นามสกุล");
    if (!isSpecialtyCode(draftSpecialty)) return setError("กรุณาเลือกสาขา");
    if (people.some((person) => person.name === name && person.id !== editing?.id)) {
      return setError("มีชื่อนี้ในรายชื่อแล้ว");
    }
    if (editing) {
      setPeople((list) => sorted(list.map((person) => (person.id === editing.id ? { ...person, name, specialty: draftSpecialty } : person))));
      setDone(`บันทึกการแก้ไข ${name} แล้ว`);
    } else {
      setPeople((list) => sorted([...list, { id: `new-${nextId.current++}`, name, specialty: draftSpecialty }]));
      setDone(`เพิ่ม ${name} แล้ว`);
    }
    editRef.current?.close();
  }

  function openRemove(person: AdminPhysician) {
    setRemoving(person);
    removeRef.current?.showModal();
  }

  function remove() {
    if (!removing) return;
    setPeople((list) => list.filter((person) => person.id !== removing.id));
    setDone(`ลบ ${removing.name} แล้ว`);
    removeRef.current?.close();
  }

  const removingSpecialty = removing ? specialtyOf(removing.specialty) : null;

  return (
    <section className="card overflow-hidden" aria-labelledby="physician-list-title">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="physician-list-title" className="text-base font-bold text-ink sm:text-lg">
              รายชื่อแพทย์
            </h2>
            <p className="text-sm text-muted">
              {shown.length === people.length ? `ทั้งหมด ${people.length} คน` : `แสดง ${shown.length} จาก ${people.length} คน`}
            </p>
          </div>
          <button type="button" onClick={() => openEditor(null)} className="btn btn-primary shrink-0 px-4">
            <Icon name="plus" />
            เพิ่มแพทย์
          </button>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">ค้นหาชื่อแพทย์</span>
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">
              <Icon name="search" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาชื่อแพทย์"
              className="field field-text pl-10"
            />
          </label>
          <label className="block sm:w-72">
            <span className="sr-only">กรองตามสาขา</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as SpecialtyCode | "")} className="field">
              <option value="">ทุกสาขา ({people.length})</option>
              {SPECIALTIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label} · {item.name} ({counts.get(item.code) ?? 0})
                </option>
              ))}
            </select>
          </label>
        </div>
        {done ? (
          <Notice tone="success" role="status">
            {done}
          </Notice>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">ไม่พบแพทย์ที่ตรงกับคำค้นหรือสาขาที่เลือก</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[rgb(166_137_102/0.08)] sm:px-5">
              <SpecialtyChip code={person.specialty} className="hidden sm:inline-flex" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold text-ink">{person.name}</p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <SpecialtyChip code={person.specialty} small className="sm:hidden" />
                  <span className="truncate">{specialtyOf(person.specialty)?.name}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => openEditor(person)}
                  aria-label={`แก้ไข ${person.name}`}
                  className="btn btn-ghost size-11 min-h-0 p-0 sm:w-auto sm:px-3.5"
                >
                  <Icon name="edit" />
                  <span className="hidden sm:inline">แก้ไข</span>
                </button>
                <button
                  type="button"
                  onClick={() => openRemove(person)}
                  aria-label={`ลบ ${person.name}`}
                  className="btn btn-ghost btn-ghost-danger size-11 min-h-0 p-0 sm:w-auto sm:px-3.5"
                >
                  <Icon name="trash" />
                  <span className="hidden sm:inline">ลบ</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={editRef} aria-labelledby="edit-title" className={DIALOG}>
        <form onSubmit={save} noValidate>
          <h2 id="edit-title" className="text-lg font-bold">
            {editing ? "แก้ไขข้อมูลแพทย์" : "เพิ่มแพทย์"}
          </h2>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-ink">ชื่อ-นามสกุล</span>
              <input
                value={draftName}
                onChange={(event) => {
                  setDraftName(event.target.value);
                  setError("");
                }}
                autoComplete="off"
                placeholder="เช่น สมชาย ใจดี"
                className="field field-text mt-1.5"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="flex min-h-6 items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">สาขา</span>
                {draftSpecialty ? <SpecialtyChip code={draftSpecialty} small /> : null}
              </span>
              <div className="mt-1.5">
                <select
                  value={draftSpecialty}
                  onChange={(event) => {
                    setDraftSpecialty(event.target.value as SpecialtyCode | "");
                    setError("");
                  }}
                  className="field"
                >
                  <option value="">เลือกสาขา</option>
                  {SPECIALTIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label} · {item.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            {error ? (
              <Notice tone="warning" role="alert">
                {error}
              </Notice>
            ) : null}
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => editRef.current?.close()} className="btn btn-secondary">
              ยกเลิก
            </button>
            <button type="submit" className="btn btn-primary">
              {editing ? "บันทึก" : "เพิ่ม"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={removeRef} aria-labelledby="remove-title" className={DIALOG}>
        <h2 id="remove-title" className="text-lg font-bold">
          ลบแพทย์ออกจากรายชื่อ
        </h2>
        <dl className="mt-4 space-y-3 rounded-xl border border-line bg-white/70 p-4 text-sm">
          <div>
            <dt className="text-muted">ชื่อ</dt>
            <dd className="mt-0.5 font-semibold text-ink">{removing?.name}</dd>
          </div>
          <div>
            <dt className="text-muted">สาขา</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {removingSpecialty ? `${removingSpecialty.label} · ${removingSpecialty.name}` : null}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-6 text-muted">ชื่อนี้จะหายจากรายชื่อ และเลือกในหน้าลงทะเบียนไม่ได้อีก</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" autoFocus onClick={() => removeRef.current?.close()} className="btn btn-secondary">
            ยกเลิก
          </button>
          <button type="button" onClick={remove} className="btn btn-danger">
            <Icon name="trash" />
            ลบ
          </button>
        </div>
      </dialog>
    </section>
  );
}
