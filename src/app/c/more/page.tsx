import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { logout } from "@/app/actions/auth";

export const metadata = { title: "More" };

export default async function ClientMore() {
  const user = await requireUser("client");
  const unread = await withUser(user.id, (db) => unreadCount(db));
  const items = [
    { href: "/c/payments", label: "Payments", note: "" },
    { href: "/c/purchases", label: "Purchases", note: "" },
    { href: "/c/snags", label: "Snags & concerns", note: "" },
    { href: "/c/documents", label: "Documents", note: "" },
    { href: "/c/notifications", label: "Notifications", note: unread ? `${unread} unread` : "" },
    { href: "/c/profile", label: "Account", note: "" },
  ];
  return (
    <>
      <h1 className="font-serif text-5xl">More</h1>
      <ul className="mt-10 divide-y divide-divider border-y border-divider">
        {items.map((i) => (
          <li key={i.href}><Link href={i.href} className="flex items-baseline justify-between py-5"><span className="font-serif text-2xl">{i.label}</span><span className="text-sm text-amber">{i.note}</span></Link></li>
        ))}
        <li><form action={logout}><button className="w-full py-5 text-left font-serif text-2xl text-stone">Sign out</button></form></li>
      </ul>
    </>
  );
}
