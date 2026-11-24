import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/roles";
import { Avatar, PageHeader, Section } from "./ui";
import { ContactForm, PasswordForm } from "./ProfileForms";

export default async function InternalProfile() {
  const user = await requireUser();
  const pref = await withUser(user.id, async (db) => (await db.query("select preferred_contact_method from profiles where id = auth.uid()")).rows[0]?.preferred_contact_method);
  return (
    <>
      <PageHeader title="My profile" />
      <div className="grid max-w-4xl gap-5 md:grid-cols-2">
        <Section title="Details">
          <div className="p-4">
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={user.fullName} size={44} />
              <div><div className="font-medium">{user.fullName}</div><div className="text-xs text-ink-3">{user.designation ?? ROLE_LABEL[user.role]} · {user.email}</div></div>
            </div>
            <ContactForm phone={user.phone} pref={pref ?? "phone"} />
          </div>
        </Section>
        <Section title="Password"><div className="p-4"><PasswordForm /></div></Section>
      </div>
    </>
  );
}
