import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { myNotifications } from "@/lib/notifications";
import { PageHeader } from "@/components/ui";
import { NotificationList } from "@/components/NotificationList";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser("management");
  const items = await withUser(user.id, (db) => myNotifications(db));
  return (
    <>
      <PageHeader title="Notifications" subtitle="Approvals, payments and reminders for your projects. Click one to open it." />
      <div className="max-w-3xl"><NotificationList items={items} /></div>
    </>
  );
}
