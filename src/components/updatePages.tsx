import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { siteUpdateDetail, siteUpdateList, updateFormOptions } from "@/lib/release4";
import { Badge, Empty, PageHeader, Section } from "./ui";
import { DeleteDraftButton, ReviewPanel, UpdateForm, UpdateList, UpdatePhotos, UpdateSummary, updateState } from "./siteUpdates";

type Base = "/m" | "/e";
const area = (base: Base) => (base === "/m" ? "management" : "employee") as "management" | "employee";

const VIEWS_M = [["review", "To review"], ["shared", "Shared with clients"], ["internal", "Internal"], ["drafts", "Drafts"], ["all", "All"]] as const;
const VIEWS_E = [["mine", "My updates"], ["shared", "Shared with clients"], ["all", "All on my projects"]] as const;

export async function UpdatesIndex({ base, sp }: { base: Base; sp: { view?: string; project?: string } }) {
  const user = await requireUser(area(base));
  const views = base === "/m" ? VIEWS_M : VIEWS_E;
  const view = sp.view && views.some(([k]) => k === sp.view) ? sp.view : views[0][0];
  const { rows, counts, projects } = await withUser(user.id, async (db) => ({
    rows: await siteUpdateList(db, { view: view === "mine" ? "all" : view, mine: view === "mine", projectId: sp.project || null }),
    counts: (await db.query(`select count(*) filter (where status = 'pending_review' and can_manage_project(project_id))::int as review,
                                    count(*) filter (where status = 'draft' and created_by = auth.uid())::int as drafts
                               from site_updates where deleted_at is null`)).rows[0],
    projects: (await updateFormOptions(db)).projects,
  }));
  const q = (v: string) => `?view=${v}${sp.project ? `&project=${sp.project}` : ""}`;
  return (
    <>
      <PageHeader
        title="Site updates"
        subtitle={base === "/m" ? "Progress reports and photos from site. Review what the team sends and share it with the client." : "Report progress from site with photos. Your project manager reviews before the client sees it."}
        actions={<Link href={`${base}/updates/new${sp.project ? `?project=${sp.project}` : ""}`} className="btn-brand">+ New site update</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {views.map(([k, label]) => (
          <Link key={k} href={q(k)} className={`rounded-full border px-3 py-1 text-sm ${view === k ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-ink-2 hover:bg-canvas"}`}>
            {label}{k === "review" && counts.review ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-[10px] text-white">{counts.review}</span> : null}
          </Link>
        ))}
        <form className="ml-auto">
          <input type="hidden" name="view" value={view} />
          <select name="project" defaultValue={sp.project ?? ""} className="input !w-auto !py-1 text-sm" aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn-ghost ml-2 !py-1 text-sm">Filter</button>
        </form>
      </div>
      <section className="card">
        <UpdateList rows={rows} base={base} empty={<Empty title={view === "review" ? "Nothing waiting for review" : "No site updates here yet"}>{view === "review" ? "Updates the team sends for review will appear here." : "Post the first update from site with a few photos."}</Empty>} />
      </section>
    </>
  );
}

export async function UpdateNew({ base, sp }: { base: Base; sp: { project?: string } }) {
  const user = await requireUser(area(base));
  const opts = await withUser(user.id, (db) => updateFormOptions(db));
  const chosen = opts.projects.find((p) => p.id === sp.project);
  const canManage = chosen ? chosen.can_manage : base === "/m" && opts.projects.length > 0 && opts.projects.every((p) => p.can_manage);
  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href={`${base}/updates`} className="hover:underline">Site updates</Link></div>
      <PageHeader title="New site update" subtitle="Write what happened on site and add photos. Large photos are reduced automatically." />
      {opts.projects.length === 0 ? <Empty title="You are not on any active project yet" /> : (
        <div className="card max-w-3xl p-4 sm:p-6"><UpdateForm projects={opts.projects} stages={opts.stages} projectId={sp.project ?? null} canManage={canManage} /></div>
      )}
    </>
  );
}

const SAVED: Record<string, string> = {
  review: "Sent to the project manager for review.", share: "Shared with the client. They have been notified.",
  internal: "Saved as an internal update. The client will not see it.", draft: "Draft saved.",
};

export async function UpdateDetailPage({ base, id, sp }: { base: Base; id: string; sp: { saved?: string } }) {
  const user = await requireUser(area(base));
  const data = await withUser(user.id, async (db) => {
    const u = await siteUpdateDetail(db, id);
    if (!u) return null;
    return { u, opts: await updateFormOptions(db) };
  }).catch(() => null);
  if (!data) notFound();
  const { u, opts } = data;
  const st = updateState(u);
  const authorEditable = u.is_author && ["draft", "pending_review"].includes(u.status);
  const editable = u.can_manage || authorEditable;
  return (
    <>
      <div className="mb-1 text-xs text-ink-3">
        <Link href={`${base}/updates`} className="hover:underline">Site updates</Link> / <Link href={`${base}/projects/${u.project_id}`} className="hover:underline">{u.project_code}</Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{u.title || u.work_category || "Site update"}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span>{u.project_name}{u.area ? ` · ${u.area}` : ""}{u.stage_name ? ` · ${u.stage_name}` : ""}</span>
          </div>
        </div>
        {u.status === "draft" && authorEditable && <DeleteDraftButton u={u} />}
      </div>
      {sp.saved && SAVED[sp.saved] && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{SAVED[sp.saved]}</div>}
      {u.review_note && u.status === "draft" && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><b>Sent back by the project manager:</b> {u.review_note}</div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Section title={`Photos (${(u.media ?? []).length})`}>
            <UpdatePhotos u={u} editable={editable} />
          </Section>
          <Section title="Update">
            {editable ? <div className="p-4"><UpdateForm u={u} projects={opts.projects} stages={opts.stages} canManage={u.can_manage} /></div> : <UpdateSummary u={u} />}
          </Section>
        </div>
        <div className="space-y-5">
          {u.can_manage && <Section title={u.status === "published" && u.client_visible ? "Shared with the client" : "Review and share"}><ReviewPanel u={u} /></Section>}
          {!u.can_manage && (
            <Section title="What happens next">
              <p className="p-4 text-sm text-ink-2">
                {u.status === "pending_review" ? "Your project manager has been notified and will share it with the client after checking." :
                  u.status === "draft" ? "Send it for review when it is ready, or keep it as an internal record." :
                  u.client_visible && u.status === "published" ? "The client can see this update and its client-visible photos." : "This update is for the team only."}
              </p>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
