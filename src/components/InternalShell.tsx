import { NavLink } from "./NavLink";
import { Avatar } from "./ui";
import { logout } from "@/app/actions/auth";
import { ROLE_LABEL } from "@/lib/roles";
import type { CurrentUser } from "@/lib/auth";

export type NavItem = { href: string; label: string; exact?: boolean; icon: React.ReactNode };

const linkCls = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-2 hover:bg-canvas hover:text-ink";
const activeCls = "!bg-brand-soft !text-brand-dark font-medium";

export function InternalShell({ user, nav, upcoming, children }: { user: CurrentUser; nav: NavItem[]; upcoming?: string[]; children: React.ReactNode }) {
  const links = nav.map((n) => (
    <NavLink key={n.href} href={n.href} exact={n.exact} className={linkCls} activeClassName={activeCls}>
      <span className="h-4 w-4 shrink-0">{n.icon}</span>
      {n.label}
    </NavLink>
  ));
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Meraghar OS</div>
            <div className="text-[11px] text-ink-3">{user.organisationName}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {links}
          {upcoming && upcoming.length > 0 && (
            <div className="pt-5">
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Coming in next releases</div>
              {upcoming.map((u) => (
                <div key={u} className="px-2.5 py-1.5 text-sm text-ink-3/70">{u}</div>
              ))}
            </div>
          )}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={user.fullName} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{user.fullName}</div>
              <div className="text-[11px] text-ink-3">{ROLE_LABEL[user.role]}</div>
            </div>
          </div>
          <form action={logout}>
            <button className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-3 hover:bg-canvas hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className="text-sm font-semibold">Meraghar OS</span>
        </div>
        <details className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm">
            <Avatar name={user.fullName} size={22} /> Menu
          </summary>
          <div className="absolute right-0 mt-2 w-60 rounded-lg border border-line bg-white p-2 shadow-lg">
            <div className="px-2.5 py-2 text-xs text-ink-3">{user.fullName} · {ROLE_LABEL[user.role]}</div>
            {links}
            <form action={logout}><button className="mt-1 w-full rounded-md px-2.5 py-2 text-left text-sm text-ink-3 hover:bg-canvas">Sign out</button></form>
          </div>
        </details>
      </header>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
