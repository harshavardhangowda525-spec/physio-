import { z } from "zod";
import { BUSINESS } from "@/lib/business";
import { getClassifier, aiStatus } from "@/lib/ai/classifier";
import { env } from "@/lib/env";
import { DatabaseUnavailableError } from "@/lib/errors";
import { findEnquiryForPatient, requestPatientChange, submitEnquiry } from "@/lib/enquiries/service";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { todayInTz } from "@/lib/validation";
import { step, welcome, initialState, type EngineDeps } from "./engine";
import { isValidTokenShape, loadChatState, newChatToken, saveChatState } from "./session";
import type { ChatResponse } from "./types";

const bodySchema = z.object({
  token: z.string().max(100).optional(),
  text: z.string().max(1000).optional(),
  action: z.string().max(80).regex(/^[a-z]+:[A-Za-z0-9_ ()–\-]*$/).optional(),
});

export function engineDeps(): EngineDeps {
  const e = env();
  const classifier = getClassifier();
  return {
    today: todayInTz(e.CLINIC_TIMEZONE),
    maxAdvanceDays: e.MAX_ADVANCE_BOOKING_DAYS,
    aiEnabled: aiStatus().active,
    classify: (t) => classifier.classify(t),
    submit: submitEnquiry,
    findForPatient: findEnquiryForPatient,
    requestChange: requestPatientChange,
  };
}

export type ChatHttpResult = { status: number; body: { token?: string; response?: ChatResponse; error?: string }; headers?: Record<string, string> };

function unavailable(): ChatHttpResult {
  return {
    status: 503,
    body: {
      error: "service_unavailable",
      response: {
        messages: [
          {
            kind: "error",
            title: "Assistant temporarily unavailable",
            text: `Sorry — our system is having trouble right now and nothing you type can be saved. Please call the clinic on ${BUSINESS.phoneDisplay}, or try again in a few minutes.`,
          },
        ],
        quickReplies: [{ label: `Call ${BUSINESS.phoneDisplay}`, href: `tel:${BUSINESS.phoneTel}`, variant: "primary" }],
        input: { type: "text", placeholder: "Try again in a moment" },
        mode: { ai: false },
      },
    },
  };
}

export async function handleChat(rawBody: unknown, headers: Headers, deps: EngineDeps = engineDeps()): Promise<ChatHttpResult> {
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { error: "invalid_request" } };
  const { text, action } = parsed.data;

  const ip = clientIp(headers);
  const ipLimit = rateLimit(`chat:ip:${ip}`, 40, 60_000);
  if (!ipLimit.allowed)
    return { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": String(ipLimit.retryAfterSec) } };

  let token = isValidTokenShape(parsed.data.token) ? parsed.data.token : undefined;
  try {
    let state = token ? await loadChatState(token) : null;
    if (!token) token = newChatToken();
    const tokLimit = rateLimit(`chat:tok:${token}`, 25, 60_000);
    if (!tokLimit.allowed)
      return { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": String(tokLimit.retryAfterSec) } };

    if (!state && !text && !action) {
      const w = welcome(deps);
      await saveChatState(token, w.state);
      return { status: 200, body: { token, response: w.response } };
    }
    state ??= initialState();
    const result = await step(state, { text, action }, deps);
    await saveChatState(token, result.state);
    return { status: 200, body: { token, response: result.response } };
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      console.error("[chat] database unavailable");
      return unavailable();
    }
    console.error("[chat] unexpected error:", err);
    return { ...unavailable(), status: 500 };
  }
}
