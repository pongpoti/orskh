#!/usr/bin/env node
// Mock of LINE Login v2.1 for local tests. Never use in production.
//   GET  /oauth2/v2.1/authorize  -> 302 back to redirect_uri with code+state (or error)
//   POST /oauth2/v2.1/token      -> checks client_id, client_secret, redirect_uri, PKCE verifier
//   POST /oauth2/v2.1/verify     -> checks id_token signature, client_id, nonce; returns claims
//   POST /__control/identity     -> {sub?, name?, picture?, error?} for the next logins
//   GET  /__control/health
//   POST /bot<token>/<method>    -> Telegram Bot API stub: sendMessage, editMessageText, answerCallbackQuery,
//                                   getWebhookInfo, setWebhook (every call is recorded)
//   GET  /__control/telegram     -> recorded sendMessage calls [{token, chat_id, text, parse_mode, reply_markup, message_id}]
//   GET  /__control/telegram/calls -> every recorded Bot API call [{method, token, body}]
// Env: MOCK_LINE_PORT (4010), MOCK_LINE_CLIENT_ID / MOCK_LINE_CLIENT_SECRET (default: LINE_CHANNEL_ID /
//      LINE_CHANNEL_SECRET from env or .env.local, so `npm run dev` works against it), MOCK_LINE_SUB,
//      MOCK_LINE_NAME, MOCK_LINE_PICTURE
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { jwtVerify, SignJWT } from "jose";
import { loadEnvLocal } from "../scripts/load-env.mjs";

const env = loadEnvLocal();
const PORT = Number(env.MOCK_LINE_PORT ?? 4010);
const CLIENT_ID = env.MOCK_LINE_CLIENT_ID ?? env.LINE_CHANNEL_ID ?? "1234567890";
const CLIENT_SECRET = env.MOCK_LINE_CLIENT_SECRET ?? env.LINE_CHANNEL_SECRET ?? "mock-line-secret";
const ISS = "https://access.line.me";
const key = new TextEncoder().encode(CLIENT_SECRET);

