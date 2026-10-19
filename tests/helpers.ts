import { engineDeps } from "@/lib/chat/handler";
import { step, welcome, type EngineDeps } from "@/lib/chat/engine";
import type { ChatResponse, ChatState } from "@/lib/chat/types";
import { todayInTz } from "@/lib/validation";

export function addDaysIso(days: number): string {
  const t = todayInTz("Asia/Kolkata");
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Drives the real engine + real services, like the HTTP route does. */
export class Conversation {
  state: ChatState;
  last: ChatResponse;
  constructor(public deps: EngineDeps = engineDeps()) {
    const w = welcome(deps);
    this.state = w.state;
    this.last = w.response;
  }
  async say(text: string) {
    const r = await step(this.state, { text }, this.deps);
    this.state = r.state;
    this.last = r.response;
    return r.response;
  }
  async tap(action: string) {
    const r = await step(this.state, { action }, this.deps);
    this.state = r.state;
    this.last = r.response;
    return r.response;
  }
  allText(): string {
    return this.last.messages.map((m) => `${m.title ?? ""} ${m.text}`).join("\n");
  }
}

export async function completeBooking(c: Conversation, overrides: Partial<Record<string, string>> = {}) {
  await c.tap("menu:book");
  await c.say(overrides.name ?? "Priya Sharma");
  await c.say(overrides.phone ?? "98765 43210");
  await c.say(overrides.date ?? addDaysIso(3));
  await c.tap(`time:${overrides.time ?? "Morning (8 am – 12 pm)"}`);
  await c.say(overrides.locality ?? "JP Nagar 2nd Phase");
  await c.say(overrides.reason ?? "Knee pain while climbing stairs for two weeks");
  await c.tap(`pref:${overrides.pref ?? "FEMALE"}`);
  await c.tap("consent:yes");
  return c.tap("confirm:submit");
}
