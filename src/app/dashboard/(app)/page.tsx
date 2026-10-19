import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { ENQUIRY_STATUSES, notificationLogs, type EnquiryStatus } from "@/db/schema";
import { getDb } from "@/db/client";
import { IconDownload } from "@/components/Icons";
import { requireStaff } from "@/lib/auth/staff";
import { enquiryMetrics, listEnquiries, PAGE_SIZE, STATUS_LABEL } from "@/lib/enquiries/service";
import { formatDate, formatPhone } from "@/lib/validation";
import { PREFERENCE_LABEL } from "@/lib/notify/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function EnquiriesPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const filters = { q: one(sp.q), status: one(sp.status), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page)) || 1 };
  const [{ rows, total }, metrics, [{ failed }]] = await Promise.all([
    listEnquiries(filters),
    enquiryMetrics(),
    getDb()
      .select({ failed: count() })
      .from(notificationLogs)
      .where(and(inArray(notificationLogs.status, ["FAILED", "NOT_CONFIGURED"]), eq(notificationLogs.channel, "email"))),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams({ q: filters.q, status: filters.status, from: filters.from, to: filters.to, page: String(filters.page) });
    for (const [k, v] of Object.entries(patch)) p.set(k, String(v));
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `?${p.toString()}`;
  };
  const needsAction = metrics.byStatus.NEW_ENQUIRY + metrics.byStatus.AWAITING_CLINIC_REVIEW + metrics.byStatus.RESCHEDULE_REQUESTED;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Appointment requests</h1>
          <p>Requests are not appointments until you confirm them with the patient.</p>
        </div>
        {actor.role === "ADMIN" && (
          <a className="btn" href={`/api/staff/export${qs({ page: "" })}`}>
            <IconDownload size={16} /> Export CSV
          </a>
        )}
      </div>

      {one(sp.error) === "forbidden" && <div className="banner banner--error" role="alert">That action needs an administrator account.</div>}
      {one(sp.deleted) && <div className="banner banner--ok" role="status">The record was permanently deleted.</div>}
      {Number(failed) > 0 && (
        <div className="banner banner--warn" role="status">
          {Number(failed)} staff notification{Number(failed) === 1 ? "" : "s"} could not be delivered. <Link href="/dashboard/notifications">Review and retry</Link>
        </div>
      )}

      <section className="metrics" aria-label="Enquiry metrics">
        <div className="metric glass glass--soft"><b>{needsAction}</b><span>Need clinic action</span></div>
        <div className="metric glass glass--soft"><b>{metrics.last7Days}</b><span>New in last 7 days</span></div>
        <div className="metric glass glass--soft"><b>{metrics.byStatus.CONFIRMED}</b><span>Confirmed</span></div>
        <div className="metric glass glass--soft"><b>{metrics.byStatus.AWAITING_PATIENT_RESPONSE}</b><span>Awaiting patient</span></div>
        <div className="metric glass glass--soft"><b>{metrics.total}</b><span>All time</span></div>
      </section>

      <section className="panel glass glass--soft">
        <form className="filters" role="search">
          <label className="field" style={{ flex: "1 1 220px" }}>
            Search name, phone, reference or area
            <input className="input" name="q" defaultValue={filters.q} placeholder="e.g. Priya or 98765" />
          </label>
          <label className="field">
            Status
            <select className="select" name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field">
            Preferred from
            <input className="input" type="date" name="from" defaultValue={filters.from} />
          </label>
          <label className="field">
            Preferred to
            <input className="input" type="date" name="to" defaultValue={filters.to} />
          </label>
          <button className="btn btn--primary" type="submit">Apply</button>
          {(filters.q || filters.status || filters.from || filters.to) && <Link className="btn btn--ghost" href="/dashboard">Clear</Link>}
        </form>
      </section>

      <section className="panel glass glass--soft">
        <h2>{total} request{total === 1 ? "" : "s"}</h2>
        {rows.length === 0 ? (
          <p className="muted">No requests match these filters yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Preferred</th>
                  <th>Locality</th>
                  <th>Preference</th>
                  <th>Status</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link className="rowlink" href={`/dashboard/enquiries/${e.id}`}>{e.patientName}</Link>
                      <div className="muted mono">{e.reference}</div>
                      <div className="muted">{formatPhone(e.contactNumber)}</div>
                    </td>
                    <td>{formatDate(e.preferredDate)}<div className="muted">{e.preferredTime}</div></td>
                    <td>{e.locality}</td>
                    <td className="muted">{PREFERENCE_LABEL[e.therapistPreference].replace(" (if available)", "")}</td>
                    <td><span className={`pill pill--${e.status}`}>{STATUS_LABEL[e.status as EnquiryStatus]}</span></td>
                    <td className="muted">{e.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav className="filters" style={{ marginTop: 14 }} aria-label="Pagination">
            {filters.page > 1 && <Link className="btn btn--sm" href={qs({ page: filters.page - 1 })}>Previous</Link>}
            <span className="muted">Page {filters.page} of {pages}</span>
            {filters.page < pages && <Link className="btn btn--sm" href={qs({ page: filters.page + 1 })}>Next</Link>}
          </nav>
        )}
      </section>
    </>
  );
}
