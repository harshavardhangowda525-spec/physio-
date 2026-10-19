import { randomUUID } from "crypto";
import { BUSINESS, CONSENT_TEXT, EMERGENCY, GREETING, SUBMITTED_MESSAGE, UNKNOWN_FALLBACK } from "@/lib/business";
import type { AiLabel } from "@/lib/ai/classifier";
import type { Enquiry } from "@/db/schema";
import { DatabaseUnavailableError } from "@/lib/errors";
import { PATIENT_STATUS_TEXT, type SubmitInput, type SubmitResult } from "@/lib/enquiries/service";
import { PREFERENCE_LABEL } from "@/lib/notify/messages";
import {
  clean,
  formatDate,
  formatPhone,
  normaliseReference,
  REFERENCE_PATTERN,
  TIME_OPTIONS,
  validateLocality,
  validateName,
  validatePhone,
  validatePreferredDate,
  validatePreferredTime,
  validateReason,
  type FieldResult,
} from "@/lib/validation";
import { answerFaq, matchFaq, type FaqIntent } from "./faq";
import { asksForMedicalAdvice, isUrgent, MEDICAL_ADVICE_REPLY, URGENT_REPLY } from "./safety";
import type { BotMessage, ChatResponse, ChatState, ChatTurnInput, Draft, InputHint, Preference, QuickReply, Step } from "./types";

export type EngineDeps = {
  today: string;
  maxAdvanceDays: number;
  aiEnabled: boolean;
  classify: (text: string) => Promise<AiLabel | null>;
  submit: (input: SubmitInput) => Promise<SubmitResult>;
  findForPatient: (reference: string, phone: string) => Promise<Enquiry | null>;
  requestChange: (
    reference: string,
    phone: string,
    kind: "CANCEL" | "RESCHEDULE",
    message: string,
  ) => Promise<{ ok: true; enquiry: Enquiry } | { ok: false; reason: "not_found" | "closed" }>;
};

export type EngineResult = { state: ChatState; response: ChatResponse };

export function initialState(): ChatState {
  return { v: 1, step: "menu", draft: {}, editing: false, lookup: {}, failedLookups: 0 };
}

const CALL: QuickReply = { label: `Call ${BUSINESS.phoneDisplay}`, href: `tel:${BUSINESS.phoneTel}`, variant: "ghost" };
const MENU_REPLIES: QuickReply[] = [
  { label: "Request a home physiotherapy appointment", action: "menu:book", variant: "primary" },
  { label: "Ask about physiotherapy services", action: "menu:faq" },
  { label: "Check appointment-request status", action: "menu:status" },
  { label: "Change or cancel a request", action: "menu:change" },
  { label: "Speak with the clinic team", action: "menu:human" },
];
const BACK_TO_MENU: QuickReply = { label: "Main menu", action: "menu:show", variant: "ghost" };

const BOOKING_STEPS: Step[] = [
  "book_name",
  "book_phone",
  "book_date",
  "book_time",
  "book_locality",
  "book_reason",
  "book_pref",
  "book_consent",
];
const STEP_LABEL: Partial<Record<Step, string>> = {
  book_name: "Patient name",
  book_phone: "Contact number",
  book_date: "Preferred date",
  book_time: "Preferred time",
  book_locality: "Locality",
  book_reason: "Reason for visit",
  book_pref: "Therapist preference",
  book_consent: "Consent",
  book_confirm: "Review & submit",
  book_edit_choose: "Review & submit",
};

const MAX_FAILED_LOOKUPS = 5;
const FAQ_TOPICS: { label: string; intent: FaqIntent }[] = [
  { label: "Do you visit at home?", intent: "home_visits" },
  { label: "Which areas do you cover?", intent: "service_areas" },
  { label: "What treatments are available?", intent: "services" },
  { label: "Charges & fees", intent: "prices" },
  { label: "Opening hours", intent: "hours" },
  { label: "Clinic address", intent: "location" },
  { label: "Female physiotherapist?", intent: "female_therapist" },
  { label: "Change or cancel a request", intent: "change_cancel" },
];

function text(t: string, kind: BotMessage["kind"] = "text"): BotMessage {
  return { kind, text: t };
}

