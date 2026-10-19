import { describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { resetEnvCache } from "@/lib/env";
import { handleChat } from "@/lib/chat/handler";
import { submitEnquiry } from "@/lib/enquiries/service";
import { DatabaseUnavailableError } from "@/lib/errors";
import { addDaysIso } from "./helpers";

const h = (ip = "203.0.113.5") => new Headers({ "x-forwarded-for": ip });

describe("chat HTTP handler", () => {
  it("issues a token and keeps state across turns", async () => {
    const first = await handleChat({}, h());
    expect(first.status).toBe(200);
    expect(first.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const second = await handleChat({ token: first.body.token, action: "menu:book" }, h());
    expect(second.body.response?.progress?.label).toBe("Patient name");
    const third = await handleChat({ token: first.body.token, text: "Lakshmi" }, h());
    expect(third.body.response?.progress?.label).toBe("Contact number");
  });

  it("rejects malformed bodies", async () => {
    expect((await handleChat({ action: "<script>" }, h())).status).toBe(400);
    expect((await handleChat({ text: "x".repeat(5000) }, h())).status).toBe(400);
  });

  it("rate-limits a flood from one IP", async () => {
    let last = 200;
    for (let i = 0; i < 45; i++) last = (await handleChat({}, h("198.51.100.9"))).status;
    expect(last).toBe(429);
  });
});

describe("12. database connection failure", () => {
  it("chat returns 503 with the clinic phone fallback; submission surfaces DatabaseUnavailableError", async () => {
    const good = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://physio:wrong@127.0.0.1:1/none";
    resetEnvCache();
    await closeDb();
    try {
      const r = await handleChat({}, h("192.0.2.1"));
      expect(r.status).toBe(503);
      expect(r.body.response?.messages[0].text).toContain("077158 77047");

      await expect(
        submitEnquiry({
          patientName: "Test Patient",
          contactNumber: "9876543210",
          preferredDate: addDaysIso(2),
          preferredTime: "Morning",
          locality: "Jayanagar",
          serviceRequirement: "Back pain",
          therapistPreference: "NO_PREFERENCE",
          consent: true,
          consentAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      process.env.DATABASE_URL = good;
      resetEnvCache();
      await closeDb();
    }
  });

  it("the chat tells the patient their request was NOT submitted when the DB fails at submit time", async () => {
    const { Conversation } = await import("./helpers");
    const c = new Conversation();
    c.deps = { ...c.deps, submit: async () => { throw new DatabaseUnavailableError(); } };
    await c.tap("menu:book");
    for (const v of ["Gita", "9876543210", addDaysIso(2)]) await c.say(v);
    await c.tap("time:Any time");
    await c.say("Hanumanthnagar");
    await c.say("Ankle sprain recovery");
    await c.tap("pref:NO_PREFERENCE");
    await c.tap("consent:yes");
    await c.tap("confirm:submit");
    expect(c.allText()).toMatch(/has NOT been submitted/);
    expect(c.allText()).toContain("077158 77047");
    expect(c.state.step).toBe("book_confirm");
    expect(c.last.quickReplies.some((q) => q.action === "confirm:submit")).toBe(true);
  });
});
