#!/usr/bin/env node
// Mock of the Twilio Verify API for local tests. Never use in production. No SMS is sent anywhere.
// Point the app at it with TWILIO_VERIFY_API_URL=http://127.0.0.1:4012/v2 (ignored on Vercel).
//   POST /v2/Services/{VA…}/Verifications (form: To=+66812345678, Channel=sms, Locale)
//        -> 201 {sid: "VE…", service_sid, account_sid, to, channel, status: "pending", valid: false, …}
//        A second start to the same number while a verification is pending resends the same code with the same SID,
//        as Twilio does.
//   POST /v2/Services/{VA…}/VerificationCheck (form: VerificationSid or To, Code)
//        -> 200 {status: "approved" | "pending", valid}; 404 (20404) once approved, expired or out of attempts;
//        429 (60202) after 5 wrong codes
//   Errors as Twilio sends them: HTTP 4xx/5xx {code, message, more_info, status} (20003: wrong credentials, 20404:
//   no such service or verification, 60200: invalid parameter, 60202: max check attempts).
//   GET  /__control/health
//   GET  /__control/sms           -> every SMS sent [{to, code, sid, channel, locale, at}]
//   POST /__control/fail {code, status?, times?} -> the next `times` (default 1) API calls fail with that Twilio error
//                                   code and HTTP status (default 400); code "timeout" (no answer) or "html" (an HTML
//                                   502 page); {code: null} clears it
// Env: MOCK_TWILIO_PORT (4012), MOCK_TWILIO_ACCOUNT_SID, MOCK_TWILIO_AUTH_TOKEN, MOCK_TWILIO_SERVICE_SID (defaults:
//      TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID from env or .env.local, so `npm run dev`
//      works against it), MOCK_TWILIO_TTL_S (600)
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { loadEnvLocal } from "../scripts/load-env.mjs";

const env = loadEnvLocal();
const PORT = Number(env.MOCK_TWILIO_PORT ?? 4012);
const ACCOUNT_SID = env.MOCK_TWILIO_ACCOUNT_SID ?? env.TWILIO_ACCOUNT_SID ?? `AC${"0".repeat(32)}`;
const AUTH_TOKEN = env.MOCK_TWILIO_AUTH_TOKEN ?? env.TWILIO_AUTH_TOKEN ?? "mockmockmockmockmockmockmockmock";
const SERVICE_SID = env.MOCK_TWILIO_SERVICE_SID ?? env.TWILIO_VERIFY_SERVICE_SID ?? `VA${"0".repeat(32)}`;
const TTL_MS = Number(env.MOCK_TWILIO_TTL_S ?? 600) * 1000;
const MAX_CHECKS = 5;

const sent = []; // [{to, code, sid, channel, locale, at}]
const verifications = new Map(); // sid -> {sid, to, code, expires, checks, status}
let failure = null; // {code, status, times}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function twilioError(res, status, code, message) {
  send(res, status, { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error("too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function eq(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

function authorized(req) {
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], "base64").toString("utf8").split(":");
  return eq(user, ACCOUNT_SID) && eq(rest.join(":"), AUTH_TOKEN);
}

function takeFailure() {
  if (!failure) return null;
  const f = { ...failure };
  failure.times -= 1;
  if (failure.times <= 0) failure = null;
  return f;
}

/** The pending verification for `to`, dropping expired ones. */
function pendingFor(to) {
  for (const v of verifications.values()) {
    if (v.to !== to) continue;
    if (Date.now() > v.expires) {
      verifications.delete(v.sid);
      continue;
    }
    return v;
  }
  return null;
}

function resource(v, extra = {}) {
  return {
    sid: v.sid,
    service_sid: SERVICE_SID,
    account_sid: ACCOUNT_SID,
    to: v.to,
    channel: "sms",
    status: v.status,
    valid: v.status === "approved",
    date_created: new Date(v.expires - TTL_MS).toISOString(),
    ...extra,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/__control/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/__control/sms") return send(res, 200, sent);
    if (req.method === "POST" && url.pathname === "/__control/fail") {
      const body = JSON.parse((await readBody(req)) || "{}");
      failure =
        body.code === null || body.code === undefined
          ? null
          : { code: body.code, status: Number(body.status ?? 400), times: Number(body.times ?? 1) };
      return send(res, 200, { ok: true });
    }

    const m = /^\/v2\/Services\/([^/]+)\/(Verifications|VerificationCheck)$/.exec(url.pathname);
    if (req.method === "POST" && m) {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const f = takeFailure();
      if (f?.code === "timeout") return; // never answers; the app gives up on its own
      if (f?.code === "html") {
        res.writeHead(502, { "content-type": "text/html" });
        return res.end("<html><body>Bad Gateway</body></html>");
      }
      if (f) return twilioError(res, f.status, Number(f.code), "Mock failure");
      if (!authorized(req)) return twilioError(res, 401, 20003, "Authenticate");
      if (!eq(decodeURIComponent(m[1]), SERVICE_SID)) return twilioError(res, 404, 20404, "The requested resource was not found");

      if (m[2] === "Verifications") {
        if (form.Channel !== "sms") return twilioError(res, 400, 60200, "Invalid parameter: Channel");
        if (!/^\+66[689]\d{8}$/.test(form.To ?? "")) return twilioError(res, 400, 60200, "Invalid parameter `To`");
        let v = pendingFor(form.To);
        if (!v) {
          v = {
            sid: `VE${randomBytes(16).toString("hex")}`,
            to: form.To,
            code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
            expires: Date.now() + TTL_MS,
            checks: 0,
            status: "pending",
          };
          verifications.set(v.sid, v);
        }
        sent.push({ to: v.to, code: v.code, sid: v.sid, channel: form.Channel, locale: form.Locale ?? null, at: new Date().toISOString() });
        return send(res, 201, resource(v, { lookup: {}, send_code_attempts: [{ channel: "sms" }] }));
      }

      // VerificationCheck
      if (typeof form.Code !== "string" || !/^\d{4,10}$/.test(form.Code)) return twilioError(res, 400, 60200, "Invalid parameter: Code");
      const v = form.VerificationSid ? verifications.get(form.VerificationSid) : form.To ? pendingFor(form.To) : null;
      if (!v || Date.now() > v.expires) {
        if (v) verifications.delete(v.sid);
        return twilioError(res, 404, 20404, "The requested resource was not found");
      }
      if (v.checks >= MAX_CHECKS) {
        verifications.delete(v.sid);
        return twilioError(res, 429, 60202, "Max check attempts reached");
      }
      v.checks += 1;
      if (eq(v.code, form.Code)) {
        v.status = "approved";
        verifications.delete(v.sid); // approved verifications are deleted
        return send(res, 200, resource(v));
      }
      return send(res, 200, resource(v));
    }

    return twilioError(res, 404, 20404, "The requested resource was not found");
  } catch {
    return twilioError(res, 400, 60200, "Bad request");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-twilio] http://127.0.0.1:${PORT}/v2 (Verify start/check; control at /__control/*)`);
});
