import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { taskDetail, taskFormOptions } from "@/lib/execution";
import { TaskDetail } from "@/components/TaskDetail";

export const metadata = { title: "Task" };

export default async function ManagementTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const d = await taskDetail(db, id);
    if (!d) return null;
    return { d, opts: d.task.can_manage ? await taskFormOptions(db, d.task.project_id, id) : undefined };
  });
  if (!data) notFound();
  return <TaskDetail d={data.d} opts={data.opts} base="/m" meId={user.id} />;
}
