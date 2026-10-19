import Link from "next/link";
import { notFound } from "next/navigation";
import { ENQUIRY_STATUSES } from "@/db/schema";
import { IconPhone } from "@/components/Icons";
import { requireStaff } from "@/lib/auth/staff";
import { getEnquiryDetail, STATUS_LABEL } from "@/lib/enquiries/service";
import { PREFERENCE_LABEL } from "@/lib/notify/messages";
import { formatDate, formatPhone } from "@/lib/validation";
import { addNoteAction, deleteEnquiryAction, retryNotificationAction, updateStatusAction } from "../../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

const ts = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function EnquiryDetail({ params, searchParams }: Props) {
  const actor = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getEnquiryDetail(id);
  if (!detail) notFound();
  const { enquiry: e, notes, history, notifications } = detail;
  const waText = encodeURIComponent(`Hello ${e.patientName}, this is ${"Physiotherapy Treatment at Home"} regarding your home physiotherapy request ${e.reference}.`);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/dashboard" className="muted">← All requests</Link>
          <h1>{e.patientName}</h1>
          <p className="mono">{e.reference}</p>
        </div>
        <span className={`pill pill--${e.status}`} style={{ fontSize: 14, padding: "7px 14px" }}>{STATUS_LABEL[e.status]}</span>
      </div>

      {sp.saved && <div className="banner banner--ok" role="status">Saved.</div>}
      {sp.error && <div className="banner banner--error" role="alert">{sp.error === "confirm" ? 'Type DELETE to confirm deletion.' : "Please check the form and try again."}</div>}
      {sp.retried && <div className={`banner ${sp.retried === "SENT" ? "banner--ok" : "banner--warn"}`} role="status">Notification retry result: {sp.retried}</div>}
      {e.status !== "CONFIRMED" && e.status !== "COMPLETED" && e.status !== "CANCELLED" && (
        <div className="banner banner--info">Not confirmed. Check availability, call the patient, then set the status to Confirmed.</div>
      )}

      <div className="detail">
        <section className="panel glass glass--soft">
          <h2>Request details</h2>
          <dl className="kv">
            <dt>Phone</dt><dd>{formatPhone(e.contactNumber)}</dd>
            <dt>Preferred date</dt><dd>{formatDate(e.preferredDate)}</dd>
            <dt>Preferred time</dt><dd>{e.preferredTime}</dd>
            <dt>Locality</dt><dd>{e.locality}</dd>
            <dt>Patient&apos;s description</dt><dd style={{ whiteSpace: "pre-wrap" }}>{e.serviceRequirement}</dd>
            <dt>Therapist preference</dt><dd>{PREFERENCE_LABEL[e.therapistPreference]}</dd>
            {e.patientChangeRequest && (<><dt>Patient change request</dt><dd>{e.patientChangeRequest}</dd></>)}
            <dt>Source</dt><dd>{e.source === "WEBSITE_CHAT" ? "Website chat" : "Staff entry"}</dd>
            <dt>Consent given</dt><dd>{ts(e.consentAt)}<div className="muted">{e.consentText}</div></dd>
            <dt>Received</dt><dd>{ts(e.createdAt)}</dd>
          </dl>
          <div className="filters" style={{ marginTop: 16 }}>
            <a className="btn btn--primary" href={`tel:${e.contactNumber}`}><IconPhone size={16} /> Call patient</a>
            <a className="btn" href={`https://wa.me/${e.contactNumber.replace("+", "")}?text=${waText}`} target="_blank" rel="noopener noreferrer">Message on WhatsApp</a>
          </div>
        </section>

        <div className="stack">
          <section className="panel glass glass--soft">
            <h2>Update status</h2>
            <form action={updateStatusAction} className="filters">
              <input type="hidden" name="id" value={e.id} />
              <label className="field" style={{ flex: 1 }}>
                Status
                <select className="select" name="status" defaultValue={e.status}>
                  {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <button className="btn btn--primary" type="submit">Save</button>
            </form>
            <p className="muted" style={{ marginTop: 10 }}>Only choose Confirmed after you have agreed a time with the patient. Patients who check their status see the label you choose here.</p>
          </section>

          <section className="panel glass glass--soft">
            <h2>Internal notes</h2>
            <form action={addNoteAction} className="stack">
              <input type="hidden" name="id" value={e.id} />
              <label className="field">
                Add a note (staff only)
                <textarea className="textarea" name="body" maxLength={2000} required />
              </label>
              <button className="btn" type="submit">Add note</button>
            </form>
            <div className="stack" style={{ marginTop: 12 }}>
              {notes.length === 0 && <p className="muted">No notes yet.</p>}
              {notes.map((n) => (
                <div className="note" key={n.id}><small>{n.authorName} · {ts(n.createdAt)}</small>{n.body}</div>
              ))}
            </div>
          </section>

          <section className="panel glass glass--soft">
            <h2>Staff notifications</h2>
            {notifications.length === 0 && <p className="muted">None recorded.</p>}
            <div className="stack">
              {notifications.map((n) => (
                <div key={n.id} className="note">
                  <small>{n.event.replaceAll("_", " ").toLowerCase()} · {n.channel} · {n.attempts} attempt{n.attempts === 1 ? "" : "s"}</small>
                  <span className={`pill pill--${n.status}`}>{n.status.replace("_", " ")}</span>
                  {n.lastError && <div className="muted">{n.lastError}</div>}
                  {n.status !== "SENT" && (
                    <form action={retryNotificationAction} style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={n.id} />
                      <input type="hidden" name="back" value={`/dashboard/enquiries/${e.id}`} />
                      <button className="btn btn--sm" type="submit">Retry</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel glass glass--soft">
            <h2>History</h2>
            <div className="stack">
              {history.map((h) => (
                <div key={h.id} className="muted">
                  {ts(h.createdAt)} — {h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ""}{STATUS_LABEL[h.toStatus]} ({h.changedBy})
                </div>
              ))}
            </div>
          </section>

          {actor.role === "ADMIN" && (
            <section className="panel glass glass--soft">
              <h2>Delete patient record</h2>
              <p className="muted">Use when the patient asks for their details to be deleted or the retention period has passed. This cannot be undone.</p>
              <form action={deleteEnquiryAction} className="filters">
                <input type="hidden" name="id" value={e.id} />
                <label className="field">
                  Type DELETE to confirm
                  <input className="input" name="confirm" autoComplete="off" />
                </label>
                <button className="btn btn--danger" type="submit">Delete permanently</button>
              </form>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
