/** Shared between server engine and client widget. No secrets here. */

export type Step =
  | "menu"
  | "book_name"
  | "book_phone"
  | "book_date"
  | "book_time"
  | "book_locality"
  | "book_reason"
  | "book_pref"
  | "book_consent"
  | "book_confirm"
  | "book_edit_choose"
  | "status_ref"
  | "status_phone"
  | "change_ref"
  | "change_phone"
  | "change_kind"
  | "change_message";

export type Preference = "NO_PREFERENCE" | "FEMALE" | "MALE";

export type Draft = {
  patientName?: string;
  contactNumber?: string;
  preferredDate?: string;
  preferredTime?: string;
  locality?: string;
  serviceRequirement?: string;
  therapistPreference?: Preference;
  consentAt?: string;
};

export type ChatState = {
  v: 1;
  step: Step;
  draft: Draft;
  editing: boolean;
  idempotencyKey?: string;
  lookup: { reference?: string; phone?: string; kind?: "CANCEL" | "RESCHEDULE" };
  failedLookups: number;
};

export type QuickReply = { label: string; action?: string; href?: string; variant?: "primary" | "ghost" | "danger" };

export type BotMessageKind = "text" | "urgent" | "success" | "summary" | "status" | "error" | "info";

export type SummaryField = { label: string; value: string; editAction?: string };

export type BotMessage = {
  kind: BotMessageKind;
  text: string;
  title?: string;
  fields?: SummaryField[];
  reference?: string;
};

export type InputHint = {
  type: "text" | "tel" | "date" | "textarea" | "none";
  placeholder: string;
  maxLength?: number;
};

export type ChatResponse = {
  messages: BotMessage[];
  quickReplies: QuickReply[];
  input: InputHint;
  progress?: { current: number; total: number; label: string };
  mode: { ai: boolean };
};

export type ChatTurnInput = { text?: string; action?: string };
