import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { myTasks } from "@/lib/queries";
import { Empty, PageHeader, Section } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage() {
  const user = await requireUser("employee");
  const tasks = await withUser(user.id, (db) => myTasks(db));
  const open = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  const done = tasks.filter((t) => t.status === "completed");
  return (
    <>
      <PageHeader title="My tasks" subtitle="Change a status and it saves straight away. Your project manager sees it immediately." />
      <div className="space-y-5">
        <Section title={`Open (${open.length})`}>
          {open.length === 0 ? <div className="p-4"><Empty title="No open tasks" /></div> : <ul className="divide-y divide-line">{open.map((t) => <TaskRow key={t.id} t={t} editable />)}</ul>}
        </Section>
        <Section title={`Completed (${done.length})`}>
          {done.length === 0 ? <div className="p-4"><Empty title="Nothing completed yet" /></div> : <ul className="divide-y divide-line">{done.map((t) => <TaskRow key={t.id} t={t} editable />)}</ul>}
        </Section>
      </div>
    </>
  );
}
