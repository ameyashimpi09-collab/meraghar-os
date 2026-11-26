import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { InternalShell } from "@/components/InternalShell";
import { IconBell, IconBlocker, IconDashboard, IconProjects, IconTasks, IconUser } from "@/components/icons";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("employee");
  const { unread, blockers } = await withUser(user.id, async (db) => ({
    unread: await unreadCount(db),
    blockers: (await db.query("select count(*)::int as n from blockers b left join tasks t on t.id = b.task_id where b.resolved_at is null and (b.raised_by = auth.uid() or t.assigned_to = auth.uid())")).rows[0].n as number,
  })).catch(() => ({ unread: 0, blockers: 0 }));
  return (
    <InternalShell
      user={user}
      nav={[
        { href: "/e", label: "My Dashboard", exact: true, icon: <IconDashboard /> },
        { href: "/e/tasks", label: "My Tasks", icon: <IconTasks /> },
        { href: "/e/projects", label: "My Projects", icon: <IconProjects /> },
        { href: "/e/blockers", label: "Blockers", icon: <IconBlocker />, badge: blockers },
        { href: "/e/notifications", label: "Notifications", icon: <IconBell />, badge: unread },
        { href: "/e/profile", label: "Profile", icon: <IconUser /> },
      ]}
      upcoming={["Site Updates"]}
    >
      {children}
    </InternalShell>
  );
}
