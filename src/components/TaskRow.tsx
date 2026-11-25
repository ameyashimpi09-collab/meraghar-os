import Link from "next/link";
import { fmtDate, relDay, PRIORITY_LABEL, TASK_STATUS_LABEL, todayIST } from "@/lib/format";
import { Badge, PRIORITY_TONE } from "./ui";
import { quickStatusAction } from "@/app/actions/tasks";
import AutoSubmitSelect from "./AutoSubmitSelect";
import { TASK_TONE, WaitingOn } from "./execution";

const QUICK = Object.entries(TASK_STATUS_LABEL).filter(([k]) => !["blocked", "cancelled"].includes(k)) as [string, string][];

/* eslint-disable @typescript-eslint/no-explicit-any */
export function TaskRow({ t, editable = false, base = "/e", showProject = true, showAssignee = false }: {
  t: any; editable?: boolean; base?: "/e" | "/m"; showProject?: boolean; showAssignee?: boolean;
}) {
  const open = !["completed", "cancelled"].includes(t.status);
  const overdue = open && t.due_date && t.due_date < todayIST();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <Link href={`${base}/tasks/${t.id}`} className={`text-sm font-medium hover:underline ${t.status === "completed" || t.status === "cancelled" ? "text-ink-3 line-through" : ""}`}>{t.title}</Link>
        <div className="text-xs text-ink-3">
          {[
            showProject && t.project_name,
            t.stage_name,
            showAssignee && (t.assignee_name ?? <span key="u" className="text-amber-700">Unassigned</span>),
            t.comment_count > 0 && `${t.comment_count} comment${t.comment_count > 1 ? "s" : ""}`,
            t.file_count > 0 && `${t.file_count} file${t.file_count > 1 ? "s" : ""}`,
          ].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
        </div>
        {t.status === "blocked" && t.blocked_reason && <div className="mt-0.5 text-xs text-red-700">Blocked: {t.blocked_reason}</div>}
        {open && <WaitingOn items={t.waiting_on} />}
      </div>
      <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
      <div className={`w-24 text-xs ${overdue ? "font-medium text-red-600" : "text-ink-2"}`}>
        {t.due_date ? fmtDate(t.due_date, { year: false }) : <span className="text-ink-3">No deadline</span>}
        {t.due_date && open ? <div className="text-[11px] font-normal">{relDay(t.due_date)}</div> : null}
      </div>
      <div className="w-36 text-right">
        {t.awaiting_review ? <Badge tone="blue">Awaiting review</Badge>
          : editable && open && t.status !== "blocked" ? (
            <form action={quickStatusAction}>
              <input type="hidden" name="id" value={t.id} />
              <AutoSubmitSelect name="status" defaultValue={t.status} options={QUICK} />
            </form>
          ) : <Badge tone={TASK_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>}
      </div>
    </li>
  );
}
