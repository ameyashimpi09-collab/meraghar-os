import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { fmtDate } from "@/lib/format";
import { clientPhotos, clientProjectId, clientUpdates } from "@/lib/release4";
import { PhotoGrid } from "@/components/client/Lightbox";

export const metadata = { title: "Site updates" };

function day(ts: string | Date) {
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}

export default async function ClientUpdates({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser("client");
  const view = (await searchParams).view === "photos" ? "photos" : "feed";
  const data = await withUser(user.id, async (db) => {
    const pid = await clientProjectId(db);
    if (!pid) return null;
    const [updates, photos, milestones] = await Promise.all([
      clientUpdates(db, pid),
      clientPhotos(db, pid),
      db.query(`select name, status, planned_end_date, actual_end_date from project_stages where project_id = $1 and deleted_at is null and is_milestone and status <> 'skipped' order by sort_order`, [pid]),
    ]);
    return { updates, photos, milestones: milestones.rows };
  });
  if (!data) return <p className="py-20 text-center text-stone">Your project is being set up.</p>;
  const { updates, photos, milestones } = data;
  const areas = [...new Set(photos.map((p) => p.area as string))];
  const done = milestones.filter((m) => m.status === "completed");
  const next = milestones.filter((m) => m.status !== "completed").slice(0, 3);

  return (
    <>
      <h1 className="font-serif text-5xl">Site updates</h1>
      <p className="mt-4 max-w-xl text-stone">Progress from your home, with photographs from site. Our project manager shares a new update regularly and at every important milestone.</p>
      <div className="mt-8 flex gap-6 border-b border-divider text-sm">
        <Link href="/c/updates" className={`-mb-px border-b pb-3 ${view === "feed" ? "border-charcoal text-charcoal" : "border-transparent text-stone"}`}>Progress feed</Link>
        <Link href="/c/updates?view=photos" className={`-mb-px border-b pb-3 ${view === "photos" ? "border-charcoal text-charcoal" : "border-transparent text-stone"}`}>Photos by room · {photos.length}</Link>
      </div>

      {view === "photos" ? (
        photos.length === 0 ? <p className="mt-16 font-serif text-2xl text-charcoal/70">Photographs from site will appear here.</p> : (
          <div className="mt-10 space-y-14">
            {areas.map((a) => {
              const ps = photos.filter((p) => p.area === a);
              return (
                <section key={a}>
                  <div className="mb-4 flex items-baseline justify-between"><h2 className="font-serif text-3xl">{a}</h2><span className="text-xs text-stone">{ps.length} photo{ps.length === 1 ? "" : "s"}</span></div>
                  <PhotoGrid photos={ps.map((p) => ({ src: fileUrl(p.file), caption: p.caption, meta: `${p.title ?? "Site update"} · ${day(p.site_datetime)}` }))} className="grid grid-cols-2 gap-2 md:grid-cols-4" />
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="mt-10 grid gap-14 lg:grid-cols-[1fr_260px]">
          <div>
            {updates.length === 0 ? <p className="font-serif text-2xl text-charcoal/70">Your first site update will appear here once work begins.</p> : (
              <ol className="space-y-16">
                {updates.map((u) => {
                  const pics = (u.media as { file: string; caption: string | null; mime: string | null }[]).filter((m) => (m.mime ?? "image/").startsWith("image/"));
                  const docs = (u.media as { file: string; name: string | null; mime: string | null }[]).filter((m) => !(m.mime ?? "image/").startsWith("image/"));
                  return (
                    <li key={u.id} id={`u-${u.id}`} className="scroll-mt-24">
                      <div className="text-[11px] tracking-[0.25em] text-stone uppercase">{day(u.site_datetime)}{u.area ? ` · ${u.area}` : ""}</div>
                      <h2 className="mt-2 font-serif text-4xl leading-tight">{u.title || u.work_category || "Site progress"}</h2>
                      {u.stage_name && <div className="mt-1 text-sm text-stone">{u.stage_name}</div>}
                      {pics.length > 0 && (
                        <div className="mt-6">
                          {pics.length === 1 ? <PhotoGrid photos={[{ src: fileUrl(pics[0].file), caption: pics[0].caption }]} className="grid" tile="aspect-[16/9]" />
                            : <PhotoGrid photos={pics.map((m) => ({ src: fileUrl(m.file), caption: m.caption }))} className="grid grid-cols-2 gap-2 md:grid-cols-3" />}
                        </div>
                      )}
                      <div className="mt-6 grid gap-6 text-[15px] leading-relaxed sm:grid-cols-3">
                        <div className="sm:col-span-3"><div className="text-[11px] tracking-[0.2em] text-stone uppercase">Completed</div><p className="mt-1 whitespace-pre-line">{u.work_completed}</p></div>
                        {u.current_activity && <div className="sm:col-span-3 md:col-span-1"><div className="text-[11px] tracking-[0.2em] text-stone uppercase">Now</div><p className="mt-1 whitespace-pre-line text-charcoal/80">{u.current_activity}</p></div>}
                        {u.next_activity && <div className="sm:col-span-3 md:col-span-2"><div className="text-[11px] tracking-[0.2em] text-stone uppercase">Next</div><p className="mt-1 whitespace-pre-line text-charcoal/80">{u.next_activity}</p></div>}
                      </div>
                      {docs.length > 0 && <div className="mt-4 text-sm">{docs.map((d) => <a key={d.file} href={fileUrl(d.file)} target="_blank" className="mr-4 underline decoration-divider underline-offset-4">{d.name ?? "Document"}</a>)}</div>}
                      <div className="mt-6 h-px bg-divider" />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <aside className="space-y-10 lg:sticky lg:top-24 lg:self-start">
            <section>
              <div className="text-[11px] tracking-[0.25em] text-stone uppercase">Milestones completed</div>
              {done.length === 0 ? <p className="mt-3 text-sm text-stone">None yet.</p> : (
                <ul className="mt-4 space-y-3">{done.map((m) => <li key={m.name} className="flex items-baseline gap-3"><span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-sage" /><span className="flex-1">{m.name}</span><span className="text-xs text-stone">{fmtDate(m.actual_end_date ?? m.planned_end_date, { year: false })}</span></li>)}</ul>
              )}
            </section>
            <section>
              <div className="text-[11px] tracking-[0.25em] text-stone uppercase">Coming up</div>
              {next.length === 0 ? <p className="mt-3 text-sm text-stone">We will share the next milestones soon.</p> : (
                <ul className="mt-4 space-y-3">{next.map((m) => <li key={m.name} className="flex items-baseline gap-3"><span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full border border-amber" /><span className="flex-1">{m.name}</span><span className="text-xs text-stone">{fmtDate(m.planned_end_date, { year: false })}</span></li>)}</ul>
              )}
            </section>
            <Link href="/c/project" className="inline-block text-sm underline decoration-divider underline-offset-4">Full timeline →</Link>
          </aside>
        </div>
      )}
    </>
  );
}
