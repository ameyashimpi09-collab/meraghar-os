import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isOrgAdmin } from "@/lib/roles";
import { MEMBER_ROLE_SHORT, PRIORITY_LABEL } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Badge, PageHeader, Section } from "@/components/ui";
import { saveStageTemplateAction, saveTaskTemplateAction } from "../schedule/actions";

export const metadata = { title: "Settings" };

const ROLES = Object.entries(MEMBER_ROLE_SHORT);

export default async function SettingsPage() {
  const user = await requireUser("management");
  const admin = isOrgAdmin(user.role);
  const { stages, tasks } = await withUser(user.id, async (db) => ({
    stages: (await db.query("select * from stage_templates where organisation_id = my_org_id() order by is_active desc, sort_order, name")).rows,
    tasks: (await db.query("select * from task_templates where organisation_id = my_org_id() order by is_active desc, offset_days, title")).rows,
  }));
  const total = stages.filter((s) => s.is_active).reduce((n, s) => n + (s.default_duration_days ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Settings · default stages & standard tasks"
        subtitle={<>Used when a project&apos;s schedule is set up. Changing them here doesn&apos;t change existing projects. Active stages add up to about <b>{total} days</b> back to back.{admin ? "" : " Only an owner or admin can edit these."}</>}
      />
      <div className="space-y-3">
        {stages.map((s) => {
          const mine = tasks.filter((t) => t.stage_template_id === s.id);
          return (
            <details key={s.id} className="card group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-6 text-xs text-ink-3 tabular-nums">{s.sort_order}</span>
                <span className={`flex-1 text-sm font-medium ${s.is_active ? "" : "text-ink-3 line-through"}`}><span className="mr-1 inline-block text-ink-3 transition group-open:rotate-90">›</span>{s.name}</span>
                {s.is_milestone && <Badge tone="brand">Milestone</Badge>}
                {!s.is_active && <Badge>Not used</Badge>}
                <span className="text-xs text-ink-3">{s.default_duration_days ?? "—"} days · {mine.filter((t) => t.is_active).length} standard tasks</span>
              </summary>
              <div className="grid gap-5 border-t border-line bg-canvas/40 p-4 lg:grid-cols-[320px_1fr]">
                <div className="card p-4">
                  <h3 className="mb-3 text-sm font-semibold">Stage</h3>
                  <ActionForm action={saveStageTemplateAction} className="grid gap-3">
                    <input type="hidden" name="id" value={s.id} />
                    <fieldset disabled={!admin} className="grid gap-3">
                      <div><label className="label">Name</label><input name="name" defaultValue={s.name} required maxLength={120} className="input" /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="label">Order</label><input type="number" name="sort_order" min={0} max={999} defaultValue={s.sort_order} className="input" /></div>
                        <div><label className="label">Usual length (days)</label><input type="number" name="default_duration_days" min={1} max={365} defaultValue={s.default_duration_days ?? 1} className="input" /></div>
                      </div>
                      <div><label className="label">Description</label><input name="description" defaultValue={s.description ?? ""} maxLength={500} className="input" /></div>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_milestone" defaultChecked={s.is_milestone} /> Milestone</label>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={s.is_active} /> Use for new projects</label>
                      {admin && <div className="flex justify-end"><Submit className="btn-ghost">Save stage</Submit></div>}
                    </fieldset>
                  </ActionForm>
                </div>
                <div className="card">
                  <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold">Standard tasks</h3>
                  <ul className="divide-y divide-line">
                    {mine.map((t) => <TaskTemplateRow key={t.id} t={t} stageId={s.id} admin={admin} />)}
                    {mine.length === 0 && <li className="px-4 py-3 text-sm text-ink-3">None yet.</li>}
                  </ul>
                  {admin && (
                    <details className="border-t border-line">
                      <summary className="cursor-pointer px-4 py-2.5 text-xs text-brand">+ Add a standard task</summary>
                      <div className="px-4 pb-4"><TaskTemplateForm stageId={s.id} /></div>
                    </details>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>
      {admin && (
        <Section title="Add a default stage" className="mt-6">
          <ActionForm action={saveStageTemplateAction} className="grid gap-3 p-4 sm:grid-cols-[1fr_100px_140px_auto] sm:items-end" resetOnSuccess>
            <div><label className="label">Name</label><input name="name" required maxLength={120} className="input" placeholder="e.g. Modular kitchen pre-installation check" /></div>
            <div><label className="label">Order</label><input type="number" name="sort_order" min={0} max={999} defaultValue={(stages.at(-1)?.sort_order ?? 0) + 1} className="input" /></div>
            <div><label className="label">Usual length (days)</label><input type="number" name="default_duration_days" min={1} max={365} defaultValue={5} className="input" /></div>
            <Submit>Add stage</Submit>
          </ActionForm>
        </Section>
      )}
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function TaskTemplateRow({ t, stageId, admin }: { t: any; stageId: string; admin: boolean }) {
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
          <span className={`flex-1 ${t.is_active ? "" : "text-ink-3 line-through"}`}>{t.title}</span>
          <span className="text-xs text-ink-3">{t.default_assignee_role ? MEMBER_ROLE_SHORT[t.default_assignee_role] : "Unassigned"} · day {t.offset_days + 1}{t.duration_days > 1 ? `–${t.offset_days + t.duration_days}` : ""}{t.requires_review ? " · review" : ""}</span>
        </summary>
        {admin && <div className="px-4 pb-4"><TaskTemplateForm stageId={stageId} t={t} /></div>}
      </details>
    </li>
  );
}

function TaskTemplateForm({ stageId, t }: { stageId: string; t?: any }) {
  return (
    <ActionForm action={saveTaskTemplateAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!t}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <input type="hidden" name="stage_template_id" value={stageId} />
      <div className="sm:col-span-2"><label className="label">Task</label><input name="title" defaultValue={t?.title ?? ""} required maxLength={200} className="input" /></div>
      <div><label className="label">Given to (by project role)</label>
        <select name="default_assignee_role" defaultValue={t?.default_assignee_role ?? ""} className="input"><option value="">Leave unassigned</option>{ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className="label">Priority</label>
        <select name="default_priority" defaultValue={t?.default_priority ?? "medium"} className="input">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className="label">Starts on day (of the stage)</label><input type="number" name="offset_days" min={0} max={365} defaultValue={t?.offset_days ?? 0} className="input" /><p className="mt-0.5 text-[11px] text-ink-3">0 = first day of the stage</p></div>
      <div><label className="label">Takes (days)</label><input type="number" name="duration_days" min={1} max={365} defaultValue={t?.duration_days ?? 1} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">Details</label><input name="description" defaultValue={t?.description ?? ""} maxLength={1000} className="input" /></div>
      <div className="flex flex-wrap gap-x-5 text-sm sm:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="requires_review" defaultChecked={t?.requires_review ?? false} /> Needs review</label>
        {t && <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={t.is_active} /> In use</label>}
        {!t && <input type="hidden" name="is_active" value="on" />}
      </div>
      <div className="flex justify-end sm:col-span-2"><Submit className="btn-ghost">{t ? "Save" : "Add task"}</Submit></div>
    </ActionForm>
  );
}
