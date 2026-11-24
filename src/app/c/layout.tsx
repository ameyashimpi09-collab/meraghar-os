import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { logout } from "@/app/actions/auth";
import { NavLink } from "@/components/NavLink";

const DESKTOP = [
  { href: "/c", label: "Overview", exact: true },
  { href: "/c/project", label: "Project Timeline" },
  { href: "/c/approvals", label: "Approvals" },
  { href: "/c/payments", label: "Payments" },
  { href: "/c/profile", label: "Account" },
];
const MOBILE = [
  { href: "/c", label: "Home", exact: true },
  { href: "/c/project", label: "Progress" },
  { href: "/c/approvals", label: "Approvals" },
  { href: "/c/payments", label: "Payments" },
  { href: "/c/more", label: "More" },
];

function Bell({ count }: { count: number }) {
  return (
    <Link href="/c/notifications" className="relative inline-flex h-8 w-8 items-center justify-center text-stone hover:text-charcoal" aria-label={`Notifications${count ? `, ${count} unread` : ""}`}>
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
      {count > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-amber px-1 text-center text-[10px] leading-4 text-white">{count > 9 ? "9+" : count}</span>}
    </Link>
  );
}

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("client");
  const unread = await withUser(user.id, (db) => unreadCount(db)).catch(() => 0);
  return (
    <div className="min-h-dvh bg-ivory text-charcoal">
      <header className="sticky top-0 z-20 border-b border-divider bg-ivory/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/c" className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="text-[13px] tracking-[0.32em] uppercase">Meraghar</span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {DESKTOP.map((n) => (
              <NavLink key={n.href} href={n.href} exact={n.exact} className="border-b border-transparent pb-0.5 text-sm text-stone hover:text-charcoal" activeClassName="!border-charcoal !text-charcoal">
                {n.label}
              </NavLink>
            ))}
            <Bell count={unread} />
            <form action={logout}><button className="text-sm text-stone hover:text-charcoal">Sign out</button></form>
          </nav>
          <div className="flex items-center gap-2 md:hidden">
            <span className="text-sm text-stone">{user.fullName.split(" ")[0]}</span>
            <Bell count={unread} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pt-8 pb-28 sm:px-8 md:pb-16">{children}</main>
      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-divider bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {MOBILE.map((n) => (
          <NavLink key={n.href} href={n.href} exact={n.exact} className="py-3.5 text-center text-[11px] tracking-wide text-stone" activeClassName="!text-charcoal font-medium">
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
