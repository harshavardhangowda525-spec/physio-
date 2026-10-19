import nodemailer, { type Transporter } from "nodemailer";
import { env, staffRecipients } from "@/lib/env";

export type EmailMessage = { to: string[]; subject: string; text: string };

export type SendOutcome =
  | { status: "SENT"; providerMessageId: string }
  | { status: "TEST_MODE"; note: string }
  | { status: "NOT_CONFIGURED"; note: string }
  | { status: "FAILED"; error: string };

export interface EmailTransport {
  send(msg: EmailMessage): Promise<SendOutcome>;
}

export type EmailConfigState =
  | { mode: "disabled"; ready: false; reason: string }
  | { mode: "test"; ready: true; reason: string }
  | { mode: "smtp"; ready: boolean; reason: string };

export function emailConfigState(): EmailConfigState {
  const e = env();
  if (e.EMAIL_MODE === "disabled")
    return { mode: "disabled", ready: false, reason: "EMAIL_MODE=disabled — no emails are sent." };
  if (e.EMAIL_MODE === "test")
    return { mode: "test", ready: true, reason: "TEST MODE — emails are logged, not delivered." };
  const missing = [
    !e.SMTP_HOST && "SMTP_HOST",
    !e.EMAIL_FROM && "EMAIL_FROM",
    staffRecipients().length === 0 && "STAFF_NOTIFICATION_EMAILS",
  ].filter(Boolean);
  if (missing.length) return { mode: "smtp", ready: false, reason: `Missing: ${missing.join(", ")}` };
  return { mode: "smtp", ready: true, reason: `SMTP via ${e.SMTP_HOST}:${e.SMTP_PORT} (not verified until a send succeeds)` };
}

let smtp: Transporter | undefined;

function smtpTransport(): Transporter {
  if (!smtp) {
    const e = env();
    smtp = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return smtp;
}

export const defaultEmailTransport: EmailTransport = {
  async send(msg) {
    const state = emailConfigState();
    if (state.mode === "test") {
      console.info(`[email:TEST MODE] to=${msg.to.join(",")} subject="${msg.subject}" (not delivered)`);
      return { status: "TEST_MODE", note: "Logged in test mode; not delivered." };
    }
    if (!state.ready) return { status: "NOT_CONFIGURED", note: state.reason };
    try {
      const info = await smtpTransport().sendMail({
        from: env().EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      });
      return { status: "SENT", providerMessageId: String(info.messageId ?? "") };
    } catch (err) {
      return { status: "FAILED", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

let override: EmailTransport | undefined;

/** Tests can swap the transport (e.g. to simulate a provider outage). */
export function setEmailTransport(t: EmailTransport | undefined): void {
  override = t;
}

export function emailTransport(): EmailTransport {
  return override ?? defaultEmailTransport;
}