function isQuestionLike(s: string): boolean {
  return /\?\s*$/.test(s) || /^(what|how|do|does|can|could|where|which|is|are|when|will|would|who|why)\b/i.test(s);
}

const today = (d: EngineDeps) => d.today;

// ---------- prompts ----------

type Prompt = { messages: BotMessage[]; quickReplies: QuickReply[]; input: InputHint };

function prompt(step: Step, state: ChatState, deps: EngineDeps): Prompt {
  const d = state.draft;
  const none: InputHint = { type: "none", placeholder: "Choose an option above" };
  switch (step) {
    case "menu":
      return {
        messages: [text("What would you like to do?")],
        quickReplies: MENU_REPLIES,
        input: { type: "text", placeholder: "Type a question or choose an option" },
      };
    case "book_name":
      return {
        messages: [text("Let's start your home physiotherapy request. What is the patient's full name?")],
        quickReplies: [BACK_TO_MENU],
        input: { type: "text", placeholder: "Patient's full name", maxLength: 120 },
      };
    case "book_phone":
      return {
        messages: [text(`Thanks${d.patientName ? `, ${d.patientName.split(" ")[0]}` : ""}. What phone number should the clinic call?`)],
        quickReplies: [BACK_TO_MENU],
        input: { type: "tel", placeholder: "10-digit mobile, e.g. 98765 43210", maxLength: 20 },
      };
    case "book_date":
      return {
        messages: [text("Which date would you prefer for the home visit? This is a preference — the clinic will confirm availability.")],
        quickReplies: [
          { label: "Tomorrow", action: "date:tomorrow" },
          { label: "Day after tomorrow", action: "date:day after tomorrow" },
          BACK_TO_MENU,
        ],
        input: { type: "date", placeholder: "e.g. 24/11/2026 or next Monday", maxLength: 40 },
      };
    case "book_time":
      return {
        messages: [text("What time or time range suits you best?")],
        quickReplies: TIME_OPTIONS.map((t) => ({ label: t, action: `time:${t}` })),
        input: { type: "text", placeholder: "Or type a time, e.g. after 5 pm", maxLength: 80 },
      };
    case "book_locality":
      return {
        messages: [text("Which area or locality in Bengaluru is the home visit for?")],
        quickReplies: [BACK_TO_MENU],
        input: { type: "text", placeholder: "e.g. Jayanagar 4th Block", maxLength: 120 },
      };
    case "book_reason":
      return {
        messages: [
          text(
            "In your own words, briefly, why would you like physiotherapy? (For example: \"knee pain while walking\" or \"help after hip surgery\".) Please don't include test reports or ID numbers.",
          ),
        ],
        quickReplies: [BACK_TO_MENU],
        input: { type: "textarea", placeholder: "A short description is enough", maxLength: 500 },
      };
    case "book_pref":
      return {
        messages: [text("Do you have a preference for a female or male physiotherapist? The clinic will tell you if it can be accommodated.")],
        quickReplies: [
          { label: "No preference", action: "pref:NO_PREFERENCE", variant: "primary" },
          { label: "Female physiotherapist", action: "pref:FEMALE" },
          { label: "Male physiotherapist", action: "pref:MALE" },
        ],
        input: none,
      };
    case "book_consent":
      return {
        messages: [{ kind: "info", title: "Your consent", text: `${CONSENT_TEXT} Read the Privacy notice for how your details are used and how to request deletion.` }],
        quickReplies: [
          { label: "I agree", action: "consent:yes", variant: "primary" },
          { label: "I don't agree", action: "consent:no", variant: "ghost" },
        ],
        input: none,
      };
    case "book_confirm":
      return {
        messages: [
          {
            kind: "summary",
            title: "Please check your request",
            text: "Is everything correct? Submitting sends a request to the clinic — it is not a confirmed booking.",
            fields: summaryFields(d),
          },
        ],
        quickReplies: [
          { label: "Submit request", action: "confirm:submit", variant: "primary" },
          { label: "Edit details", action: "confirm:edit" },
          { label: "Discard", action: "confirm:discard", variant: "danger" },
        ],
        input: none,
      };
    case "book_edit_choose":
      return {
        messages: [text("Which detail would you like to change?")],
        quickReplies: [
          ...BOOKING_STEPS.filter((s) => s !== "book_consent").map((s) => ({ label: STEP_LABEL[s]!, action: `edit:${s}` })),
          { label: "Back to summary", action: "edit:done", variant: "ghost" as const },
        ],
        input: none,
      };
    case "status_ref":
      return {
        messages: [text("Please enter your enquiry reference number (it looks like PTH-261016-AB2C).")],
        quickReplies: [BACK_TO_MENU],
        input: { type: "text", placeholder: "PTH-XXXXXX-XXXX", maxLength: 20 },
      };
    case "status_phone":
    case "change_phone":
      return {
        messages: [text("And the phone number you used for that request? (We check both, to protect your privacy.)")],
        quickReplies: [BACK_TO_MENU],
        input: { type: "tel", placeholder: "Phone number used in the request", maxLength: 20 },
      };
    case "change_ref":
      return {
        messages: [text("To change or cancel a request, please enter its reference number (e.g. PTH-261016-AB2C).")],
        quickReplies: [BACK_TO_MENU],
        input: { type: "text", placeholder: "PTH-XXXXXX-XXXX", maxLength: 20 },
      };
    case "change_kind":
      return {
        messages: [text("Would you like to reschedule or cancel this request?")],
        quickReplies: [
          { label: "Reschedule", action: "kind:RESCHEDULE", variant: "primary" },
          { label: "Cancel request", action: "kind:CANCEL", variant: "danger" },
          BACK_TO_MENU,
        ],
        input: none,
      };
    case "change_message":
      return state.lookup.kind === "RESCHEDULE"
        ? {
            messages: [text("What new date and time would you prefer? The clinic will contact you to confirm — the change isn't confirmed until then.")],
            quickReplies: [BACK_TO_MENU],
            input: { type: "text", placeholder: "e.g. Saturday morning", maxLength: 200 },
          }
        : {
            messages: [text("Would you like to tell the clinic why you're cancelling? This is optional.")],
            quickReplies: [{ label: "Skip and cancel", action: "msg:skip", variant: "danger" }, BACK_TO_MENU],
            input: { type: "text", placeholder: "Optional reason", maxLength: 200 },
          };
  }
  void deps;
}

