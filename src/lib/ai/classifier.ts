import { env } from "@/lib/env";
import { FAQ_INTENTS } from "@/lib/chat/faq";

/**
 * The AI provider is used ONLY to map a free-text message onto one of a fixed set of
 * labels. It never writes replies, so it cannot invent prices, services or medical advice.
 * All replies come from verified templates in faq.ts / engine.ts.
 */
export const AI_LABELS = [
  "book_appointment",
  "check_status",
  "change_or_cancel",
  "speak_to_team",
  "medical_advice",
  "urgent_medical",
  "greeting",
  ...FAQ_INTENTS.map((i) => `faq:${i}` as const),
  "other",
] as const;
export type AiLabel = (typeof AI_LABELS)[number];

export interface IntentClassifier {
  readonly name: string;
  classify(text: string): Promise<AiLabel | null>;
}

const SYSTEM_PROMPT = `You classify messages sent to the appointment assistant of a home physiotherapy clinic in Bengaluru.
Reply with JSON only: {"label": "<one label>"}.
Labels:
- book_appointment: wants to request/book a home visit or appointment
- check_status: wants to know the status of a request they already made
- change_or_cancel: wants to change, reschedule or cancel a request
- speak_to_team: wants a human, a callback or the clinic team
- medical_advice: asks for diagnosis, exercises, medicines, or recovery predictions
- urgent_medical: describes an emergency or severe/sudden symptoms
- greeting: hello/thanks/small talk
- faq:home_visits, faq:how_to_request, faq:contact_number, faq:location, faq:hours, faq:service_areas, faq:services, faq:prices, faq:female_therapist, faq:change_cancel, faq:rating, faq:about, faq:privacy: a question on that topic
- other: anything else
Never answer the question. Output only the JSON object.`;

class GroqClassifier implements IntentClassifier {
  readonly name = "groq";
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
    private timeoutMs: number,
  ) {}

  async classify(text: string): Promise<AiLabel | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 30,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text.slice(0, 600) },
          ],
        }),
      });
      if (!res.ok) {
        console.warn(`[ai] groq returned HTTP ${res.status}; falling back to rules`);
        return null;
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = body.choices?.[0]?.message?.content ?? "";
      const label = (JSON.parse(raw) as { label?: string }).label;
      return (AI_LABELS as readonly string[]).includes(label ?? "") ? (label as AiLabel) : null;
    } catch (err) {
      console.warn("[ai] classification failed; falling back to rules:", err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

const noop: IntentClassifier = { name: "none", classify: async () => null };

let override: IntentClassifier | undefined;
export function setClassifier(c: IntentClassifier | undefined): void {
  override = c;
}

export function getClassifier(): IntentClassifier {
  if (override) return override;
  const e = env();
  if (e.AI_PROVIDER === "groq" && e.GROQ_API_KEY) {
    return new GroqClassifier(e.GROQ_API_KEY, e.GROQ_MODEL, e.GROQ_BASE_URL, e.AI_TIMEOUT_MS);
  }
  return noop;
}

export function aiStatus(): { provider: string; active: boolean; note: string } {
  const e = env();
  if (e.AI_PROVIDER === "groq" && e.GROQ_API_KEY)
    return { provider: "groq", active: true, note: `Groq (${e.GROQ_MODEL}) for intent detection only. Not verified until a live call succeeds.` };
  if (e.AI_PROVIDER === "groq") return { provider: "groq", active: false, note: "AI_PROVIDER=groq but GROQ_API_KEY is empty — rule-based mode." };
  return { provider: "none", active: false, note: "Rule-based mode (no AI provider configured)." };
}
