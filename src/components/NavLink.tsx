"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, exact = false, className, activeClassName }: {
  href: string; children: React.ReactNode; exact?: boolean; className: string; activeClassName: string;
}) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={`${className} ${active ? activeClassName : ""}`} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
