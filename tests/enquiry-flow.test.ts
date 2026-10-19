import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { enquiries, notificationLogs, statusHistory } from "@/db/schema";
import { SUBMITTED_MESSAGE, UNKNOWN_FALLBACK } from "@/lib/business";
import { setEmailTransport } from "@/lib/notify/email";
import { retryNotification } from "@/lib/notify/service";
import { updateStatus, submitEnquiry } from "@/lib/enquiries/service";
import { addDaysIso, completeBooking, Conversation } from "./helpers";

const staffActor = { id: "00000000-0000-0000-0000-000000000000", name: "Test Staff", email: "t@example.test", role: "STAFF" as const };

describe("1. complete appointment enquiry", () => {
  it("collects every field, persists the enquiry, generates a reference and notifies staff", async () => {
    const c = new Conversation();
    expect(c.allText()).toContain("Welcome to Physiotherapy Treatment at Home");
    expect(c.last.quickReplies.map((q) => q.label)).toEqual(
      expect.arrayContaining(["Request a home physiotherapy appointment", "Ask about physiotherapy services", "Check appointment-request status", "Speak with the clinic team"]),
    );

    await c.tap("menu:book");
    expect(c.last.progress).toMatchObject({ current: 1, label: "Patient name" });
    await c.say("Priya Sharma");
    await c.say("+91 98765-43210");
    await c.say(addDaysIso(3));
    await c.tap("time:Evening (4 pm – 8 pm)");
    await c.say("Jayanagar 4th Block");
    await c.say("Lower back pain after long hours at desk");
    await c.tap("pref:FEMALE");
    expect(c.allText()).toMatch(/consent|agree/i);
    await c.tap("consent:yes");

    const summary = c.last.messages.find((m) => m.kind === "summary");
    expect(summary?.fields?.find((f) => f.label === "Phone")?.value).toBe("+91 98765 43210");
    expect(summary?.text).toMatch(/not a confirmed booking/i);

    const res = await c.tap("confirm:submit");
    const success = res.messages.find((m) => m.kind === "success")!;
    expect(success.text).toBe(SUBMITTED_MESSAGE);
    expect(success.reference).toMatch(/^PTH-\d{6}-[A-Z2-9]{4}$/);

    const [row] = await getDb().select().from(enquiries).where(eq(enquiries.reference, success.reference!));
    expect(row).toMatchObject({
      patientName: "Priya Sharma",
      contactNumber: "+919876543210",
      preferredDate: addDaysIso(3),
      preferredTime: "Evening (4 pm – 8 pm)",
      locality: "Jayanagar 4th Block",
      therapistPreference: "FEMALE",
      status: "NEW_ENQUIRY",
      source: "WEBSITE_CHAT",
    });
    expect(row.consentAt).toBeInstanceOf(Date);

    const logs = await getDb().select().from(notificationLogs).where(eq(notificationLogs.enquiryId, row.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "NEW_ENQUIRY", status: "TEST_MODE", attempts: 1 });
  });

  it("sends the staff notification in the required format without extra medical detail", async () => {
    const sent: { subject: string; text: string }[] = [];
    setEmailTransport({ send: async (m) => (sent.push(m), { status: "SENT", providerMessageId: "x1" }) });
    await completeBooking(new Conversation());
    expect(sent).toHaveLength(1);
    const t = sent[0].text;
    expect(t).toMatch(/^NEW HOME PHYSIOTHERAPY ENQUIRY\nReference: PTH-/);
    for (const label of ["Patient:", "Phone:", "Preferred date:", "Preferred time:", "Locality:", "Reason:", "Therapist preference:"]) expect(t).toContain(label);
    expect(t).toContain("Status: Awaiting Clinic Review");
    expect(t).toContain("Please verify availability and contact the patient.");
    expect(t).not.toMatch(/consent/i);
  });
});

