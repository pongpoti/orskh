/**
 * A wait in Thai for the sign-in pages: seconds up to 90 s, then whole minutes, then whole hours (rounded up).
 * U+00A0 keeps the number with its unit. Isomorphic: used by the OTP route and the verify form.
 */
export function waitText(seconds: number): string {
  if (seconds <= 90) return `${Math.max(1, Math.ceil(seconds))} วินาที`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} นาที`;
  return `${Math.ceil(seconds / 3600)} ชั่วโมง`;
}
