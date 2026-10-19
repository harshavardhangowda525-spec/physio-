import { Atmosphere } from "@/components/Atmosphere";
import { BrandMark } from "@/components/Icons";
import { requireStaff } from "@/lib/auth/staff";
import { logoutAction } from "../actions";
import { NavLinks } from "./NavLinks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff dashboard", robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaff();
  return (
    <>
      <Atmosphere />
      <div className="dash">
        <aside className="side glass glass--soft">
          <div className="brand">
            <span className="brand-mark"><BrandMark size={20} /></span>
            <span>
              Enquiries
              <small>Physiotherapy at Home</small>
            </span>
          </div>
          <NavLinks isAdmin={actor.role === "ADMIN"} />
          <div className="who">
            <strong>{actor.name}</strong>
            {actor.role === "ADMIN" ? "Administrator" : "Clinic staff"}
            <form action={logoutAction} style={{ marginTop: 10 }}>
              <button className="btn btn--sm btn--ghost" type="submit">Sign out</button>
            </form>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
