import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/Atmosphere";
import { BrandMark } from "@/components/Icons";
import { currentStaff } from "@/lib/auth/staff";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign in", robots: { index: false } };

export default async function LoginPage() {
  const actor = await currentStaff().catch(() => null);
  if (actor) redirect("/dashboard");
  return (
    <>
      <Atmosphere />
      <main className="login">
        <div className="login-card glass glass-edge">
          <span className="brand-mark"><BrandMark size={22} /></span>
          <div>
            <h1>Clinic staff</h1>
            <p className="muted">Sign in to review appointment requests. Authorised staff only.</p>
          </div>
          <LoginForm />
        </div>
      </main>
    </>
  );
}
