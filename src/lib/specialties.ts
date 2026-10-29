import { DEPARTMENTS, readableTextOn, type DeptCode } from "./allocation.ts";

/** The specialties a surgeon can be given in the admin list, in the order of the supplied surgeon list. */
export const SPECIALTY_CODES = [
  "GENSX",
  "URO",
  "PLASTIC",
  "NEURO",
  "PEDSX",
  "CVT",
  "VASCULAR",
  "ORTHO",
  "OBGYN",
  "ENT",
  "EYE",
  "MAXILLO",
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
  return { code, label: dept.label, name: dept.name, color: dept.color, text: readableTextOn(dept.color) };
});

export function specialtyOf(code: string): Specialty | null {
  return SPECIALTIES.find((item) => item.code === code) ?? null;
}

export function isSpecialtyCode(code: string): code is SpecialtyCode {
  return (SPECIALTY_CODES as readonly string[]).includes(code);
}
