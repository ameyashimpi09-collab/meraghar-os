import Link from "next/link";
import { fileUrl } from "@/lib/files";
import { AREAS, fmtDate, fmtDateTime, todayIST } from "@/lib/format";
import { ActionForm, Submit } from "./ActionForm";
import { FileInput } from "./FileInput";
import { Badge, Empty } from "./ui";
import { addUpdatePhotosAction, deleteDraftUpdateAction, reviewSiteUpdateAction, saveSiteUpdateAction, updatePhotoAction } from "@/app/actions/siteUpdates";

/* eslint-disable @typescript-eslint/no-explicit-any */
type U = Record<string, any>;

export const WORK_CATEGORIES = ["Civil work", "Electrical", "Plumbing", "False ceiling", "Carpentry", "Kitchen", "Wardrobes", "Painting", "Wall treatments", "Furniture", "Lighting", "Curtains & soft furnishings", "Cleaning", "Other"];

export function updateState(u: U): { label: string; tone: "gray" | "amber" | "green" | "blue" | "red" } {
  if (u.status === "pending_review") return { label: "Waiting for review", tone: "amber" };
  if (u.status === "published" && u.client_visible) return { label: "Shared with client", tone: "green" };
  if (u.status === "published") return { label: "Internal only", tone: "blue" };
  if (u.status === "archived") return { label: "Withdrawn", tone: "gray" };
  return { label: "Draft", tone: "gray" };
}

function istParts(ts: string | Date | null | undefined) {
  const d = ts ? new Date(ts) : new Date();
  const s = d.toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }); // "2026-11-27 14:05:00"
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** Write or edit a site update. Buttons depend on who is writing and where it stands. */
export function UpdateForm({ u, projects, stages, projectId, canManage }: {
  u?: U; projects: U[]; stages: U[]; projectId?: string | null; canManage: boolean;
}) {
  const when = istParts(u?.site_datetime);
  const pid = u?.project_id ?? projectId ?? (projects.length === 1 ? projects[0].id : "");
  const shared = u && u.status === "published" && u.client_visible;
  return (
    <ActionForm action={saveSiteUpdateAction} className="space-y-4">
      {u && <input type="hidden" name="id" value={u.id} />}
      {!u && (
        <div>
          <label className="label" htmlFor="project_id">Project</label>
          <select id="project_id" name="project_id" defaultValue={pid} className="input" required>
            <option value="">Choose…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.project_code})</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label" htmlFor="title">Headline</label>
        <input id="title" name="title" defaultValue={u?.title ?? ""} className="input" placeholder="e.g. Kitchen carpentry underway" maxLength={120} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div><label className="label" htmlFor="site_date">Site date</label><input id="site_date" type="date" name="site_date" defaultValue={when.date} max={todayIST()} className="input" required /></div>
        <div><label className="label" htmlFor="site_time">Time</label><input id="site_time" type="time" name="site_time" defaultValue={when.time} className="input" /></div>
        <div>
          <label className="label" htmlFor="area">Area</label>
          <input id="area" name="area" list="areas" defaultValue={u?.area ?? ""} className="input" placeholder="e.g. Kitchen" />
          <datalist id="areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="work_category">Work</label>
          <input id="work_category" name="work_category" list="workcats" defaultValue={u?.work_category ?? ""} className="input" placeholder="e.g. Carpentry" />
          <datalist id="workcats">{WORK_CATEGORIES.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="stage_id">Stage (optional)</label>
        <select id="stage_id" name="stage_id" defaultValue={u?.stage_id ?? ""} className="input">
          <option value="">—</option>
          {stages.filter((s) => !pid || s.project_id === pid).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!pid && <p className="mt-1 text-xs text-ink-3">Stages of the chosen project can be picked after saving.</p>}
      </div>
      <div><label className="label" htmlFor="work_completed">Work completed</label><textarea id="work_completed" name="work_completed" rows={3} defaultValue={u?.work_completed ?? ""} className="input" required placeholder="What was finished since the last update" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="current_activity">Current activity</label><textarea id="current_activity" name="current_activity" rows={2} defaultValue={u?.current_activity ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="next_activity">Next planned activity</label><textarea id="next_activity" name="next_activity" rows={2} defaultValue={u?.next_activity ?? ""} className="input" /></div>
      </div>
      <div>
        <label className="label" htmlFor="blockers">Challenges / blockers <span className="font-normal text-ink-3">(team only, never shown to the client)</span></label>
        <textarea id="blockers" name="blockers" rows={2} defaultValue={u?.blockers ?? ""} className="input" />
      </div>
      <div className="rounded-md border border-line bg-canvas/60 p-3">
        <FileInput name="photos" label={u ? "Add more photos" : "Photos"} />
        <label className="mt-2 flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="photos_internal" /> These photos are for the team only (the client never sees them)</label>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {shared ? (
          <Submit name="intent" value="keep">Save changes</Submit>
        ) : canManage ? (
          <>
            <Submit name="intent" value="share" pendingText="Sharing…">Share with client</Submit>
            <Submit name="intent" value="internal" className="btn-ghost">Save as internal only</Submit>
            <Submit name="intent" value="draft" className="btn-ghost">Save draft</Submit>
          </>
        ) : (
          <>
            <Submit name="intent" value="review" pendingText="Sending…">Send for review</Submit>
            <Submit name="intent" value="internal" className="btn-ghost">Save as internal only</Submit>
            <Submit name="intent" value="draft" className="btn-ghost">Save draft</Submit>
          </>
        )}
      </div>
      {!canManage && !shared && <p className="text-xs text-ink-3">“Send for review” goes to the project manager, who checks the photos and shares it with the client.</p>}
    </ActionForm>
  );
}

