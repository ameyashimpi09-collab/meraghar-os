import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { fmtDate } from "@/lib/format";
import { clientProjectId, snagList, SNAG_CATEGORY_LABEL, SNAG_CLIENT_LABEL } from "@/lib/release4";

export const metadata = { title: "Snags & concerns" };

/* eslint-disable @typescript-eslint/no-explicit-any */
const tone = (s: string) => s === "resolved" ? "text-sage" : s === "awaiting_client_confirmation" ? "text-amber" : s === "reopened" || s === "open" ? "text-alert" : "text-stone";

function Rows({ rows }: { rows: any[] }) {
  return (
    <ul className="divide-y divide-divider border-y border-divider">
      {rows.map((s) => (
        <li key={s.id}>
          <Link href={`/c/snags/${s.id}`} className="flex items-start gap-5 py-5 hover:bg-paper/70">
            <div className="h-16 w-16 shrink-0 overflow-hidden bg-divider">{s.thumb && <img src={fileUrl(s.thumb)} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] tracking-[0.2em] text-stone uppercase">{s.area} · {SNAG_CATEGORY_LABEL[s.category]}</div>
              <div className="mt-1 line-clamp-2 font-serif text-xl leading-snug">{s.description}</div>
              <div className="mt-1 text-xs text-stone">Raised {fmtDate(new Date(s.created_at).toISOString().slice(0, 10))}</div>
            </div>
            <div className={`shrink-0 pt-1 text-right text-sm ${tone(s.status)}`}>{SNAG_CLIENT_LABEL[s.status]}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ClientSnags() {
  const user = await requireUser("client");
  const rows = await withUser(user.id, async (db) => {
    const pid = await clientProjectId(db);
    return pid ? await snagList(db, { projectId: pid, view: "all" }) : null;
  });
  if (!rows) return <p className="py-20 text-center text-stone">Your project is being set up.</p>;
  const confirm = rows.filter((s) => s.status === "awaiting_client_confirmation");
  const open = rows.filter((s) => !["resolved", "awaiting_client_confirmation"].includes(s.status));
  const closed = rows.filter((s) => s.status === "resolved");
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-serif text-5xl">Snags &amp; concerns</h1>
          <p className="mt-4 max-w-xl text-stone">Anything at your home that is not right. Tell us with a photo; you can follow it here until it is fixed and you have confirmed it.</p>
        </div>
        <Link href="/c/snags/new" className="bg-charcoal px-6 py-3 text-sm tracking-wide text-ivory hover:bg-black">Raise a concern</Link>
      </div>
      {rows.length === 0 && <p className="mt-16 font-serif text-2xl text-charcoal/70">No concerns raised. If something is not right, we want to know.</p>}
      {confirm.length > 0 && <section className="mt-12"><div className="mb-3 text-[11px] tracking-[0.25em] text-amber uppercase">Please check and confirm · {confirm.length}</div><Rows rows={confirm} /></section>}
      {open.length > 0 && <section className="mt-12"><div className="mb-3 text-[11px] tracking-[0.25em] text-stone uppercase">Being handled · {open.length}</div><Rows rows={open} /></section>}
      {closed.length > 0 && <section className="mt-12"><div className="mb-3 text-[11px] tracking-[0.25em] text-stone uppercase">Resolved · {closed.length}</div><Rows rows={closed} /></section>}
    </>
  );
}
