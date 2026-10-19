"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { BUSINESS } from "@/lib/business";
import type { BotMessage, ChatResponse, InputHint, QuickReply } from "@/lib/chat/types";
import {
  BrandMark,
  IconAlert,
  IconCheck,
  IconCopy,
  IconInfo,
  IconPhone,
  IconRefresh,
  IconSend,
  IconShield,
} from "./Icons";

type Entry = { id: number; from: "bot"; msg: BotMessage } | { id: number; from: "user"; text: string };

const DEFAULT_INPUT: InputHint = { type: "text", placeholder: "Type a message" };
const NETWORK_ERROR: ChatResponse = {
  messages: [
    {
      kind: "error",
      title: "Connection problem",
      text: `I couldn't reach the server. Please check your connection and try again, or call the clinic on ${BUSINESS.phoneDisplay}.`,
    },
  ],
  quickReplies: [{ label: `Call ${BUSINESS.phoneDisplay}`, href: `tel:${BUSINESS.phoneTel}`, variant: "primary" }],
  input: DEFAULT_INPUT,
  mode: { ai: false },
};

let nextId = 1;

function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function ChatWidget({ variant = "page" }: { variant?: "page" | "embed" }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [input, setInput] = useState<InputHint>(DEFAULT_INPUT);
  const [progress, setProgress] = useState<ChatResponse["progress"]>();
  const [aiMode, setAiMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const token = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const started = useRef(false);

  const apply = useCallback((r: ChatResponse) => {
    setEntries((e) => [...e, ...r.messages.map((m) => ({ id: nextId++, from: "bot" as const, msg: m }))]);
    setReplies(r.quickReplies);
    setInput(r.input);
    setProgress(r.progress);
    setAiMode(r.mode.ai);
  }, []);

  const send = useCallback(
    async (payload: { text?: string; action?: string }, echo?: string) => {
      if (echo) setEntries((e) => [...e, { id: nextId++, from: "user", text: echo }]);
      setReplies([]);
      setBusy(true);
      const minDelay = new Promise((r) => setTimeout(r, 380));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.current, ...payload }),
        });
        const body = (await res.json().catch(() => ({}))) as { token?: string; response?: ChatResponse; error?: string };
        await minDelay;
        if (body.token) token.current = body.token;
        if (res.status === 429) {
          apply({
            ...NETWORK_ERROR,
            messages: [{ kind: "error", title: "Please slow down", text: "You're sending messages very quickly. Please wait a moment and try again." }],
          });
        } else if (body.response) apply(body.response);
        else apply(NETWORK_ERROR);
      } catch {
        await minDelay;
        apply(NETWORK_ERROR);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const restart = useCallback(() => {
    token.current = undefined;
    setEntries([]);
    setDraft("");
    void send({});
  }, [send]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({});
  }, [send]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [entries, busy, replies]);

  useEffect(() => {
    if (!busy && input.type !== "none") fieldRef.current?.focus({ preventScroll: true });
  }, [busy, input]);

  const onSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send({ text }, input.type === "date" ? formatDateEcho(text) : text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const copyRef = async (ref: string) => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(ref);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard may be blocked inside iframes */
    }
  };

  const disabled = busy || input.type === "none";
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <section className={`chat glass glass-edge ${variant === "embed" ? "chat--embed" : ""}`} aria-label="Appointment assistant chat">
      <header className="chat-header">
        <div className="avatar">
          <BrandMark size={22} />
          <span className="online" aria-hidden="true" />
        </div>
        <div className="chat-title">
          <strong>{BUSINESS.name}</strong>
          <span>Virtual appointment assistant · available 24/7</span>
        </div>
        <span className="mode-badge" title={aiMode ? "AI helps understand messages; answers come from verified clinic information" : "Answers come from verified clinic information"}>
          {aiMode ? "AI-assisted" : "Guided"}
        </span>
        <button type="button" className="icon-btn" onClick={restart} aria-label="Start a new conversation" title="Start over">
          <IconRefresh size={17} />
        </button>
        <a className="icon-btn" href={`tel:${BUSINESS.phoneTel}`} aria-label={`Call the clinic on ${BUSINESS.phoneDisplay}`} title={`Call ${BUSINESS.phoneDisplay}`}>
          <IconPhone size={17} />
        </a>
      </header>

      {progress && (
        <div className="progress" role="group" aria-label="Request progress">
          <div className="progress-meta">
            <span>
              Step <b>{progress.current}</b> of {progress.total}
            </span>
            <span>{progress.label}</span>
          </div>
          <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.current} aria-valuetext={`Step ${progress.current} of ${progress.total}: ${progress.label}`}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="messages" ref={scroller} role="log" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
        {entries.map((e) =>
          e.from === "user" ? (
            <div key={e.id} className="row row--user">
              <div className="bubble bubble--user">
                <span className="sr-only">You said: </span>
                {e.text}
              </div>
            </div>
          ) : (
            <div key={e.id} className="row">
              <span className="mini-avatar" aria-hidden="true">
                <BrandMark size={15} />
              </span>
              <BotEntry msg={e.msg} onAction={(a, label) => send({ action: a }, label)} onCopy={copyRef} copied={copied} disabled={busy} />
            </div>
          ),
        )}
        {busy && (
          <div className="row" aria-label="Assistant is typing">
            <span className="mini-avatar" aria-hidden="true">
              <BrandMark size={15} />
            </span>
            <div className="bubble bubble--bot typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>

      {replies.length > 0 && !busy && (
        <div className="chips" role="group" aria-label="Suggested replies">
          {replies.map((r, i) =>
            r.href ? (
              <a key={`${r.label}-${i}`} className={`btn ${r.variant ? `btn--${r.variant}` : ""}`} href={r.href}>
                {r.href.startsWith("tel:") && <IconPhone size={15} />}
                {r.label}
              </a>
            ) : (
              <button key={`${r.label}-${i}`} type="button" className={`btn ${r.variant ? `btn--${r.variant}` : ""}`} onClick={() => send({ action: r.action }, r.label)}>
                {r.label}
              </button>
            ),
          )}
        </div>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <label className="composer-field">
          <span className="sr-only">{input.placeholder}</span>
          {input.type === "textarea" ? (
            <textarea ref={fieldRef} rows={2} value={draft} maxLength={input.maxLength} placeholder={input.placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} disabled={disabled} />
          ) : (
            <input
              ref={fieldRef}
              type={input.type === "date" ? "date" : input.type === "tel" ? "tel" : "text"}
              inputMode={input.type === "tel" ? "tel" : undefined}
              autoComplete={input.type === "tel" ? "tel" : "off"}
              min={input.type === "date" ? todayIso() : undefined}
              value={draft}
              maxLength={input.maxLength}
              placeholder={input.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled}
            />
          )}
        </label>
        <button className="send" type="submit" disabled={disabled || !draft.trim()} aria-label="Send message">
          <IconSend size={19} />
        </button>
      </form>

      <footer className="chat-foot">
        <span>
          <IconShield size={13} style={{ verticalAlign: "-2px" }} /> Not for emergencies — call 112.{" "}
          <a href="/privacy" target={variant === "embed" ? "_blank" : undefined} rel="noopener">
            Privacy notice
          </a>
        </span>
        <span>
          Prefer to talk? <a href={`tel:${BUSINESS.phoneTel}`}>{BUSINESS.phoneDisplay}</a>
        </span>
      </footer>
    </section>
  );
}

function formatDateEcho(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const [y, m, d] = v.split("-");
  return `${d}/${m}/${y}`;
}

function BotEntry({
  msg,
  onAction,
  onCopy,
  copied,
  disabled,
}: {
  msg: BotMessage;
  onAction: (action: string, label: string) => void;
  onCopy: (ref: string) => void;
  copied: string | null;
  disabled: boolean;
}) {
  if (msg.kind === "text") return <div className="bubble bubble--bot">{msg.text}</div>;
  if (msg.kind === "error" && !msg.title)
    return (
      <div className="bubble bubble--error" role="alert">
        {msg.text}
      </div>
    );

  if (msg.kind === "summary") {
    return (
      <div className="card">
        <h4>{msg.title}</h4>
        <dl className="summary">
          {msg.fields?.map((f) => (
            <div className="summary-row" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
              {f.editAction && (
                <button type="button" className="edit-link" disabled={disabled} onClick={() => onAction(f.editAction!, `Edit ${f.label.toLowerCase()}`)} aria-label={`Edit ${f.label}`}>
                  Edit
                </button>
              )}
            </div>
          ))}
        </dl>
        <p>{msg.text}</p>
      </div>
    );
  }

  if (msg.kind === "success") {
    return (
      <div className="card card--success" role="status">
        <h4>
          <span className="success-check">
            <IconCheck size={15} />
          </span>
          {msg.title}
        </h4>
        {msg.reference && (
          <div className="ref">
            <code>
              <small>Reference number</small>
              <span className="ref-value">{msg.reference}</span>
            </code>
            <button type="button" className="btn btn--sm" onClick={() => onCopy(msg.reference!)}>
              <IconCopy size={14} /> {copied === msg.reference ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        <p>{msg.text}</p>
        {/request|reschedule/i.test(msg.title ?? "") && (
          <span className="not-confirmed">
            <IconInfo size={13} /> Not yet a confirmed appointment
          </span>
        )}
      </div>
    );
  }

  const icon = msg.kind === "urgent" || msg.kind === "error" ? <IconAlert size={17} /> : <IconInfo size={17} />;
  const cls = msg.kind === "urgent" ? "card--urgent" : msg.kind === "error" ? "card--error" : "card--info";
  return (
    <div className={`card ${cls}`} role={msg.kind === "urgent" || msg.kind === "error" ? "alert" : undefined}>
      <h4>
        {icon}
        {msg.title}
      </h4>
      <p>{msg.text}</p>
      {msg.fields && (
        <dl className="summary">
          {msg.fields.map((f) => (
            <div className="summary-row" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