/** Photos of an update, with the client/internal marker. Managers can change each one. */
export function UpdatePhotos({ u, editable }: { u: U; editable: boolean }) {
  const media: U[] = u.media ?? [];
  if (!media.length) return <p className="px-4 py-3 text-sm text-ink-3">No photos yet.</p>;
  return (
    <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {media.map((m) => {
        const isImg = (m.mime ?? "image/").startsWith("image/");
        return (
          <li key={m.id} className={`overflow-hidden rounded-md border ${m.client_visible ? "border-line" : "border-dashed border-sky-300"}`}>
            <a href={fileUrl(m.file)} target="_blank" className="block bg-canvas">
              {isImg ? <img src={fileUrl(m.file)} alt={m.caption ?? ""} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                : <div className="flex aspect-[4/3] items-center justify-center text-sm text-ink-3">PDF · {m.name}</div>}
            </a>
            <div className="space-y-2 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={m.client_visible ? "green" : "blue"}>{m.client_visible ? "Client can see" : "Team only"}</Badge>
                <span className="truncate text-ink-3">{m.area ?? ""}</span>
              </div>
              {m.caption && !editable && <p className="text-ink-2">{m.caption}</p>}
              {editable && (
                <ActionForm action={updatePhotoAction} className="space-y-1.5">
                  <input type="hidden" name="media_id" value={m.id} />
                  <input name="caption" defaultValue={m.caption ?? ""} placeholder="Caption for the client" className="input !py-1 text-xs" />
                  <input name="area" defaultValue={m.area ?? ""} list="areas" placeholder="Room" className="input !py-1 text-xs" />
                  <div className="flex flex-wrap gap-1.5">
                    <Submit className="btn-ghost !px-2 !py-1 text-xs" name="visible" value={m.client_visible ? "yes" : "no"}>Save</Submit>
                    <Submit className="btn-ghost !px-2 !py-1 text-xs" name="visible" value={m.client_visible ? "no" : "yes"}>{m.client_visible ? "Hide from client" : "Show to client"}</Submit>
                    <Submit className="btn-danger !px-2 !py-1 text-xs" name="remove" value="1" pendingText="…">Remove</Submit>
                  </div>
                </ActionForm>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AddPhotosForm({ u }: { u: U }) {
  return (
    <ActionForm action={addUpdatePhotosAction} className="space-y-2 border-t border-line p-4" resetOnSuccess>
      <input type="hidden" name="id" value={u.id} />
      <FileInput name="photos" label="Add photos" />
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="photos_internal" /> Team only</label>
      <Submit className="btn-ghost" pendingText="Uploading…">Upload</Submit>
    </ActionForm>
  );
}

/** Project manager's decision panel. */
export function ReviewPanel({ u }: { u: U }) {
  const shared = u.status === "published" && u.client_visible;
  const visible = (u.media ?? []).filter((m: U) => m.client_visible).length;
  return (
    <div className="space-y-3 p-4 text-sm">
      {u.status === "pending_review" && <p className="text-ink-2">{u.author_name} sent this for review. Check the text and photos, hide anything the client should not see, then share it.</p>}
      {!shared && <p className="text-xs text-ink-3">{visible} photo{visible === 1 ? "" : "s"} will be visible to the client. Blockers and team-only photos are never shown.</p>}
      <ActionForm action={reviewSiteUpdateAction} className="space-y-2">
        <input type="hidden" name="id" value={u.id} />
        {shared ? (
          <Submit name="decision" value="withdraw" className="btn-ghost" pendingText="Withdrawing…">Withdraw from client</Submit>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Submit name="decision" value="share" pendingText="Sharing…">Share with client</Submit>
            {u.status !== "published" && <Submit name="decision" value="internal" className="btn-ghost">Keep internal</Submit>}
          </div>
        )}
        {u.status === "pending_review" && (
          <div className="space-y-2 border-t border-line pt-3">
            <label className="label" htmlFor="note">Send back to {u.author_name?.split(" ")[0]} with a note</label>
            <textarea id="note" name="note" rows={2} className="input" placeholder="e.g. Please add a wider photo of the kitchen wall" />
            <Submit name="decision" value="return" className="btn-ghost">Send back</Submit>
          </div>
        )}
      </ActionForm>
      {!shared && (
        <ActionForm action={reviewSiteUpdateAction} confirm="Delete this update? This cannot be undone from the app.">
          <input type="hidden" name="id" value={u.id} />
          <Submit name="decision" value="delete" className="text-xs text-red-600 hover:underline" pendingText="Deleting…">Delete update</Submit>
        </ActionForm>
      )}
    </div>
  );
}

export function DeleteDraftButton({ u }: { u: U }) {
  return (
    <ActionForm action={deleteDraftUpdateAction} confirm="Delete this draft?">
      <input type="hidden" name="id" value={u.id} />
      <Submit className="text-xs text-red-600 hover:underline" pendingText="Deleting…">Delete draft</Submit>
    </ActionForm>
  );
}

/** One row in an internal list of updates. */
export function UpdateRow({ u, base }: { u: U; base: "/m" | "/e" }) {
  const st = updateState(u);
  const media: U[] = u.media ?? [];
  return (
    <li>
      <Link href={`${base}/updates/${u.id}`} className="flex gap-3 px-4 py-3 hover:bg-canvas">
        <div className="flex h-16 w-20 shrink-0 overflow-hidden rounded bg-canvas">
          {media[0] && (media[0].mime ?? "image/").startsWith("image/") ? <img src={fileUrl(media[0].file)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="m-auto text-[10px] text-ink-3">No photo</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{u.title || u.work_category || "Site update"}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-2">{u.work_completed}</div>
          <div className="mt-0.5 text-xs text-ink-3">{u.project_name} · {[u.area, u.stage_name].filter(Boolean).join(" · ")}{u.area || u.stage_name ? " · " : ""}{fmtDateTime(u.site_datetime)} · {u.author_name} · {media.length} photo{media.length === 1 ? "" : "s"}</div>
        </div>
      </Link>
    </li>
  );
}

export function UpdateList({ rows, base, empty }: { rows: U[]; base: "/m" | "/e"; empty: React.ReactNode }) {
  if (!rows.length) return <div className="p-4">{empty}</div>;
  return <ul className="divide-y divide-line">{rows.map((u) => <UpdateRow key={u.id} u={u} base={base} />)}</ul>;
}

export function UpdateSummary({ u }: { u: U }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Work completed</dt><dd className="whitespace-pre-line text-ink">{u.work_completed || "—"}</dd></div>
      <div><dt className="text-xs text-ink-3">Current activity</dt><dd className="whitespace-pre-line text-ink">{u.current_activity || "—"}</dd></div>
      <div><dt className="text-xs text-ink-3">Next planned</dt><dd className="whitespace-pre-line text-ink">{u.next_activity || "—"}</dd></div>
      {u.blockers && <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Challenges / blockers (team only)</dt><dd className="whitespace-pre-line text-red-700">{u.blockers}</dd></div>}
      <div><dt className="text-xs text-ink-3">Site visit</dt><dd>{fmtDateTime(u.site_datetime)}</dd></div>
      <div><dt className="text-xs text-ink-3">Written by</dt><dd>{u.author_name ?? "—"}{u.published_at && u.client_visible && u.status === "published" ? <span className="block text-xs text-ink-3">Shared by {u.publisher_name} on {fmtDate(String(new Date(u.published_at).toISOString()).slice(0, 10))}</span> : null}</dd></div>
    </dl>
  );
}

export { Empty };
