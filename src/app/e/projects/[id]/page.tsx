import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectDetail, myTasks } from "@/lib/queries";
import { fmtDate, POSSESSION_LABEL } from "@/lib/format";
import { MEMBER_ROLE_LABEL } from "@/lib/roles";
import { Avatar, Badge, Empty, Field, HEALTH_LABEL, HEALTH_TONE, Section } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

export default async function EmployeeProject({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employee");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const d = await projectDetail(db, id); // returns null if not assigned (database refuses)
    if (!d) return null;
    return { ...d, tasks: (await myTasks(db)).filter((t) => t.project_id === id) };
  });
  if (!data) notFound();
  const { project: p, members, scope, stages, tasks } = data;
  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/e/projects" className="hover:underline">My projects</Link> / {p.project_code}</div>
      <h1 className="text-xl font-semibold sm:text-2xl">{p.name}</h1>
      <div className="mt-1.5 mb-6 flex flex-wrap items-center gap-2 text-sm text-ink-3">
        {p.health && <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
        <span>{[p.flat_number, p.building_society, p.address_line, p.city].filter(Boolean).join(", ")}</span>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Section title="My tasks on this project">
            {tasks.length === 0 ? <div className="p-4"><Empty title="No tasks assigned to you here" /></div> : <ul className="divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} t={t} editable />)}</ul>}
          </Section>
          <Section title="Scope of work">
            <ul className="divide-y divide-line">
              {scope.filter((s) => s.is_included).map((s) => (
                <li key={s.id} className="px-4 py-2.5 text-sm"><div className="font-medium">{s.category}</div>{s.description && <div className="text-xs text-ink-3">{s.description}</div>}</li>
              ))}
            </ul>
          </Section>
          <Section title="Stages">
            {stages.length === 0 ? <div className="p-4"><Empty title="No stages yet" /></div> : (
              <ol className="divide-y divide-line">{stages.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>{s.name}</span><span className="text-xs text-ink-3">{fmtDate(s.planned_end_date, { year: false })} · {s.completion_pct}%</span>
                </li>))}
              </ol>
            )}
          </Section>
        </div>
        <div className="space-y-5">
          <Section title="Site details">
            <dl className="grid grid-cols-2 gap-4 p-4">
              <Field label="Configuration">{p.property_config}</Field>
              <Field label="Carpet area">{p.carpet_area_sqft ? `${p.carpet_area_sqft} sq ft` : null}</Field>
              <Field label="Possession">{p.possession_status ? POSSESSION_LABEL[p.possession_status] : null}</Field>
              <Field label="Target handover">{fmtDate(p.target_handover_date)}</Field>
            </dl>
          </Section>
          <Section title="Project team">
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.full_name} size={28} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{m.full_name}</div><div className="text-xs text-ink-3">{MEMBER_ROLE_LABEL[m.member_role]}</div></div>
                  {m.phone && <a href={`tel:${m.phone.replace(/\s/g, "")}`} className="text-xs text-brand">{m.phone}</a>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
