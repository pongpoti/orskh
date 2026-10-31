import { after, type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { readJsonBody } from "@/lib/security";
import { handleTelegramWebhook, WEBHOOK_MAX_BYTES } from "@/lib/telegram-webhook";

/**
 * Telegram Bot API webhook: taps on the approve / reject buttons of access requests.
 * Public on purpose (proxy.ts skips the session and Origin checks for this path); authenticated by the
 * X-Telegram-Bot-Api-Secret-Token header inside handleTelegramWebhook().
 */
export async function POST(req: NextRequest) {
  const reply = await handleTelegramWebhook(
    req.headers,
    () => readJsonBody(req, WEBHOOK_MAX_BYTES),
    (task) => after(task),
  );
  return json(reply.body, reply.status);
}
