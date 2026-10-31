import { DEPARTMENTS, readableTextOn, type DeptCode } from "./allocation.ts";

/** The specialties a doctor can be given in the admin list, in code order (A to Z), which is also the list's order. */
export const SPECIALTY_CODES = [
  "CHEST",
  "CVT",
  "ENT",
  "EYE",
  "GENSX",
  "MAXILLO",
  "NEPHRO",
  "NEURO",
  "OBGYN",
  "ORTHO",
  "PEDSX",
  "PLASTIC",
  "URO",
  "VASCULAR",
] as const satisfies readonly DeptCode[];

export type SpecialtyCode = (typeof SPECIALTY_CODES)[number];

export type Specialty = {
  code: SpecialtyCode;
  /** The code as shown on the page. */
  label: string;
  name: string;
  color: string;
  text: string;
};

export const SPECIALTIES: readonly Specialty[] = SPECIALTY_CODES.map((code) => {
  const dept = DEPARTMENTS[code];
  return { code, label: code, name: dept.name, color: dept.color, text: readableTextOn(dept.color) };
});

export function specialtyOf(code: string): Specialty | null {
  return SPECIALTIES.find((item) => item.code === code) ?? null;
}

export function isSpecialtyCode(code: string): code is SpecialtyCode {
  return (SPECIALTY_CODES as readonly string[]).includes(code);
}