function summaryFields(d: Draft) {
  return [
    { label: "Patient", value: d.patientName ?? "—", editAction: "edit:book_name" },
    { label: "Phone", value: d.contactNumber ? formatPhone(d.contactNumber) : "—", editAction: "edit:book_phone" },
    { label: "Preferred date", value: d.preferredDate ? formatDate(d.preferredDate) : "—", editAction: "edit:book_date" },
    { label: "Preferred time", value: d.preferredTime ?? "—", editAction: "edit:book_time" },
    { label: "Locality", value: d.locality ?? "—", editAction: "edit:book_locality" },
    { label: "Reason", value: d.serviceRequirement ?? "—", editAction: "edit:book_reason" },
    { label: "Therapist preference", value: d.therapistPreference ? PREFERENCE_LABEL[d.therapistPreference] : "—", editAction: "edit:book_pref" },
  ];
}

function progressFor(step: Step) {
  const i = BOOKING_STEPS.indexOf(step);
  if (i >= 0) return { current: i + 1, total: BOOKING_STEPS.length + 1, label: STEP_LABEL[step]! };
  if (step === "book_confirm" || step === "book_edit_choose")
    return { current: BOOKING_STEPS.length + 1, total: BOOKING_STEPS.length + 1, label: "Review & submit" };
  return undefined;
}

function respond(state: ChatState, before: BotMessage[], deps: EngineDeps, opts: { skipPrompt?: boolean; extraReplies?: QuickReply[] } = {}): EngineResult {
  const p = prompt(state.step, state, deps);
  const messages = opts.skipPrompt ? before : [...before, ...p.messages];
  const quickReplies = [...(opts.extraReplies ?? []), ...p.quickReplies];
  return {
    state,
    response: { messages, quickReplies, input: p.input, progress: progressFor(state.step), mode: { ai: deps.aiEnabled } },
  };
}

function goto(state: ChatState, step: Step): ChatState {
  return { ...state, step };
}

