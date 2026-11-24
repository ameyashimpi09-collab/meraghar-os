import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { NavLink } from "@/components/NavLink";

const NAV = [
  { href: "/c", label: "Overview", short: "Home", exact: true },
  { href: "/c/project", label: "My Project", short: "Project" },
  { href: "/c/profile", label: "Account", short: "Account" },
];

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("client");
  return (
    <div className="min-h-dvh bg-ivory text-charcoal">
      <header className="sticky top-0 z-20 border-b border-divider bg-ivory/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/c" className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="text-[13px] tracking-[0.32em] uppercase">Meraghar</span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.href} href={n.href} exact={n.exact} className="border-b border-transparent pb-0.5 text-sm text-stone hover:text-charcoal" activeClassName="!border-charcoal !text-charcoal">
                {n.label}
              </NavLink>
            ))}
            <form action={logout}><button className="text-sm text-stone hover:text-charcoal">Sign out</button></form>
          </nav>
          <span className="text-sm text-stone md:hidden">{user.fullName.split(" ")[0]}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pt-8 pb-28 sm:px-8 md:pb-16">{children}</main>
      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-divider bg-paper/95 backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.href} href={n.href} exact={n.exact} className="py-3.5 text-center text-xs tracking-wide text-stone" activeClassName="!text-charcoal font-medium">
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
