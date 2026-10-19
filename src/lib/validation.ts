import { z } from "zod";

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Trim, collapse whitespace and strip control characters. */
export function clean(input: string, max = 500): string {
  return input.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validateName(input: string): FieldResult<string> {
  const v = clean(input, 200);
  if (v.length < 2) return { ok: false, error: "Please enter the patient's name (at least 2 letters)." };
  if (v.length > 120) return { ok: false, error: "That name is a little long — please keep it under 120 characters." };
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'\-]*$/u.test(v))
    return { ok: false, error: "Please use letters only for the name (spaces, dots, apostrophes and hyphens are fine)." };
  return { ok: true, value: v };
}

/**
 * Indian phone numbers. Accepts 10-digit mobiles (6–9 start) with optional +91 / 91 / 0
 * prefix, and Bengaluru landlines written with the 080 STD code.
 * Returns the number in E.164 form (+91XXXXXXXXXX).
 */
export function validatePhone(input: string): FieldResult<string> {
  const digits = input.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits))
    return { ok: false, error: "Please enter a phone number using digits only, e.g. 98765 43210." };
  let d = digits.replace(/^\+/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10)
    return { ok: false, error: "Please enter a 10-digit Indian phone number, e.g. 98765 43210." };
  const isMobile = /^[6-9]\d{9}$/.test(d);
  const isBlrLandline = /^80\d{8}$/.test(d);
  if (!isMobile && !isBlrLandline)
    return { ok: false, error: "That doesn't look like a valid Indian mobile number. Please check and try again." };
  return { ok: true, value: `+91${d}` };
}

export function formatPhone(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/** Today's date (YYYY-MM-DD) in the clinic's time zone. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parses common Indian date styles: DD/MM/YYYY, YYYY-MM-DD, "12 Nov", "today", "tomorrow", "next monday". */
export function parseDate(input: string, today: string): string | null {
  const s = clean(input, 60).toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ");
  const [ty] = today.split("-").map(Number);
  if (/^(today|now)$/.test(s)) return today;
  if (/^(tomorrow|tmrw|tomorow|tommorow)$/.test(s)) return addDays(today, 1);
  if (/^day after tomorrow$/.test(s)) return addDays(today, 2);

  const wd = s.match(/^(?:next |this |on )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*$/);
  if (wd) {
    const target = WEEKDAYS.findIndex((w) => w.startsWith(wd[1].slice(0, 3)));
    const cur = new Date(`${today}T00:00:00Z`).getUTCDay();
    const diff = (target - cur + 7) % 7 || 7;
    return addDays(today, diff);
  }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : ty;
    if (y < 100) y += 2000;
    if (!isRealDate(y, mo, d)) return null;
    let out = iso(y, mo, d);
    if (!m[3] && out < today) out = iso(y + 1, mo, d);
    return out;
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/) ?? null;
  const m2 = s.match(/^([a-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (m || m2) {
    const day = Number(m ? m[1] : m2![2]);
    const monName = (m ? m[2] : m2![1]).slice(0, 3);
    const mo = MONTHS.indexOf(monName) + 1;
    if (mo === 0) return null;
    const yStr = m ? m[3] : m2![3];
    let y = yStr ? Number(yStr) : ty;
    if (!isRealDate(y, mo, day)) return null;
    let out = iso(y, mo, day);
    if (!yStr && out < today) {
      y += 1;
      out = iso(y, mo, day);
    }
    return out;
  }
  return null;
}

export function validatePreferredDate(input: string, today: string, maxAdvanceDays: number): FieldResult<string> {
  const parsed = parseDate(input, today);
  if (!parsed)
    return { ok: false, error: 'I couldn\'t read that date. Please use a format like 24/11/2026, "tomorrow" or "next Monday".' };
  if (parsed < today) return { ok: false, error: "That date has already passed. Please choose today or a future date." };
  if (parsed > addDays(today, maxAdvanceDays))
    return { ok: false, error: `Please choose a date within the next ${maxAdvanceDays} days. For later dates, please call the clinic.` };
  return { ok: true, value: parsed };
}

export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export const TIME_OPTIONS = [
  "Morning (8 am – 12 pm)",
  "Afternoon (12 pm – 4 pm)",
  "Evening (4 pm – 8 pm)",
  "Any time",
] as const;

export function validatePreferredTime(input: string): FieldResult<string> {
  const v = clean(input, 120);
  if (v.length < 2) return { ok: false, error: "Please tell me a preferred time or range, e.g. \"10 am\" or \"evening\"." };
  if (v.length > 80) return { ok: false, error: "Please keep the preferred time short (under 80 characters)." };
  return { ok: true, value: v };
}

export function validateLocality(input: string): FieldResult<string> {
  const v = clean(input, 200);
  if (v.length < 2) return { ok: false, error: "Please enter the area or locality in Bengaluru for the home visit, e.g. Jayanagar." };
  if (v.length > 120) return { ok: false, error: "Please keep the locality under 120 characters — just the area name is enough." };
  if (!/\p{L}/u.test(v)) return { ok: false, error: "Please enter the area name, e.g. JP Nagar or Banashankari." };
  return { ok: true, value: v };
}

export function validateReason(input: string): FieldResult<string> {
  const v = clean(input, 800);
  if (v.length < 3) return { ok: false, error: "Please describe briefly, in your own words, why you'd like physiotherapy." };
  if (v.length > 500) return { ok: false, error: "Please keep this under 500 characters — a short description is enough." };
  return { ok: true, value: v };
}

export const REFERENCE_PATTERN = /^PTH-\d{6}-[A-HJ-NP-Z2-9]{4}$/;

export function normaliseReference(input: string): string {
  return clean(input, 40).toUpperCase().replace(/\s+/g, "");
}

/** Server-side schema for a complete enquiry submission. */
export function enquirySubmissionSchema(today: string, maxAdvanceDays: number) {
  const fromField = <T,>(fn: (s: string) => FieldResult<T>) =>
    z.string().transform((s, ctx) => {
      const r = fn(s);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.error });
        return z.NEVER;
      }
      return r.value;
    });
  return z.object({
    patientName: fromField(validateName),
    contactNumber: fromField(validatePhone),
    preferredDate: fromField((s) => validatePreferredDate(s, today, maxAdvanceDays)),
    preferredTime: fromField(validatePreferredTime),
    locality: fromField(validateLocality),
    serviceRequirement: fromField(validateReason),
    therapistPreference: z.enum(["NO_PREFERENCE", "FEMALE", "MALE"]),
    consent: z.literal(true, { message: "Consent is required to submit a request." }),
    consentAt: z.date(),
  });
}

export type EnquirySubmission = z.infer<ReturnType<typeof enquirySubmissionSchema>>;
