import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { enquiries, notificationLogs } from "@/db/schema";
import { requireStaff } from "@/lib/auth/staff";
import { emailConfigState } from "@/lib/notify/email";
import { retryNotificationAction } from "../../actions";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaff();
  const sp = await searchParams;
  const email = emailConfigState();
  const rows = await getDb()
    .select({ n: notificationLogs, reference: enquiries.reference, patientName: enquiries.patientName })
    .from(notificationLogs)
    .leftJoin(enquiries, eq(enquiries.id, notificationLogs.enquiryId))
    .orderBy(desc(notificationLogs.createdAt))
    .limit(100);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Every staff alert attempt is logged here. Enquiries are always saved, even when an alert fails.</p>
        </div>
      </div>
      <div className={`banner ${email.mode === "smtp" && email.ready ? "banner--info" : "banner--warn"}`}>
        Email: <strong>{email.mode.toUpperCase()}</strong> — {email.reason}
      </div>
      {sp.retried && <div className={`banner ${sp.retried === "SENT" ? "banner--ok" : "banner--warn"}`} role="status">Retry result: {sp.retried}</div>}
      <section className="panel glass glass--soft">
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr><th>When</th><th>Request</th><th>Event</th><th>Status</th><th>Attempts</th><th>Detail</th><th /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (<tr><td colSpan={7} className="muted">No notifications yet.</td></tr>)}
              {rows.map(({ n, reference, patientName }) => (
                <tr key={n.id}>
                  <td className="muted">{n.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{n.enquiryId ? <Link className="rowlink" href={`/dashboard/enquiries/${n.enquiryId}`}>{patientName}</Link> : "—"}<div className="muted mono">{reference}</div></td>
                  <td>{n.event.replaceAll("_", " ").toLowerCase()}</td>
                  <td><span className={`pill pill--${n.status}`}>{n.status.replace("_", " ")}</span></td>
                  <td>{n.attempts}</td>
                  <td className="muted" style={{ maxWidth: 320 }}>{n.lastError ?? (n.status === "SENT" ? `Delivered to ${n.recipient ?? "staff"}` : "")}</td>
                  <td>
                    {n.status !== "SENT" && (
                      <form action={retryNotificationAction}>
                        <input type="hidden" name="id" value={n.id} />
                        <input type="hidden" name="back" value="/dashboard/notifications" />
                        <button className="btn btn--sm" type="submit">Retry</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
