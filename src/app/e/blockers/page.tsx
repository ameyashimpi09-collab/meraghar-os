import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { openBlockers } from "@/lib/execution";
import { PageHeader, Section } from "@/components/ui";
import { BlockerList, RaiseBlockerForm } from "@/components/blockers";

export const metadata = { title: "Blockers" };

export default async function EmployeeBlockersPage() {
  const user = await requireUser("employee");
  const data = await withUser(user.id, async (db) => ({
    blockers: await openBlockers(db, { includeResolved: true }),
    projects: (await db.query(
      `select p.id, p.name from projects p join project_members m on m.project_id = p.id and m.profile_id = auth.uid() and m.removed_at is null
        where p.deleted_at is null and p.status in ('active','on_hold') group by p.id order by p.name`)).rows,
  }));
  const open = data.blockers.filter((b) => !b.resolved_at);
  const resolved = data.blockers.filter((b) => b.resolved_at).slice(0, 15);
  return (
    <>
      <PageHeader title="Blockers" subtitle="Anything stopping work on site. Flag it here and your project manager is told immediately. To block one of your tasks, open the task and use “Flag a blocker”." />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Section title={`Open on my projects (${open.length})`}><BlockerList blockers={open} base="/e" showProject /></Section>
          {resolved.length > 0 && <Section title="Recently resolved"><BlockerList blockers={resolved} base="/e" showProject /></Section>}
        </div>
        <Section title="Flag a site blocker">
          <div className="p-4">{data.projects.length ? <RaiseBlockerForm projects={data.projects} /> : <p className="text-sm text-ink-3">You are not on any active project.</p>}</div>
        </Section>
      </div>
    </>
  );
}
