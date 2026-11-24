import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { InternalShell } from "@/components/InternalShell";
import { IconBell, IconDashboard, IconProjects, IconTasks, IconUser } from "@/components/icons";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("employee");
  const unread = await withUser(user.id, (db) => unreadCount(db)).catch(() => 0);
  return (
    <InternalShell
      user={user}
      nav={[
        { href: "/e", label: "My Dashboard", exact: true, icon: <IconDashboard /> },
        { href: "/e/tasks", label: "My Tasks", icon: <IconTasks /> },
        { href: "/e/projects", label: "My Projects", icon: <IconProjects /> },
        { href: "/e/notifications", label: "Notifications", icon: <IconBell />, badge: unread },
        { href: "/e/profile", label: "Profile", icon: <IconUser /> },
      ]}
      upcoming={["Site Updates", "Blockers"]}
    >
      {children}
    </InternalShell>
  );
}
