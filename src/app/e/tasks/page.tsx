import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { taskList } from "@/lib/execution";
import { todayIST, addDays } from "@/lib/format";
import { Empty, PageHeader, Section } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage() {
  const user = await requireUser("employee");
  const tasks = await withUser(user.id, (db) => taskList(db, { mine: true, view: "all" }));
  const today = todayIST();
  const open = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  const stuck = open.filter((t) => ["blocked", "waiting_client", "waiting_vendor"].includes(t.status) || t.waiting_on?.length);
  const ready = open.filter((t) => !stuck.includes(t));
  const groups: [string, typeof tasks, string][] = [
    ["Overdue", ready.filter((t) => t.due_date && t.due_date < today), "Nothing overdue."],
    ["Today", ready.filter((t) => t.due_date === today), "Nothing due today."],
    ["This week", ready.filter((t) => t.due_date && t.due_date > today && t.due_date <= addDays(today, 7)), "Nothing else this week."],
    ["Later", ready.filter((t) => !t.due_date || t.due_date > addDays(today, 7)), "Nothing later."],
    ["Blocked or waiting", stuck, "Nothing is stuck."],
    ["Completed", tasks.filter((t) => t.status === "completed").slice(0, 30), "Nothing completed yet."],
  ];
  return (
    <>
      <PageHeader title="My tasks" subtitle="Change a status and it saves straight away. Open a task to add photos, comments or completion evidence, or to flag a blocker." />
      <div className="space-y-5">
        {groups.map(([title, list, empty]) => (
          (list.length > 0 || ["Overdue", "Today"].includes(title)) && (
            <Section key={title} title={`${title} (${list.length})`}>
              {list.length === 0 ? <div className="p-4"><Empty title={empty} /></div> : <ul className="divide-y divide-line">{list.map((t) => <TaskRow key={t.id} t={t} editable />)}</ul>}
            </Section>
          )
        ))}
      </div>
    </>
  );
}
