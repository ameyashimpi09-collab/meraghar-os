import { fmtDateTime } from "@/lib/format";
import { ActionForm, Submit } from "./ActionForm";
import { markAllReadAction } from "@/app/actions/notifications";

type N = { id: string; title: string; body: string | null; is_critical: boolean; read_at: string | null; created_at: string; project_name: string | null };

/** In-app notification centre. `variant` switches between internal and client styling. */
export function NotificationList({ items, variant = "internal" }: { items: N[]; variant?: "internal" | "client" }) {
  const unread = items.filter((n) => !n.read_at).length;
  const client = variant === "client";
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className={client ? "text-sm text-stone" : "text-sm text-ink-3"}>{unread ? `${unread} unread` : "All caught up"}</span>
        {unread > 0 && (
          <ActionForm action={markAllReadAction}>
            <Submit className={client ? "text-sm underline decoration-divider underline-offset-4" : "btn-ghost py-1.5 text-xs"} pendingText="…">Mark all as read</Submit>
          </ActionForm>
        )}
      </div>
      {items.length === 0 ? (
        <p className={client ? "font-serif text-2xl text-charcoal/70" : "rounded-lg border border-dashed border-line bg-white/60 px-6 py-10 text-center text-sm text-ink-3"}>No notifications yet.</p>
      ) : (
        <ul className={client ? "divide-y divide-divider border-y border-divider" : "card divide-y divide-line"}>
          {items.map((n) => (
            <li key={n.id}>
              <a href={`/n/${n.id}`} className={`flex gap-3 px-4 py-3.5 ${client ? "hover:bg-paper" : "hover:bg-canvas/60"} ${n.read_at ? "opacity-70" : ""}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : n.is_critical ? (client ? "bg-amber" : "bg-amber-500") : client ? "bg-charcoal/40" : "bg-brand"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read_at ? "" : "font-medium"}`}>{n.title}</span>
                  {n.body && <span className={`block text-sm ${client ? "text-charcoal/70" : "text-ink-2"}`}>{n.body}</span>}
                  <span className={`block text-xs ${client ? "text-stone" : "text-ink-3"}`}>{fmtDateTime(n.created_at)}{n.project_name && !client ? ` · ${n.project_name}` : ""}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