let identity = {
  sub: env.MOCK_LINE_SUB ?? "U00000000000000000000000000000001",
  name: env.MOCK_LINE_NAME ?? "หมอทดสอบ",
  picture: env.MOCK_LINE_PICTURE ?? null,
  error: null,
};
const codes = new Map(); // code -> { redirectUri, nonce, challenge, identity, used }
const telegram = []; // recorded sendMessage calls
const telegramCalls = []; // every Bot API call
let webhook = { url: "", allowed_updates: [] };

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
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/__control/health") return send(res, 200, { ok: true });

    if (req.method === "GET" && url.pathname === "/__control/telegram") return send(res, 200, telegram);
    if (req.method === "GET" && url.pathname === "/__control/telegram/calls") return send(res, 200, telegramCalls);

    const tg = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    if (req.method === "POST" && tg) {
      const [, token, method] = tg;
      const body = JSON.parse((await readBody(req)) || "{}");
      telegramCalls.push({ method, token, body });
      const fail = (description) => send(res, 400, { ok: false, error_code: 400, description });
      switch (method) {
        case "sendMessage": {
          const message_id = telegram.length + 1;
          telegram.push({ token, chat_id: body.chat_id, text: body.text, parse_mode: body.parse_mode, reply_markup: body.reply_markup, message_id });
          return send(res, 200, { ok: true, result: { message_id, chat: { id: Number(body.chat_id) }, date: Math.floor(Date.now() / 1000), text: body.text } });
        }
        case "editMessageText":
          if (!telegram.some((m) => m.message_id === body.message_id && String(m.chat_id) === String(body.chat_id))) {
            return fail("Bad Request: message to edit not found");
          }
          return send(res, 200, { ok: true, result: { message_id: body.message_id, text: body.text } });
        case "answerCallbackQuery":
          return send(res, 200, { ok: true, result: true });
        case "getWebhookInfo":
          return send(res, 200, {
            ok: true,
            result: { url: webhook.url, has_custom_certificate: false, pending_update_count: 0, allowed_updates: webhook.allowed_updates },
          });
        case "setWebhook":
          // Real Telegram also requires https; the mock accepts http for local tests.
          if (typeof body.url !== "string" || !/^https?:\/\//.test(body.url)) return fail("Bad Request: bad webhook: invalid url");
          if (body.secret_token !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(body.secret_token)) {
            return fail("Bad Request: secret token contains unallowed characters");
          }
          webhook = { url: body.url, allowed_updates: body.allowed_updates ?? [] };
          return send(res, 200, { ok: true, result: true, description: "Webhook was set" });
        default:
          return send(res, 404, { ok: false, error_code: 404, description: "Not Found" });
      }
    }

    if (req.method === "POST" && url.pathname === "/__control/identity") {
      const body = JSON.parse((await readBody(req)) || "{}");
      identity = { ...identity, error: null, ...body };
      return send(res, 200, { ok: true, identity });
    }

    if (req.method === "GET" && url.pathname === "/oauth2/v2.1/authorize") {
      const q = Object.fromEntries(url.searchParams);
      const problems = [];
      if (q.response_type !== "code") problems.push("response_type");
      if (q.client_id !== CLIENT_ID) problems.push("client_id");
      if (!q.redirect_uri) problems.push("redirect_uri");
      if (!q.state) problems.push("state");
      if (!q.nonce) problems.push("nonce");
      if (!(q.scope ?? "").split(" ").includes("openid")) problems.push("scope");
      if (!q.code_challenge || q.code_challenge_method !== "S256") problems.push("pkce");
      if (problems.length) return send(res, 400, { error: "invalid_request", problems });
      const back = new URL(q.redirect_uri);
      back.searchParams.set("state", q.state);
      if (identity.error) {
        back.searchParams.set("error", identity.error);
        back.searchParams.set("error_description", "The user has denied the request");
      } else {
        const code = randomBytes(16).toString("hex");
        codes.set(code, {
          redirectUri: q.redirect_uri,
          nonce: q.nonce,
          challenge: q.code_challenge,
          identity: { ...identity },
          used: false,
        });
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { location: back.toString(), "cache-control": "no-store" });
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/oauth2/v2.1/token") {
      const f = new URLSearchParams(await readBody(req));
      const entry = codes.get(f.get("code") ?? "");
      if (f.get("grant_type") !== "authorization_code") return send(res, 400, { error: "unsupported_grant_type" });
      if (f.get("client_id") !== CLIENT_ID || !eq(f.get("client_secret") ?? "", CLIENT_SECRET)) {
        return send(res, 400, { error: "invalid_client" });
      }
      if (!entry || entry.used) return send(res, 400, { error: "invalid_grant" });
      entry.used = true;
      if (f.get("redirect_uri") !== entry.redirectUri) return send(res, 400, { error: "invalid_grant", detail: "redirect_uri" });
      const verifier = f.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!eq(challenge, entry.challenge)) return send(res, 400, { error: "invalid_grant", detail: "code_verifier" });
      const now = Math.floor(Date.now() / 1000);
      const claims = { nonce: entry.nonce, amr: ["linesso"], name: entry.identity.name };
      if (entry.identity.picture) claims.picture = entry.identity.picture;
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(ISS)
        .setSubject(entry.identity.sub)
        .setAudience(CLIENT_ID)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(key);
      return send(res, 200, {
        access_token: randomBytes(24).toString("hex"),
        token_type: "Bearer",
        expires_in: 2592000,
        scope: "profile openid",
        id_token: idToken,
      });
    }

    if (req.method === "POST" && url.pathname === "/oauth2/v2.1/verify") {
      const f = new URLSearchParams(await readBody(req));
      if (f.get("client_id") !== CLIENT_ID) return send(res, 400, { error: "invalid_request", error_description: "Invalid audience" });
      let payload;
      try {
        ({ payload } = await jwtVerify(f.get("id_token") ?? "", key, { issuer: ISS, audience: CLIENT_ID, algorithms: ["HS256"] }));
      } catch {
        return send(res, 400, { error: "invalid_request", error_description: "Invalid IdToken." });
      }
      if (f.get("nonce") && f.get("nonce") !== payload.nonce) {
        return send(res, 400, { error: "invalid_request", error_description: "Invalid IdToken Nonce." });
      }
      return send(res, 200, payload);
    }

    send(res, 404, { error: "not_found" });
  } catch (e) {
    send(res, 500, { error: "server_error", detail: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-line] listening on http://localhost:${PORT}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
