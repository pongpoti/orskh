#!/usr/bin/env node
// Mock of the deeSMSX OTP API for local tests. Never use in production. No SMS is sent anywhere.
// Point the app at it with DEESMSX_API_URL=http://127.0.0.1:4011/v1 (ignored on Vercel).
//   POST /v1/otp/request {apiKey, secretKey, sender, to: "66812345678", lang, isShowRef}
//        -> {error: "0", msg, status: "200", credit_balance, result: {requestNo, token, ref}}
//   POST /v1/otp/verify  {apiKey, secretKey, token, pin}
//        -> {status: "0", error: "0", msg: "Verify Success", result: {}} or {status: "500", error: "201|202|203", msg}
//   Shapes and reference codes as documented at https://deesmsx.readme.io (9: wrong key or secret, 99: bad number,
//   100: sender not found, 101: failed, 102: out of credit, 201: expired, 202: used, 203: wrong token or pin).
//   GET  /__control/health
//   GET  /__control/sms           -> every issued OTP [{to, pin, ref, sender, token, at}]
//   POST /__control/fail {mode, times?} -> the next `times` (default 1) requests fail: mode "9" | "99" | "100" |
//                                   "101" | "102" | "204" (that reference code), "timeout" (no answer), "html" (an
//                                   HTML error page); {mode: null} clears it
//   POST /__control/credit {balance} -> credit_balance in later answers (default 5000)
// Env: MOCK_SMS_PORT (4011), MOCK_SMS_API_KEY, MOCK_SMS_SECRET_KEY (defaults: DEESMSX_API_KEY / DEESMSX_SECRET_KEY
//      from env or .env.local, so `npm run dev` works against it), MOCK_SMS_TTL_S (300)
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { loadEnvLocal } from "../scripts/load-env.mjs";

const env = loadEnvLocal();
const PORT = Number(env.MOCK_SMS_PORT ?? 4011);
const API_KEY = env.MOCK_SMS_API_KEY ?? env.DEESMSX_API_KEY ?? "mock-api-key";
const SECRET_KEY = env.MOCK_SMS_SECRET_KEY ?? env.DEESMSX_SECRET_KEY ?? "mock-secret-key";
const TTL_MS = Number(env.MOCK_SMS_TTL_S ?? 300) * 1000;
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

const issued = []; // [{to, pin, ref, sender, at, token, expires, used}]
let failure = null; // {mode, times}
let credit = 5000;
let requestNo = 1000;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
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

const MESSAGES = {
  9: "Invalid apiKey or secretKey",
  99: "Invalid phone number",
  100: "Sender not found",
  101: "Send failed",
  102: "Credit not enough",
  204: "Please Settings In my.deesmsx.com",
};

/** The request example's error shape: {code, status: "500", msg}. */
const requestError = (res, code) => send(res, 200, { code: String(code), status: "500", msg: MESSAGES[code] ?? "Error" });
const verifyError = (res, code, msg) => send(res, 200, { status: "500", error: String(code), msg });

function takeFailure() {
  if (!failure) return null;
  const { mode } = failure;
  failure.times -= 1;
  if (failure.times <= 0) failure = null;
  return mode;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/__control/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/__control/sms") {
      return send(res, 200, issued.map(({ to, pin, ref, sender, token, at }) => ({ to, pin, ref, sender, token, at })));
    }
    if (req.method === "POST" && url.pathname === "/__control/fail") {
      const body = JSON.parse((await readBody(req)) || "{}");
      failure = body.mode ? { mode: String(body.mode), times: Number(body.times ?? 1) } : null;
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/__control/credit") {
      const body = JSON.parse((await readBody(req)) || "{}");
      credit = Number(body.balance);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/v1/otp/request") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const mode = takeFailure();
      if (mode === "timeout") return; // never answers; the app gives up on its own
      if (mode === "html") {
        res.writeHead(502, { "content-type": "text/html" });
        return res.end("<html><body>Bad Gateway</body></html>");
      }
      if (mode) return requestError(res, Number(mode));
      if (!eq(body.apiKey, API_KEY) || !eq(body.secretKey, SECRET_KEY)) return requestError(res, 9);
      if (typeof body.sender !== "string" || !body.sender) return requestError(res, 100);
      if (typeof body.to !== "string" || !/^66[689]\d{8}$/.test(body.to)) return requestError(res, 99);
      if (credit <= 0) return requestError(res, 102);
      credit -= 1;
      const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
      let ref = "";
      for (let i = 0; i < 4; i++) ref += REF_ALPHABET[randomInt(0, REF_ALPHABET.length)];
      const token = randomBytes(24).toString("hex");
      requestNo += 1;
      issued.push({ to: body.to, pin, ref, sender: body.sender, at: new Date().toISOString(), token, expires: Date.now() + TTL_MS, used: false });
      return send(res, 200, {
        error: "0",
        msg: "Send OTP Success",
        status: "200",
        credit_balance: credit,
        result: { requestNo: String(requestNo), token, ref },
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/otp/verify") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const mode = takeFailure();
      if (mode === "timeout") return;
      if (mode === "html") {
        res.writeHead(502, { "content-type": "text/html" });
        return res.end("<html><body>Bad Gateway</body></html>");
      }
      if (mode) return verifyError(res, Number(mode), MESSAGES[mode] ?? "Error");
      if (!eq(body.apiKey, API_KEY) || !eq(body.secretKey, SECRET_KEY)) return verifyError(res, 9, MESSAGES[9]);
      const otp = issued.find((o) => eq(o.token, body.token));
      if (!otp) return verifyError(res, 203, "Token or pin invalid");
      if (otp.used) return verifyError(res, 202, "Token already used");
      if (Date.now() > otp.expires) return verifyError(res, 201, "Token Expires");
      if (!eq(otp.pin, body.pin)) return verifyError(res, 203, "Token or pin invalid");
      otp.used = true;
      return send(res, 200, { status: "0", error: "0", msg: "Verify Success", result: {} });
    }

    return send(res, 404, { status: "404", msg: "not found" });
  } catch {
    return send(res, 400, { status: "400", msg: "bad request" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-deesmsx] http://127.0.0.1:${PORT}/v1 (OTP request/verify; control at /__control/*)`);
});