describe("2. incomplete or invalid details", () => {
  it("rejects invalid name, phone, date and empty locality, and keeps asking", async () => {
    const c = new Conversation();
    await c.tap("menu:book");
    await c.say("1");
    expect(c.last.messages[0].kind).toBe("error");
    expect(c.state.step).toBe("book_name");
    await c.say("Ravi Kumar");

    await c.say("12345");
    expect(c.allText()).toMatch(/10-digit/);
    await c.say("5876543210");
    expect(c.allText()).toMatch(/valid Indian mobile/);
    expect(c.state.step).toBe("book_phone");
    await c.say("9876543210");

    await c.say("31/02/2027");
    expect(c.allText()).toMatch(/couldn't read that date/);
    await c.say("01/01/2020");
    expect(c.allText()).toMatch(/already passed/);
    await c.say(addDaysIso(400));
    expect(c.allText()).toMatch(/within the next 90 days/);
    expect(c.state.step).toBe("book_date");
  });

  it("server-side validation rejects a tampered submission even without the chat", async () => {
    const r = await submitEnquiry({
      patientName: "<script>",
      contactNumber: "abc",
      preferredDate: "2020-01-01",
      preferredTime: "",
      locality: "",
      serviceRequirement: "",
      therapistPreference: "NO_PREFERENCE",
      consent: false,
      consentAt: new Date(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(["patientName", "contactNumber", "preferredDate", "consent"]));
    expect(await getDb().select().from(enquiries)).toHaveLength(0);
  });

  it("nothing is stored when the patient declines consent", async () => {
    const c = new Conversation();
    await c.tap("menu:book");
    for (const v of ["Asha", "9876543210", addDaysIso(2)]) await c.say(v);
    await c.tap("time:Any time");
    await c.say("BTM Layout");
    await c.say("Shoulder stiffness");
    await c.tap("pref:NO_PREFERENCE");
    await c.tap("consent:no");
    expect(c.allText()).toMatch(/nothing has been submitted/);
    expect(await getDb().select().from(enquiries)).toHaveLength(0);
  });
});

describe("3/4. unverified dates and unconfirmed availability", () => {
  it("records a requested date as a preference only and never says confirmed", async () => {
    const c = new Conversation();
    await c.tap("menu:book");
    await c.say("Meera Rao");
    await c.say("9876543210");
    await c.say("tomorrow");
    expect(c.allText()).toMatch(/preference only/);
    expect(c.allText()).toMatch(/hasn't confirmed availability/);
    expect(c.allText()).not.toMatch(/\bconfirmed (your|the) (appointment|booking)\b/i);
  });

  it("status check reports 'awaiting clinic review' until staff confirm", async () => {
    const c = new Conversation();
    const res = await completeBooking(c);
    const ref = res.messages.find((m) => m.reference)!.reference!;

    await c.tap("menu:status");
    await c.say(ref.toLowerCase());
    await c.say("9876543210");
    let status = c.last.messages.find((m) => m.kind === "status")!;
    expect(status.text).toMatch(/awaiting clinic review/i);
    expect(status.text).toMatch(/not yet (a )?confirmed/i);

    const [row] = await getDb().select().from(enquiries).where(eq(enquiries.reference, ref));
    await updateStatus(staffActor, row.id, "CONFIRMED");
    await c.tap("menu:status");
    await c.say(ref);
    await c.say("9876543210");
    status = c.last.messages.find((m) => m.kind === "status")!;
    expect(status.text).toMatch(/^Confirmed by the clinic team/);
  });

  it("does not reveal a request when the phone number doesn't match", async () => {
    const c = new Conversation();
    const ref = (await completeBooking(c)).messages.find((m) => m.reference)!.reference!;
    await c.tap("menu:status");
    await c.say(ref);
    await c.say("9123456789");
    expect(c.allText()).toMatch(/couldn't find a request/);
    expect(c.allText()).not.toContain("Priya");
  });
});

describe("5. duplicate submissions", () => {
  it("a repeated submit (double click / retry) creates exactly one enquiry and one notification", async () => {
    const c = new Conversation();
    await c.tap("menu:book");
    for (const v of ["Kiran", "9876543210", addDaysIso(5)]) await c.say(v);
    await c.tap("time:Any time");
    await c.say("Basavanagudi");
    await c.say("Post-surgery rehabilitation for hip");
    await c.tap("pref:MALE");
    await c.tap("consent:yes");
    const frozen = c.state;
    const c1 = new Conversation(c.deps);
    const c2 = new Conversation(c.deps);
    c1.state = frozen;
    c2.state = frozen;
    const [a, b] = await Promise.all([c1.tap("confirm:submit"), c2.tap("confirm:submit")]);
    const refA = a.messages.find((m) => m.reference)!.reference;
    const refB = b.messages.find((m) => m.reference)!.reference;
    expect(refA).toBe(refB);
    expect(await getDb().select().from(enquiries)).toHaveLength(1);
    expect(await getDb().select().from(notificationLogs)).toHaveLength(1);
  });
});

describe("6. notification failure", () => {
  it("keeps the enquiry, logs the failure, and succeeds on retry", async () => {
    setEmailTransport({ send: async () => ({ status: "FAILED", error: "SMTP connection refused" }) });
    const c = new Conversation();
    const res = await completeBooking(c);
    expect(res.messages.find((m) => m.kind === "success")?.text).toBe(SUBMITTED_MESSAGE);

    const rows = await getDb().select().from(enquiries);
    expect(rows).toHaveLength(1);
    const [log] = await getDb().select().from(notificationLogs);
    expect(log).toMatchObject({ status: "FAILED", attempts: 1, lastError: "SMTP connection refused" });

    setEmailTransport({ send: async () => ({ status: "SENT", providerMessageId: "msg-42" }) });
    const retried = await retryNotification(log.id);
    expect(retried).toMatchObject({ status: "SENT", attempts: 2, lastError: null, providerMessageId: "msg-42" });
  });

  it("a transport that throws is treated as a failure, not a lost enquiry", async () => {
    setEmailTransport({ send: async () => { throw new Error("boom"); } });
    await completeBooking(new Conversation());
    expect(await getDb().select().from(enquiries)).toHaveLength(1);
    const [log] = await getDb().select().from(notificationLogs);
    expect(log.status).toBe("FAILED");
  });
});

describe("7. cancellation and rescheduling", () => {
  it("patient can request a reschedule, staff are notified, and it is not called confirmed", async () => {
    const c = new Conversation();
    const ref = (await completeBooking(c)).messages.find((m) => m.reference)!.reference!;
    await c.tap("menu:change");
    await c.say(ref);
    await c.say("9876543210");
    await c.tap("kind:RESCHEDULE");
    await c.say("Saturday morning instead please");
    expect(c.allText()).toMatch(/not confirmed until the clinic/);
    const [row] = await getDb().select().from(enquiries).where(eq(enquiries.reference, ref));
    expect(row.status).toBe("RESCHEDULE_REQUESTED");
    expect(row.patientChangeRequest).toContain("Saturday morning");
    const logs = await getDb().select().from(notificationLogs).where(eq(notificationLogs.enquiryId, row.id));
    expect(logs.map((l) => l.event).sort()).toEqual(["NEW_ENQUIRY", "PATIENT_RESCHEDULE_REQUEST"]);
    const hist = await getDb().select().from(statusHistory).where(eq(statusHistory.enquiryId, row.id));
    expect(hist).toHaveLength(2);
  });

  it("patient can cancel; a cancelled request cannot be changed again", async () => {
    const c = new Conversation();
    const ref = (await completeBooking(c)).messages.find((m) => m.reference)!.reference!;
    await c.tap("menu:change");
    await c.say(ref);
    await c.say("9876543210");
    await c.tap("kind:CANCEL");
    await c.tap("msg:skip");
    expect(c.allText()).toMatch(/cancelled/i);
    const [row] = await getDb().select().from(enquiries).where(eq(enquiries.reference, ref));
    expect(row.status).toBe("CANCELLED");

    await c.tap("menu:change");
    await c.say(ref);
    await c.say("9876543210");
    expect(c.allText()).toMatch(/already cancelled/);
  });
});

describe("8. unknown prices or unverified services", () => {
  it.each([
    "What are your consultation charges?",
    "How much does a home visit cost?",
    "Do you accept insurance?",
  ])("'%s' gets the standard fallback, never a price", async (q) => {
    const c = new Conversation();
    await c.say(q);
    expect(c.allText()).toContain(UNKNOWN_FALLBACK);
    expect(c.allText()).not.toMatch(/₹|\brs\.?\s?\d|\d+\s?(rupees|inr)/i);
  });

  it("service areas and specific treatments are not invented", async () => {
    const c = new Conversation();
    await c.say("Which areas do you cover for home visits?");
    expect(c.allText()).toContain(UNKNOWN_FALLBACK);
    await c.say("Do you offer stroke rehab and sports injury treatment?");
    expect(c.allText()).toMatch(/don't have a verified list/);
    expect(c.allText()).toContain(UNKNOWN_FALLBACK);
  });

  it("answers verified facts: phone, address, hours, home visits, female therapist", async () => {
    const c = new Conversation();
    await c.say("What is your contact number?");
    expect(c.allText()).toContain("077158 77047");
    await c.say("Where is the clinic located?");
    expect(c.allText()).toContain("Yediyur, Jayanagar 6th Block");
    await c.say("What are your opening hours?");
    expect(c.allText()).toMatch(/Open 24 hours.*confirmed by the clinic/s);
    await c.say("Do you provide physiotherapy at home?");
    expect(c.allText().trim()).toMatch(/^Yes/);
    await c.say("Can I request a female physiotherapist?");
    expect(c.allText()).toMatch(/can't guarantee/);
  });

  it("unrecognised questions are not guessed", async () => {
    const c = new Conversation();
    await c.say("Do you sell protein supplements?");
    expect(c.allText()).toContain(UNKNOWN_FALLBACK);
  });

  it("FAQ asked mid-booking is answered and the flow resumes at the same step", async () => {
    const c = new Conversation();
    await c.tap("menu:book");
    await c.say("Anil");
    await c.say("How much do you charge?");
    expect(c.allText()).toContain(UNKNOWN_FALLBACK);
    expect(c.state.step).toBe("book_phone");
  });
});

describe("9. medical diagnosis and urgent symptoms", () => {
  it.each(["Can you diagnose my knee pain?", "Which exercises should I do for sciatica?", "Should I take painkillers?"])(
    "declines '%s' without giving advice",
    async (q) => {
      const c = new Conversation();
      await c.say(q);
      expect(c.allText()).toMatch(/can't diagnose/);
      expect(c.allText()).not.toMatch(/\b(you have|try (doing|these)|take \d|mg\b)/i);
    },
  );

  it.each(["I have chest pain and can't breathe", "My father fell and can't move his legs", "sudden numbness on one side of face"])(
    "'%s' triggers urgent-care advice, even mid-booking",
    async (q) => {
      const c = new Conversation();
      await c.tap("menu:book");
      await c.say(q);
      const urgent = c.last.messages.find((m) => m.kind === "urgent");
      expect(urgent?.text).toMatch(/112/);
      expect(c.last.quickReplies.some((r) => r.href === "tel:112")).toBe(true);
      expect(c.state.step).toBe("book_name");
    },
  );
});

describe("11. integrations not configured", () => {
  it("with EMAIL_MODE=disabled the enquiry is saved and the alert is visibly NOT_CONFIGURED", async () => {
    process.env.EMAIL_MODE = "disabled";
    const { resetEnvCache } = await import("@/lib/env");
    resetEnvCache();
    try {
      await completeBooking(new Conversation());
      const [log] = await getDb().select().from(notificationLogs);
      expect(log.status).toBe("NOT_CONFIGURED");
      expect(await getDb().select().from(enquiries)).toHaveLength(1);
    } finally {
      process.env.EMAIL_MODE = "test";
      resetEnvCache();
    }
  });

  it("smtp mode with missing credentials reports exactly what is missing", async () => {
    process.env.EMAIL_MODE = "smtp";
    process.env.SMTP_HOST = "";
    const { resetEnvCache } = await import("@/lib/env");
    const { emailConfigState } = await import("@/lib/notify/email");
    resetEnvCache();
    try {
      const s = emailConfigState();
      expect(s.ready).toBe(false);
      expect(s.reason).toContain("SMTP_HOST");
    } finally {
      process.env.EMAIL_MODE = "test";
      resetEnvCache();
    }
  });

  it("AI is off without a key, and a failing AI provider never breaks the chat", async () => {
    const { aiStatus, setClassifier } = await import("@/lib/ai/classifier");
    expect(aiStatus().active).toBe(false);
    setClassifier({ name: "broken", classify: async () => null });
    const c = new Conversation();
    await c.say("qwerty asdf");
    expect(c.allText()).toContain(UNKNOWN_FALLBACK);
  });

  it("AI labels can only route to verified templates", async () => {
    const { setClassifier } = await import("@/lib/ai/classifier");
    setClassifier({ name: "fake", classify: async () => "faq:prices" });
    const { engineDeps } = await import("@/lib/chat/handler");
    const c = new Conversation(engineDeps());
    await c.say("kitna lagega bhai");
    expect(c.allText().trim()).toBe(UNKNOWN_FALLBACK);
  });
});

describe("edit before submit", () => {
  it("lets the patient correct a field from the summary", async () => {
    const c = new Conversation();
    await c.tap("menu:book");
    for (const v of ["Sunita", "9876543210", addDaysIso(4)]) await c.say(v);
    await c.tap("time:Any time");
    await c.say("Banashankari");
    await c.say("Neck stiffness");
    await c.tap("pref:NO_PREFERENCE");
    await c.tap("consent:yes");
    await c.tap("edit:book_locality");
    await c.say("Jayanagar 9th Block");
    expect(c.state.step).toBe("book_confirm");
    const s = c.last.messages.find((m) => m.kind === "summary")!;
    expect(s.fields!.find((f) => f.label === "Locality")!.value).toBe("Jayanagar 9th Block");
  });
});
