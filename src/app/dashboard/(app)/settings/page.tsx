import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/staff";
import { aiStatus } from "@/lib/ai/classifier";
import { embedOrigins, env, staffRecipients } from "@/lib/env";
import { emailConfigState } from "@/lib/notify/email";

export default async function SettingsPage() {
  await requireAdmin();
  const email = emailConfigState();
  const ai = aiStatus();
  const origins = embedOrigins();
  const logs = await getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40);
  const appUrl = env().APP_URL;
  const rows: { name: string; state: string; ok: boolean | null; note: string }[] = [
    { name: "Database", state: "Connected", ok: true, note: "Page loaded from the database." },
    { name: "Staff email alerts", state: email.mode.toUpperCase(), ok: email.mode === "smtp" ? email.ready : email.mode === "test" ? null : false, note: `${email.reason}${staffRecipients().length ? ` · Recipients: ${staffRecipients().length}` : ""}` },
    { name: "AI intent detection", state: ai.active ? "ON" : "OFF", ok: ai.active ? true : null, note: ai.note },
    { name: "Website embed", state: origins.length ? "Allowed origins set" : "Not set", ok: origins.length ? true : false, note: origins.length ? origins.join(", ") : "Set ALLOWED_EMBED_ORIGINS to the clinic website origin." },
    { name: "WhatsApp Business Platform", state: "NOT BUILT", ok: false, note: "Email-only was chosen for this phase. The clinic's number is not assumed to be connected." },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Setup &amp; status</h1>
          <p>What is configured right now. Nothing here is marked live until it has been tested.</p>
        </div>
      </div>
      <section className="panel glass glass--soft">
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Integration</th><th>State</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td><strong>{r.name}</strong></td>
                  <td><span className={`pill ${r.ok === true ? "pill--SENT" : r.ok === null ? "pill--TEST_MODE" : "pill--NOT_CONFIGURED"}`}>{r.state}</span></td>
                  <td className="muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel glass glass--soft">
        <h2>Embed on the clinic website</h2>
        <p className="muted">Paste this before the closing &lt;/body&gt; tag of the clinic&apos;s website:</p>
        <pre className="note mono">{`<script src="${appUrl}/widget.js" defer></script>`}</pre>
      </section>
      <section className="panel glass glass--soft">
        <h2>Recent activity (audit log)</h2>
        <div className="stack">
          {logs.map((l) => (
            <div key={l.id} className="muted">
              {l.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} — {l.actor} · {l.action}{l.target ? ` · ${l.target}` : ""}{l.detail ? ` · ${l.detail}` : ""}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
