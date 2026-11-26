import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { taskDetail } from "@/lib/execution";
import { TaskDetail } from "@/components/TaskDetail";

export const metadata = { title: "Task" };

export default async function EmployeeTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employee");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  // Returns nothing for tasks on projects this person isn't assigned to (the database refuses)
  const d = await withUser(user.id, (db) => taskDetail(db, id));
  if (!d) notFound();
  return <TaskDetail d={d} base="/e" meId={user.id} />;
}
