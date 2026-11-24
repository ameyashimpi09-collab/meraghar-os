import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { myNotifications } from "@/lib/notifications";
import { NotificationList } from "@/components/NotificationList";

export const metadata = { title: "Notifications" };

export default async function ClientNotifications() {
  const user = await requireUser("client");
  const items = await withUser(user.id, (db) => myNotifications(db));
  return (
    <>
      <h1 className="font-serif text-5xl">Notifications</h1>
      <div className="mt-10 max-w-2xl"><NotificationList items={items} variant="client" /></div>
    </>
  );
}
