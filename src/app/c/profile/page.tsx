import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ContactForm, PasswordForm } from "@/components/ProfileForms";
import { logout } from "@/app/actions/auth";

export const metadata = { title: "Account" };

export default async function ClientAccount() {
  const user = await requireUser("client");
  const pref = await withUser(user.id, async (db) => (await db.query("select preferred_contact_method from profiles where id = auth.uid()")).rows[0]?.preferred_contact_method);
  return (
    <>
      <h1 className="font-serif text-5xl">Account</h1>
      <p className="mt-3 text-stone">{user.fullName} · {user.email}</p>
      <div className="mt-12 grid gap-16 md:grid-cols-2 [&_.label]:text-[11px] [&_.label]:tracking-[0.2em] [&_.label]:text-stone [&_.label]:uppercase">
        <section><div className="mb-6 font-serif text-2xl">Contact preferences</div><ContactForm phone={user.phone} pref={pref ?? "whatsapp"} tone="client" /></section>
        <section><div className="mb-6 font-serif text-2xl">Password</div><PasswordForm tone="client" /></section>
      </div>
      <form action={logout} className="mt-16 md:hidden"><button className="text-sm text-stone underline">Sign out</button></form>
    </>
  );
}
