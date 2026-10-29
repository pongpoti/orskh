import "server-only";

/** Thrown when required configuration is missing or malformed. Carries variable NAMES only. */
export class ConfigError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(`Missing or invalid environment variables: ${names.join(", ")}`);
    this.name = "ConfigError";
    this.names = names;
  }
}

/** True on Vercel (preview or production). Dev/test overrides are ignored there. */
export function onVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Collects problems so a single error lists every missing/invalid name. */
class Collector {
  readonly bad: string[] = [];
  need(name: string, valid?: (v: string) => boolean): string {
    const v = read(name);
    if (!v || (valid && !valid(v))) {
      this.bad.push(name);
      return "";
    }
    return v;
  }
  done(): void {
    if (this.bad.length) throw new ConfigError(this.bad);
  }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Canonical public origin of the app, e.g. https://orskh.vercel.app */
export function appUrl(): URL {
  const c = new Collector();
  const v = c.need("APP_URL", isHttpUrl);
  c.done();
  return new URL(new URL(v).origin);
}

/** Cookies use the __Host- prefix and Secure only when the app is served over https. */
export function secureCookies(): boolean {
  return appUrl().protocol === "https:";
}

export function sessionSecret(): string {
  const c = new Collector();
  const v = c.need("SESSION_SECRET", (s) => s.length >= 32);
  c.done();
  return v;
}

/**
 * Optional break-glass list (comma-separated): these mobile numbers are authorized without the database. Empty when
 * unset; the physician list itself is the `physicians` table (lib/authz.ts).
 */
export function allowedPhonesRaw(): string {
  return read("ALLOWED_PHONES") ?? "";
}

export function otpPepper(): string {
  const c = new Collector();
  const v = c.need("OTP_PEPPER", (s) => s.length >= 16);
  c.done();
  return v;
}

export function databaseUrl(): string {
  const c = new Collector();
  const v = c.need("DATABASE_URL", (s) => /^postgres(ql)?:\/\//.test(s));
  c.done();
  return v;
}

export interface LineConfig {
  channelId: string;
  channelSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  verifyUrl: string;
  redirectUri: string;
}

const LINE_AUTHORIZE = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_API = "https://api.line.me";

export function lineConfig(): LineConfig {
  const c = new Collector();
  const channelId = c.need("LINE_CHANNEL_ID");
  const channelSecret = c.need("LINE_CHANNEL_SECRET");
  const app = c.need("APP_URL", isHttpUrl);
  // Dev/test-only overrides (mock LINE server); never honoured on Vercel.
  const authOverride = onVercel() ? undefined : read("LINE_AUTH_URL");
  const apiOverride = onVercel() ? undefined : read("LINE_API_URL");
  if (authOverride && !isHttpUrl(authOverride)) c.bad.push("LINE_AUTH_URL");
  if (apiOverride && !isHttpUrl(apiOverride)) c.bad.push("LINE_API_URL");
  c.done();
  const api = (apiOverride ?? LINE_API).replace(/\/+$/, "");
  return {
    channelId,
    channelSecret,
    authorizeUrl: authOverride ?? LINE_AUTHORIZE,
    tokenUrl: `${api}/oauth2/v2.1/token`,
    verifyUrl: `${api}/oauth2/v2.1/verify`,
    redirectUri: `${new URL(app).origin}/api/auth/line/callback`,
  };
}

export type SmsProviderKind = "deesmsx" | "console" | "file";

export interface SmsConfig {
  /**
   * deesmsx: the provider sends and checks the code. console / file (development and tests only): the app makes the
   * code and writes the SMS to the log or to a JSON file in outboxDir.
   */
  kind: SmsProviderKind;
  apiKey: string;
  secretKey: string;
  sender: string;
  /** Base URL of the deeSMSX API, without a trailing slash. */
  apiUrl: string;
  outboxDir: string;
  /** Hard cap of codes sent in a rolling 24 h, all numbers together (protects the SMS credit). */
  dailyCap: number;
}

export const DEESMSX_API = "https://apicall.deesmsx.com/v1";
/** The provider's shared OTP sender: works before a sender name of our own is approved. */
export const DEESMSX_DEFAULT_SENDER = "deeSMS.OTP";
export const SMS_DAILY_CAP_DEFAULT = 300;

export function smsConfig(): SmsConfig {
  const c = new Collector();
  // On Vercel only the real provider is possible: SMS_PROVIDER=console|file is ignored there.
  const requested = onVercel() ? "deesmsx" : (read("SMS_PROVIDER") ?? "deesmsx");
  if (!["deesmsx", "console", "file"].includes(requested)) c.bad.push("SMS_PROVIDER");
  const kind = requested as SmsProviderKind;
  let apiKey = "";
  let secretKey = "";
  let outboxDir = "";
  if (kind === "deesmsx") {
    apiKey = c.need("DEESMSX_API_KEY");
    secretKey = c.need("DEESMSX_SECRET_KEY");
  } else if (kind === "file") {
    outboxDir = c.need("SMS_OUTBOX_DIR");
  }
  const sender = read("DEESMSX_SENDER") ?? DEESMSX_DEFAULT_SENDER;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(sender)) c.bad.push("DEESMSX_SENDER");
  // Dev/test-only override (mock deeSMSX server); never honoured on Vercel.
  const override = onVercel() ? undefined : read("DEESMSX_API_URL");
  if (override && !isHttpUrl(override)) c.bad.push("DEESMSX_API_URL");
  const capRaw = read("SMS_DAILY_CAP") ?? String(SMS_DAILY_CAP_DEFAULT);
  const dailyCap = Number(capRaw);
  if (!/^\d+$/.test(capRaw) || !Number.isSafeInteger(dailyCap) || dailyCap < 1) c.bad.push("SMS_DAILY_CAP");
  c.done();
  return {
    kind,
    apiKey,
    secretKey,
    sender,
    apiUrl: (override ?? DEESMSX_API).replace(/\/+$/, ""),
    outboxDir,
    dailyCap,
  };
}

export interface TelegramConfig {
  token: string;
  chatIds: string[];
  apiUrl: string;
}

const TELEGRAM_API = "https://api.telegram.org";

/** True when both Telegram settings are present (they may still be invalid; telegramConfig() reports that). */
export function telegramEnabled(): boolean {
  return Boolean(read("TELEGRAM_BOT_TOKEN") && read("TELEGRAM_CHAT_ID"));
}

/**
 * Optional login alerts. Returns null when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is unset (alerts are skipped).
 * TELEGRAM_CHAT_ID may list several chats, comma-separated.
 */
export function telegramConfig(): TelegramConfig | null {
  const token = read("TELEGRAM_BOT_TOKEN");
  const chats = read("TELEGRAM_CHAT_ID");
  if (!token || !chats) return null;
  const c = new Collector();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) c.bad.push("TELEGRAM_BOT_TOKEN");
  const chatIds = chats
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chatIds.length || chatIds.some((id) => !/^-?\d{1,20}$/.test(id) && !/^@[A-Za-z0-9_]{5,32}$/.test(id))) {
    c.bad.push("TELEGRAM_CHAT_ID");
  }
  // Dev/test-only override (mock Telegram server); never honoured on Vercel.
  const override = onVercel() ? undefined : read("TELEGRAM_API_URL");
  if (override && !isHttpUrl(override)) c.bad.push("TELEGRAM_API_URL");
  c.done();
  return { token, chatIds, apiUrl: (override ?? TELEGRAM_API).replace(/\/+$/, "") };
}

/** Everything the OTP endpoints need. Throws ConfigError listing every missing name. */
export function assertOtpReady(): void {
  const names: string[] = [];
  for (const fn of [appUrl, sessionSecret, otpPepper, databaseUrl, smsConfig]) {
    try {
      fn();
    } catch (e) {
      if (e instanceof ConfigError) names.push(...e.names);
      else throw e;
    }
  }
  if (names.length) throw new ConfigError([...new Set(names)]);
}
