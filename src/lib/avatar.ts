/**
 * A LINE profile picture URL the page may load: https on LINE's CDN (*.line-scdn.net, as the CSP img-src allows),
 * without credentials or a port. Anything else gives null, so the avatar shows the name's first letter instead.
 * The same rule as cleanPictureUrl() in src/lib/line.ts, applied again where the picture is shown.
 */
export function avatarSrc(picture: string | null | undefined): string | null {
  if (typeof picture !== "string" || picture.length > 1024) return null;
  try {
    const u = new URL(picture);
    const okHost = u.hostname === "profile.line-scdn.net" || u.hostname.endsWith(".line-scdn.net");
    return u.protocol === "https:" && okHost && !u.username && !u.password && !u.port ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The letter an avatar shows for a name: its first letter, skipping Thai leading vowels (เ แ โ ใ ไ), so
 * "เฉลิมพล" shows "ฉ" rather than a lone vowel; the first character when there is no letter, "•" for an empty name.
 */
export function initialOf(name: string): string {
  const chars = Array.from(name.trim());
  return chars.find((c) => /\p{L}/u.test(c) && !/[\u0E40-\u0E44]/.test(c)) ?? chars[0] ?? "•";
}
