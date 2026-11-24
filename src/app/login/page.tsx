import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/roles";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="grid min-h-dvh bg-ivory lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-charcoal lg:block">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "linear-gradient(160deg, rgba(43,41,37,.2), rgba(43,41,37,.85)), repeating-linear-gradient(90deg, #3a3731 0 1px, transparent 1px 120px), linear-gradient(180deg,#5d5145,#2b2925)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-14 text-ivory">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="text-sm tracking-[0.3em] uppercase">Meraghar</span>
          </div>
          <div>
            <p className="font-serif text-5xl leading-tight">
              One home.
              <br />
              One record.
              <br />
              <span className="text-[#c9a77c]">Every detail in its place.</span>
            </p>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-ivory/70">
              Designs, approvals, schedules, payments and site progress for every Meraghar project, in one place for
              our team and our clients.
            </p>
          </div>
          <p className="text-xs text-ivory/50">Meraki Interior E-Solutions LLP · Pune</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="text-sm tracking-[0.3em] text-charcoal uppercase">Meraghar</span>
          </div>
          <h1 className="font-serif text-4xl text-charcoal">Welcome</h1>
          <p className="mt-2 text-sm text-stone">Sign in to your Meraghar account.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