function nextBookingStep(state: ChatState, current: Step): ChatState {
  if (state.editing) return { ...state, step: "book_confirm", editing: false };
  const i = BOOKING_STEPS.indexOf(current);
  return { ...state, step: BOOKING_STEPS[i + 1] ?? "book_confirm" };
}

function resetToMenu(state: ChatState): ChatState {
  return { ...initialState(), failedLookups: state.failedLookups };
}

// ---------- entry points ----------

export function welcome(deps: EngineDeps): EngineResult {
  const state = initialState();
  return {
    state,
    response: {
      messages: [text(GREETING)],
      quickReplies: MENU_REPLIES,
      input: { type: "text", placeholder: "Type a question or choose an option" },
      mode: { ai: deps.aiEnabled },
    },
  };
}

export async function step(stateIn: ChatState, input: ChatTurnInput, deps: EngineDeps): Promise<EngineResult> {
  let state: ChatState = { ...stateIn, draft: { ...stateIn.draft }, lookup: { ...stateIn.lookup } };
  const action = input.action?.trim() ?? "";
  const raw = clean(input.text ?? "", 800);

  // ----- global actions -----
  if (action === "menu:show" || /^(menu|main menu|start over|restart|home)$/i.test(raw)) {
    const discarded = state.step.startsWith("book_") && Object.keys(state.draft).length > 0;
    state = resetToMenu(state);
    return respond(state, discarded ? [text("No problem — nothing has been submitted.")] : [], deps);
  }

  if (raw) {
    // Safety first: urgent symptoms override every flow.
    if (isUrgent(raw)) {
      return respond(state, [{ kind: "urgent", title: "Please seek urgent care", text: URGENT_REPLY }], deps, {
        skipPrompt: state.step === "menu",
        extraReplies: [
          { label: `Call ${EMERGENCY.general}`, href: `tel:${EMERGENCY.general}`, variant: "danger" },
          { label: `Call ${EMERGENCY.ambulance} (ambulance)`, href: `tel:${EMERGENCY.ambulance}`, variant: "danger" },
          ...(state.step === "menu" ? MENU_REPLIES.slice(0, 1) : []),
        ],
      });
    }
    // Questions asked mid-flow: answer, then re-ask the current question.
    if (state.step !== "menu" && state.step !== "book_reason" && isQuestionLike(raw)) {
      if (asksForMedicalAdvice(raw)) return respond(state, [text(MEDICAL_ADVICE_REPLY)], deps);
      const intent = matchFaq(raw);
      if (intent) return respond(state, [text(answerFaq(intent)), text("Now, back to your request:")], deps);
    }
  }

  switch (state.step) {
    case "menu":
      return handleMenu(state, raw, action, deps);
    case "book_name":
      return field(state, "book_name", raw, validateName, (s, v) => (s.draft.patientName = v), deps);
    case "book_phone":
      return field(state, "book_phone", raw, validatePhone, (s, v) => (s.draft.contactNumber = v), deps);
    case "book_date": {
      const value = action.startsWith("date:") ? action.slice(5) : raw;
      const r = validatePreferredDate(value, today(deps), deps.maxAdvanceDays);
      if (!r.ok) return respond(state, [text(r.error, "error")], deps, { skipPrompt: true, extraReplies: prompt("book_date", state, deps).quickReplies });
      state.draft.preferredDate = r.value;
      const ack = text(`Noted ${formatDate(r.value)} as your preferred date. This is a preference only — the clinic hasn't confirmed availability yet.`);
      return respond(nextBookingStep(state, "book_date"), [ack], deps);
    }
    case "book_time": {
      const value = action.startsWith("time:") ? action.slice(5) : raw;
      return field(state, "book_time", value, validatePreferredTime, (s, v) => (s.draft.preferredTime = v), deps);
    }
    case "book_locality": {
      const r = validateLocality(raw);
      if (!r.ok) return respond(state, [text(r.error, "error")], deps, { skipPrompt: true, extraReplies: [BACK_TO_MENU] });
      state.draft.locality = r.value;
      const ack = text(`Thanks. The clinic will confirm whether a home visit is possible in ${r.value}.`);
      return respond(nextBookingStep(state, "book_locality"), [ack], deps);
    }
    case "book_reason": {
      const r = validateReason(raw);
      if (!r.ok) return respond(state, [text(r.error, "error")], deps, { skipPrompt: true, extraReplies: [BACK_TO_MENU] });
      state.draft.serviceRequirement = r.value;
      const pre: BotMessage[] = asksForMedicalAdvice(raw)
        ? [text("I've noted your description. I can't diagnose or advise on treatment, but the clinic's physiotherapist can discuss this with you.")]
        : [text("Thank you, I've noted that.")];
      return respond(nextBookingStep(state, "book_reason"), pre, deps);
    }
    case "book_pref": {
      const pref = parsePreference(action, raw);
      if (!pref) return respond(state, [text("Please choose one of the options below.", "error")], deps, { skipPrompt: true, extraReplies: prompt("book_pref", state, deps).quickReplies });
      state.draft.therapistPreference = pref;
      return respond(nextBookingStep(state, "book_pref"), [], deps);
    }
    case "book_consent": {
      const yes = action === "consent:yes" || /^(yes|y|i agree|agree|ok|okay)$/i.test(raw);
      const no = action === "consent:no" || /^(no|n|i don'?t agree|disagree)$/i.test(raw);
      if (yes) {
        state.draft.consentAt = new Date().toISOString();
        state.idempotencyKey ??= randomUUID();
        return respond({ ...state, step: "book_confirm", editing: false }, [], deps);
      }
      if (no) {
        state = resetToMenu(state);
        return respond(
          state,
          [text(`Understood — without your consent I can't send your details to the clinic, so nothing has been submitted or stored. You're welcome to call the clinic directly on ${BUSINESS.phoneDisplay}.`)],
          deps,
          { extraReplies: [CALL] },
        );
      }
      return respond(state, [text("Please choose \"I agree\" or \"I don't agree\".", "error")], deps, { skipPrompt: true, extraReplies: prompt("book_consent", state, deps).quickReplies });
    }
    case "book_confirm":
      return handleConfirm(state, raw, action, deps);
    case "book_edit_choose": {
      if (action === "edit:done") return respond(goto(state, "book_confirm"), [], deps);
      const target = action.startsWith("edit:") ? (action.slice(5) as Step) : null;
      if (target && BOOKING_STEPS.includes(target) && target !== "book_consent") {
        return respond({ ...state, step: target, editing: true }, [], deps);
      }
      return respond(state, [text("Please choose which detail to change.", "error")], deps, { skipPrompt: true, extraReplies: prompt("book_edit_choose", state, deps).quickReplies });
    }
    case "status_ref":
    case "change_ref": {
      const ref = normaliseReference(raw);
      if (!REFERENCE_PATTERN.test(ref))
        return respond(state, [text("That reference doesn't look right. It should look like PTH-261016-AB2C.", "error")], deps, { skipPrompt: true, extraReplies: [BACK_TO_MENU] });
      state.lookup.reference = ref;
      return respond(goto(state, state.step === "status_ref" ? "status_phone" : "change_phone"), [], deps);
    }
    case "status_phone":
    case "change_phone":
      return handleLookupPhone(state, raw, deps);
    case "change_kind": {
      const kind = action === "kind:CANCEL" || /^cancel/i.test(raw) ? "CANCEL" : action === "kind:RESCHEDULE" || /^resched|change/i.test(raw) ? "RESCHEDULE" : null;
      if (!kind) return respond(state, [text("Please choose Reschedule or Cancel.", "error")], deps, { skipPrompt: true, extraReplies: prompt("change_kind", state, deps).quickReplies });
      state.lookup.kind = kind;
      return respond(goto(state, "change_message"), [], deps);
    }
    case "change_message":
      return handleChangeMessage(state, raw, action, deps);
  }
}

function field<T extends string>(
  state: ChatState,
  current: Step,
  value: string,
  validate: (s: string) => FieldResult<T>,
  assign: (s: ChatState, v: T) => void,
  deps: EngineDeps,
): EngineResult {
  const r = validate(value);
  if (!r.ok) return respond(state, [text(r.error, "error")], deps, { skipPrompt: true, extraReplies: prompt(current, state, deps).quickReplies });
  assign(state, r.value);
  return respond(nextBookingStep(state, current), [], deps);
}

function parsePreference(action: string, raw: string): Preference | null {
  if (action.startsWith("pref:")) {
    const v = action.slice(5);
    return v === "FEMALE" || v === "MALE" || v === "NO_PREFERENCE" ? v : null;
  }
  if (/female|lady|woman|women/i.test(raw)) return "FEMALE";
  if (/\b(male|man|gents?)\b/i.test(raw)) return "MALE";
  if (/no( preference)?|any|none|doesn'?t matter|either/i.test(raw)) return "NO_PREFERENCE";
  return null;
}

async function handleMenu(state: ChatState, raw: string, action: string, deps: EngineDeps): Promise<EngineResult> {
  let route: string | null = action.startsWith("menu:") ? action.slice(5) : action.startsWith("faq:") ? action : null;

  if (!route && raw) {
    if (asksForMedicalAdvice(raw)) route = "medical";
    else if (isQuestionLike(raw) && matchFaq(raw)) route = `faq:${matchFaq(raw)}`;
    else if (/\b(book|appointment|home visit|visit|schedule|request|session)\b/i.test(raw) && !/\b(status|cancel|resched|change)\b/i.test(raw)) route = "book";
    else if (/\b(status|track|check (my )?(request|enquiry|booking))\b/i.test(raw)) route = "status";
    else if (/\b(cancel|resched|postpone|change (my )?(request|booking|appointment))\b/i.test(raw)) route = "change";
    else if (/\b(human|person|someone|staff|team|talk|speak|call me|call back|callback|agent)\b/i.test(raw)) route = "human";
    else if (/^(hi|hello|hey|namaste|namaskara|good (morning|afternoon|evening)|thanks?|thank you|ok|okay)\b/i.test(raw)) route = "greeting";
    else if (matchFaq(raw)) route = `faq:${matchFaq(raw)}`;
    else {
      const label = await deps.classify(raw);
      if (label) {
        route =
          label === "book_appointment" ? "book"
          : label === "check_status" ? "status"
          : label === "change_or_cancel" ? "change"
          : label === "speak_to_team" ? "human"
          : label === "medical_advice" ? "medical"
          : label === "urgent_medical" ? "urgent"
          : label === "greeting" ? "greeting"
          : label.startsWith("faq:") ? label
          : null;
      }
    }
  }

  switch (route) {
    case "book":
      return respond({ ...initialState(), failedLookups: state.failedLookups, step: "book_name" }, [], deps);
    case "status":
      return respond(goto(state, "status_ref"), [], deps);
    case "change":
      return respond(goto(state, "change_ref"), [], deps);
    case "human":
      return respond(
        state,
        [text(`You can speak with the clinic team by calling ${BUSINESS.phoneDisplay} (the clinic is listed as open 24 hours). Or I can take your details as an appointment request and the team will contact you.`)],
        deps,
        { skipPrompt: true, extraReplies: [{ ...CALL, variant: "primary" }, MENU_REPLIES[0], BACK_TO_MENU] },
      );
    case "faq":
      return {
        state,
        response: {
          messages: [text("Here are some common questions — tap one, or type your own.")],
          quickReplies: [...FAQ_TOPICS.map((t) => ({ label: t.label, action: `faq:${t.intent}` })), BACK_TO_MENU],
          input: { type: "text", placeholder: "Type your question" },
          mode: { ai: deps.aiEnabled },
        },
      };
    case "medical":
      return respond(state, [text(MEDICAL_ADVICE_REPLY)], deps, { skipPrompt: true, extraReplies: [MENU_REPLIES[0], CALL, BACK_TO_MENU] });
    case "urgent":
      return respond(state, [{ kind: "urgent", title: "Please seek urgent care", text: URGENT_REPLY }], deps, {
        skipPrompt: true,
        extraReplies: [{ label: `Call ${EMERGENCY.general}`, href: `tel:${EMERGENCY.general}`, variant: "danger" }, BACK_TO_MENU],
      });
    case "greeting":
      return respond(state, [text("Hello! How can I help you today?")], deps);
    default:
      if (route?.startsWith("faq:")) {
        const intent = route.slice(4) as FaqIntent;
        const answer = answerFaq(intent);
        if (!answer) break;
        const offersFallback = answer.includes(UNKNOWN_FALLBACK);
        return respond(state, [text(answer)], deps, {
          skipPrompt: true,
          extraReplies: offersFallback
            ? [{ label: "Submit an enquiry", action: "menu:book", variant: "primary" }, CALL, BACK_TO_MENU]
            : [{ label: "Request an appointment", action: "menu:book", variant: "primary" }, { label: "More questions", action: "menu:faq" }, BACK_TO_MENU],
        });
      }
  }
  // Unrecognised: never guess an answer.
  return respond(state, [text(raw ? UNKNOWN_FALLBACK : "Please choose an option or type your question.")], deps, {
    skipPrompt: true,
    extraReplies: [{ label: "Submit an enquiry", action: "menu:book", variant: "primary" }, CALL, BACK_TO_MENU],
  });
}

async function handleConfirm(state: ChatState, raw: string, action: string, deps: EngineDeps): Promise<EngineResult> {
  if (action === "confirm:edit" || /^edit/i.test(raw)) return respond(goto(state, "book_edit_choose"), [], deps);
  if (action.startsWith("edit:")) {
    const target = action.slice(5) as Step;
    if (BOOKING_STEPS.includes(target) && target !== "book_consent") return respond({ ...state, step: target, editing: true }, [], deps);
  }
  if (action === "confirm:discard" || /^(discard|cancel)$/i.test(raw)) {
    return respond(resetToMenu(state), [text("Your request has been discarded. Nothing was submitted.")], deps);
  }
  if (action !== "confirm:submit" && !/^(submit|yes|confirm|send)$/i.test(raw)) {
    return respond(state, [text("Please choose Submit request, Edit details or Discard.", "error")], deps, { skipPrompt: true, extraReplies: prompt("book_confirm", state, deps).quickReplies });
  }

  const d = state.draft;
  if (!d.consentAt) return respond(goto(state, "book_consent"), [], deps);
  let result: SubmitResult;
  try {
    result = await deps.submit({
      patientName: d.patientName ?? "",
      contactNumber: d.contactNumber ?? "",
      preferredDate: d.preferredDate ?? "",
      preferredTime: d.preferredTime ?? "",
      locality: d.locality ?? "",
      serviceRequirement: d.serviceRequirement ?? "",
      therapistPreference: d.therapistPreference ?? "NO_PREFERENCE",
      consent: true,
      consentAt: new Date(d.consentAt),
      idempotencyKey: state.idempotencyKey,
    });
  } catch (err) {
    const dbDown = err instanceof DatabaseUnavailableError;
    if (!dbDown) console.error("[chat] submit failed:", err);
    return respond(
      state,
      [
        {
          kind: "error",
          title: "We couldn't submit your request",
          text: `${dbDown ? "Our system is temporarily unavailable." : "Something went wrong on our side."} Your request has NOT been submitted. Please try again in a moment, or call the clinic on ${BUSINESS.phoneDisplay}.`,
        },
      ],
      deps,
      { skipPrompt: true, extraReplies: [{ label: "Try again", action: "confirm:submit", variant: "primary" }, { ...CALL }, BACK_TO_MENU] },
    );
  }

  if (!result.ok) {
    const fieldToStep: Record<string, Step> = {
      patientName: "book_name",
      contactNumber: "book_phone",
      preferredDate: "book_date",
      preferredTime: "book_time",
      locality: "book_locality",
      serviceRequirement: "book_reason",
      therapistPreference: "book_pref",
      consent: "book_consent",
    };
    const [firstKey, firstMsg] = Object.entries(result.errors)[0] ?? ["form", "Please check your details."];
    const target = fieldToStep[firstKey] ?? "book_edit_choose";
    return respond({ ...state, step: target, editing: target !== "book_consent" }, [text(firstMsg, "error")], deps);
  }

  const ref = result.enquiry.reference;
  const next = resetToMenu(state);
  return {
    state: next,
    response: {
      messages: [
        { kind: "success", title: "Request submitted", reference: ref, text: SUBMITTED_MESSAGE },
        text(`Please keep your reference number: ${ref}. You can use it here to check the status or to change or cancel your request.`),
      ],
      quickReplies: [{ label: "Check status later", action: "menu:status" }, { label: "Ask a question", action: "menu:faq" }, CALL],
      input: { type: "text", placeholder: "Type a question or choose an option" },
      mode: { ai: deps.aiEnabled },
    },
  };
}

async function handleLookupPhone(state: ChatState, raw: string, deps: EngineDeps): Promise<EngineResult> {
  const p = validatePhone(raw);
  if (!p.ok) return respond(state, [text(p.error, "error")], deps, { skipPrompt: true, extraReplies: [BACK_TO_MENU] });
  if (state.failedLookups >= MAX_FAILED_LOOKUPS) {
    return respond(resetToMenu(state), [text(`For your security I can't look up more requests right now. Please call the clinic on ${BUSINESS.phoneDisplay}.`, "error")], deps, { extraReplies: [CALL] });
  }
  const ref = state.lookup.reference ?? "";
  const isStatus = state.step === "status_phone";
  let found: Enquiry | null;
  try {
    found = await deps.findForPatient(ref, p.value);
  } catch {
    return respond(state, [{ kind: "error", title: "Temporarily unavailable", text: `I can't check requests right now. Please try again shortly or call ${BUSINESS.phoneDisplay}.` }], deps, {
      skipPrompt: true,
      extraReplies: [CALL, BACK_TO_MENU],
    });
  }
  if (!found) {
    const s = { ...resetToMenu(state), failedLookups: state.failedLookups + 1 };
    return respond(s, [text(`I couldn't find a request matching that reference and phone number. Please check both, or call the clinic on ${BUSINESS.phoneDisplay}.`, "error")], deps, {
      skipPrompt: true,
      extraReplies: [{ label: "Try again", action: isStatus ? "menu:status" : "menu:change" }, CALL, BACK_TO_MENU],
    });
  }
  if (isStatus) {
    return respond(
      resetToMenu(state),
      [
        {
          kind: "status",
          title: `Request ${found.reference}`,
          text: PATIENT_STATUS_TEXT[found.status],
          fields: [
            { label: "Preferred date", value: formatDate(found.preferredDate) },
            { label: "Preferred time", value: found.preferredTime },
          ],
        },
      ],
      deps,
      { skipPrompt: true, extraReplies: [{ label: "Change or cancel", action: "menu:change" }, CALL, BACK_TO_MENU] },
    );
  }
  if (found.status === "CANCELLED" || found.status === "COMPLETED") {
    return respond(resetToMenu(state), [text(`Request ${found.reference} is already ${found.status === "CANCELLED" ? "cancelled" : "completed"}, so it can't be changed here. Please call ${BUSINESS.phoneDisplay} if you need help.`)], deps, {
      extraReplies: [CALL],
    });
  }
  state.lookup.phone = p.value;
  return respond(goto(state, "change_kind"), [], deps);
}

async function handleChangeMessage(state: ChatState, raw: string, action: string, deps: EngineDeps): Promise<EngineResult> {
  const kind = state.lookup.kind ?? "RESCHEDULE";
  const message = action === "msg:skip" ? "" : raw;
  if (kind === "RESCHEDULE" && clean(message).length < 2)
    return respond(state, [text("Please tell me the new date and time you'd prefer.", "error")], deps, { skipPrompt: true, extraReplies: [BACK_TO_MENU] });
  let r;
  try {
    r = await deps.requestChange(state.lookup.reference ?? "", state.lookup.phone ?? "", kind, message);
  } catch {
    return respond(state, [{ kind: "error", title: "Temporarily unavailable", text: `I couldn't record that change. Nothing has been changed. Please try again or call ${BUSINESS.phoneDisplay}.` }], deps, {
      skipPrompt: true,
      extraReplies: [CALL, BACK_TO_MENU],
    });
  }
  const done = resetToMenu(state);
  if (!r.ok) return respond(done, [text(`That request can no longer be changed here. Please call ${BUSINESS.phoneDisplay}.`, "error")], deps, { extraReplies: [CALL] });
  return respond(
    done,
    [
      {
        kind: "success",
        title: kind === "CANCEL" ? "Cancellation recorded" : "Reschedule requested",
        reference: r.enquiry.reference,
        text:
          kind === "CANCEL"
            ? "Your request has been cancelled and the clinic team has been informed."
            : "Your reschedule request has been sent to the clinic. The new time is not confirmed until the clinic team contacts you.",
      },
    ],
    deps,
  );
}
