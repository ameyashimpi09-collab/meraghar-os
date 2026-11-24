import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { orgPeople } from "@/lib/queries";
import { ROLE_LABEL, creatableRoles, isOrgAdmin } from "@/lib/roles";
import { Avatar, Badge, Empty, PageHeader } from "@/components/ui";
import { setActiveAction } from "../actions";
import AddPersonForm from "./AddPersonForm";

export const metadata = { title: "Team & Clients" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("management");
  const tab = (await searchParams).tab === "clients" ? "clients" : "team";
  const all = await withUser(user.id, (db) => orgPeople(db));
  const list = all.filter((p) => (tab === "clients" ? p.role === "client" : p.role !== "client"));
  const roles = creatableRoles(user.role);

  return (
    <>
      <PageHeader title="Team & Clients" subtitle="Everyone with a Meraghar login. Workload counts come from real assigned tasks." />
      <div className="mb-4 flex gap-1 border-b border-line">
        {(["team", "clients"] as const).map((t) => (
          <Link key={t} href={`/m/team${t === "clients" ? "?tab=clients" : ""}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-brand font-medium text-ink" : "border-transparent text-ink-3"}`}>
            {t === "team" ? "Team" : "Clients"} <span className="text-ink-3">({all.filter((p) => (t === "clients" ? p.role === "client" : p.role !== "client")).length})</span>
          </Link>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="card overflow-hidden">
          {list.length === 0 ? <div className="p-4"><Empty title="Nobody here yet" /></div> : (
            <ul className="divide-y divide-line">
              {list.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${p.is_active ? "" : "opacity-60"}`}>
                  <Avatar name={p.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">{p.full_name} {!p.is_active && <Badge tone="red">Deactivated</Badge>}</div>
                    <div className="truncate text-xs text-ink-3">{p.designation ?? ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]} · {p.email}{p.phone ? ` · ${p.phone}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-ink-2">
                    <span><span className="font-semibold text-ink">{p.active_projects}</span> active project{p.active_projects === 1 ? "" : "s"}</span>
                    {p.role !== "client" && <span><span className="font-semibold text-ink">{p.open_tasks}</span> open tasks{p.overdue_tasks > 0 && <span className="text-red-600"> ({p.overdue_tasks} overdue)</span>}</span>}
                    <Badge tone={p.role === "client" ? "brand" : "gray"}>{ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]}</Badge>
                    {isOrgAdmin(user.role) && p.id !== user.id && p.role !== "owner" && (
                      <form action={setActiveAction}>
                        <input type="hidden" name="profile_id" value={p.id} /><input type="hidden" name="active" value={String(!p.is_active)} />
                        <button className="text-ink-3 hover:text-ink">{p.is_active ? "Deactivate" : "Reactivate"}</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {roles.length > 0 && <AddPersonForm roles={roles.filter((r) => (tab === "clients" ? r === "client" : r !== "client"))} />}
      </div>
    </>
  );
}
