import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { InternalShell } from "@/components/InternalShell";
import { IconBell, IconBlocker, IconCamera, IconDashboard, IconProjects, IconSnag, IconTasks, IconUser } from "@/components/icons";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("employee");
  const { unread, blockers, snags, returned } = await withUser(user.id, async (db) => ({
    unread: await unreadCount(db),
    blockers: (await db.query("select count(*)::int as n from blockers b left join tasks t on t.id = b.task_id where b.resolved_at is null and (b.raised_by = auth.uid() or t.assigned_to = auth.uid())")).rows[0].n as number,
    snags: (await db.query("select count(*)::int as n from snags where deleted_at is null and assigned_to = auth.uid() and status in ('assigned','in_progress','reopened') and resolution_submitted_at is null")).rows[0].n as number,
    returned: (await db.query("select count(*)::int as n from site_updates where deleted_at is null and created_by = auth.uid() and status = 'draft' and review_note is not null")).rows[0].n as number,
  })).catch(() => ({ unread: 0, blockers: 0, snags: 0, returned: 0 }));
  return (
    <InternalShell
      user={user}
      nav={[
        { href: "/e", label: "My Dashboard", exact: true, icon: <IconDashboard /> },
        { href: "/e/tasks", label: "My Tasks", icon: <IconTasks /> },
        { href: "/e/projects", label: "My Projects", icon: <IconProjects /> },
        { href: "/e/updates", label: "Site Updates", icon: <IconCamera />, badge: returned },
        { href: "/e/snags", label: "Snags", icon: <IconSnag />, badge: snags },
        { href: "/e/blockers", label: "Blockers", icon: <IconBlocker />, badge: blockers },
        { href: "/e/notifications", label: "Notifications", icon: <IconBell />, badge: unread },
        { href: "/e/profile", label: "Profile", icon: <IconUser /> },
      ]}
    >
      {children}
    </InternalShell>
  );
}
