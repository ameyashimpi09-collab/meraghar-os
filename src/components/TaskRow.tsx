import Link from "next/link";
import { fmtDate, relDay, PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/format";
import { Badge, PRIORITY_TONE } from "./ui";
import { updateTaskStatus } from "@/app/e/actions";
import AutoSubmitSelect from "./AutoSubmitSelect";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function TaskRow({ t, editable = false }: { t: any; editable?: boolean }) {
  const overdue = t.due_date && relDay(t.due_date).includes("overdue") && !["completed", "cancelled"].includes(t.status);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${t.status === "completed" ? "text-ink-3 line-through" : ""}`}>{t.title}</div>
        <div className="text-xs text-ink-3">
          <Link href={`/e/projects/${t.project_id}`} className="hover:underline">{t.project_name}</Link>
          {t.stage_name ? ` · ${t.stage_name}` : ""}
          {t.blocked_reason && t.status === "blocked" ? <span className="text-red-600"> · {t.blocked_reason}</span> : null}
          {t.waiting_on_client ? <span className="text-amber-700"> · Waiting on client approval</span> : null}
        </div>
      </div>
      <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
      <div className={`w-28 text-xs ${overdue ? "font-medium text-red-600" : "text-ink-2"}`}>
        {fmtDate(t.due_date, { year: false })}{t.due_date && t.status !== "completed" ? <div className="font-normal text-[11px]">{relDay(t.due_date)}</div> : null}
      </div>
      {editable ? (
        <form action={updateTaskStatus}>
          <input type="hidden" name="task_id" value={t.id} />
          <AutoSubmitSelect name="status" defaultValue={t.status} options={Object.entries(TASK_STATUS_LABEL).filter(([k]) => k !== "cancelled")} />
        </form>
      ) : (
        <Badge>{TASK_STATUS_LABEL[t.status]}</Badge>
      )}
    </li>
  );
}
