import { describe, expect, it } from "vitest";
import { parseDate, validateName, validatePhone, validatePreferredDate } from "@/lib/validation";
import { csvCell } from "@/lib/csv";
import { matchFaq } from "@/lib/chat/faq";
import { asksForMedicalAdvice, isUrgent } from "@/lib/chat/safety";
import { generateReference } from "@/lib/enquiries/service";

describe("phone validation", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["080 2345 6789", "+918023456789"],
  ])("accepts %s", (input, out) => {
    expect(validatePhone(input)).toEqual({ ok: true, value: out });
  });
  it.each(["12345", "5876543210", "98765432101", "abcdefghij", "+1 415 555 0100"])("rejects %s", (input) => {
    expect(validatePhone(input).ok).toBe(false);
  });
});

describe("date parsing (today = 2026-10-19, a Monday)", () => {
  const today = "2026-10-19";
  it.each([
    ["today", "2026-10-19"],
    ["tomorrow", "2026-10-20"],
    ["24/11/2026", "2026-11-24"],
    ["24-11", "2026-11-24"],
    ["2026-11-24", "2026-11-24"],
    ["24th Nov", "2026-11-24"],
    ["Nov 24", "2026-11-24"],
    ["next friday", "2026-10-23"],
    ["monday", "2026-10-26"],
    ["5 jan", "2027-01-05"],
  ])("%s → %s", (input, out) => expect(parseDate(input, today)).toBe(out));
  it.each(["31/02/2026", "soon", "13/13/2026", ""])("rejects %s", (input) => expect(parseDate(input, today)).toBeNull());
  it("enforces window", () => {
    expect(validatePreferredDate("2026-10-18", today, 90).ok).toBe(false);
    expect(validatePreferredDate("2027-03-01", today, 90).ok).toBe(false);
    expect(validatePreferredDate("2026-12-01", today, 90).ok).toBe(true);
  });
});

describe("names", () => {
  it("accepts Indian names with initials and dots", () => {
    expect(validateName("K. S. Lakshmi").ok).toBe(true);
    expect(validateName("ಅನಿತಾ").ok).toBe(true);
  });
  it("rejects markup and digits", () => {
    expect(validateName("<b>x</b>").ok).toBe(false);
    expect(validateName("12").ok).toBe(false);
  });
});

describe("intent rules", () => {
  it("does not mistake symptoms for price questions", () => {
    expect(matchFaq("I feel pain in my knee")).not.toBe("prices");
    expect(matchFaq("What are your fees?")).toBe("prices");
  });
  it("flags urgent phrases and medical-advice requests", () => {
    expect(isUrgent("severe bleeding from the wound")).toBe(true);
    expect(isUrgent("mild knee pain while walking")).toBe(false);
    expect(isUrgent("Do you offer stroke rehab?")).toBe(false);
    expect(isUrgent("my mother needs physio after her stroke last year")).toBe(false);
    expect(isUrgent("my father had a stroke in March and needs rehab at home")).toBe(false);
    expect(isUrgent("I think my father is having a stroke")).toBe(true);
    expect(asksForMedicalAdvice("Is it a slipped disc?")).toBe(true);
    expect(asksForMedicalAdvice("I'd like a home visit")).toBe(false);
  });
});

describe("misc", () => {
  it("references are well-formed and unambiguous", () => {
    for (let i = 0; i < 200; i++) expect(generateReference("2026-10-19")).toMatch(/^PTH-261019-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("CSV cells neutralise formula injection", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91")).toBe("'+91");
    expect(csvCell("a,b")).toBe('"a,b"');
  });
});
