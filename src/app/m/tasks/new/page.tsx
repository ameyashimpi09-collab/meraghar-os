import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { taskFormOptions } from "@/lib/execution";
import { APPROVAL_STATUS_LABEL, MEMBER_ROLE_SHORT, PRIORITY_LABEL, TASK_STATUS_LABEL, todayIST } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Empty, PageHeader, Section } from "@/components/ui";
import { createTaskAction } from "@/app/actions/tasks";
import { z } from "zod";

export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ project?: string; stage?: string }> }) {
  const user = await requireUser("management");
  const sp = await searchParams;
  const projectId = z.string().uuid().safeParse(sp.project).success ? sp.project! : null;
  const data = await withUser(user.id, async (db) => {
    const projects = (await db.query(
      `select id, name, project_code from projects where deleted_at is null and status in ('active','on_hold','draft') and can_manage_project(id) order by name`)).rows;
    const project = projectId ? projects.find((p) => p.id === projectId) ?? null : null;
    return { projects, project, opts: project ? await taskFormOptions(db, project.id) : null };
  });

  if (!data.project || !data.opts) {
    return (
      <>
        <PageHeader title="New task" subtitle="Which project is it for?" />
        {data.projects.length === 0 ? <Empty title="You don't manage any active projects yet" /> : (
          <Section title="Choose a project">
            <ul className="divide-y divide-line">
              {data.projects.map((p) => (
                <li key={p.id}><Link href={`/m/tasks/new?project=${p.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-canvas/60"><span className="font-medium">{p.name}</span><span className="text-xs text-ink-3">{p.project_code} ›</span></Link></li>
              ))}
            </ul>
          </Section>
        )}
      </>
    );
  }
  const { project: p, opts } = data;
  const stage = opts.stages.find((s) => s.id === sp.stage);
  const today = todayIST();

  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/tasks" className="hover:underline">Tasks</Link> / <Link href={`/m/projects/${p.id}/schedule`} className="hover:underline">{p.project_code}</Link></div>
      <PageHeader title="New task" subtitle={p.name} />
      <ActionForm action={createTaskAction} className="grid gap-5 lg:grid-cols-[1fr_360px]" resetOnSuccess>
        <input type="hidden" name="project_id" value={p.id} />
        <div className="space-y-5">
          <Section title="What needs to be done">
            <div className="grid gap-3 p-4">
              <div><label className="label">Task</label><input name="title" required maxLength={200} className="input" placeholder="e.g. Send kitchen shutter cutting list to factory" autoFocus /></div>
              <div><label className="label">Details for the person doing it</label><textarea name="description" maxLength={4000} rows={4} className="input" placeholder="Drawings to use, site contact, what “done” looks like…" /></div>
              <div><label className="label">Stage</label>
                <select name="stage_id" defaultValue={stage?.id ?? ""} className="input"><option value="">No stage</option>{opts.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            </div>
          </Section>
          <Section title="Waits for (optional)">
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              <Multi name="dep_task" label="Other tasks" items={opts.tasks.map((x) => [x.id, `${x.title} · ${TASK_STATUS_LABEL[x.status]}`])} />
              <Multi name="dep_approval" label="Client approvals" items={opts.approvals.map((x) => [x.id, `${x.title} · ${APPROVAL_STATUS_LABEL[x.status]}`])} />
              <Multi name="dep_purchase" label="Client purchases" items={opts.purchases.map((x) => [x.id, `${x.item_name} · ${x.status.replace(/_/g, " ")}`])} />
              <p className="text-xs text-ink-3 sm:col-span-3">While any of these is pending, the task shows what it is waiting for. When they are all done the assignee is told it is ready to start. Hold Ctrl / ⌘ to pick more than one.</p>
            </div>
          </Section>
        </div>
        <div className="space-y-5">
          <Section title="Who and when">
            <div className="grid gap-3 p-4">
              <div><label className="label">Assign to</label>
                <select name="assigned_to" className="input" defaultValue=""><option value="">Unassigned for now</option>{opts.team.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {MEMBER_ROLE_SHORT[m.member_role]}</option>)}</select>
                {opts.team.length === 0 && <p className="mt-1 text-xs text-amber-700">Nobody is on this project&apos;s team yet. Add people on the project page first.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Start</label><input type="date" name="start_date" defaultValue={stage?.start_date && stage.start_date > today ? stage.start_date : today} className="input" /></div>
                <div><label className="label">Deadline</label><input type="date" name="due_date" defaultValue={stage?.planned_end_date ?? ""} className="input" /></div>
              </div>
              <div><label className="label">Priority</label>
                <select name="priority" defaultValue="medium" className="input">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requires_review" /> Needs a manager&apos;s review when completed</label>
              <div><label className="label">Reviewer</label>
                <select name="reviewer_id" className="input" defaultValue=""><option value="">Project manager</option>{opts.reviewers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <Submit name="another" value="1" className="btn-ghost" pendingText="Saving…">Save & add another</Submit>
              <Submit name="another" value="0" pendingText="Saving…">Create task</Submit>
            </div>
          </Section>
        </div>
      </ActionForm>
    </>
  );
}

function Multi({ name, label, items }: { name: string; label: string; items: [string, string][] }) {
  return (
    <div>
      <label className="label">{label}</label>
      {items.length === 0 ? <p className="text-xs text-ink-3">None on this project yet.</p> : (
        <select name={name} multiple size={Math.min(5, Math.max(3, items.length))} className="input">
          {items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </div>
  );
}
