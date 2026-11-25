import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { InternalShell } from "@/components/InternalShell";
import { IconApprovals, IconBell, IconDashboard, IconPayments, IconProjects, IconSchedule, IconSettings, IconTasks, IconTeam, IconUser } from "@/components/icons";

export default async function ManagementLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("management");
  const counts = await withUser(user.id, async (db) => ({
    unread: await unreadCount(db),
    approvals: (await db.query("select count(*)::int as n from approvals where deleted_at is null and status in ('query_raised','changes_requested')")).rows[0].n as number,
    review: (await db.query("select count(*)::int as n from tasks t where t.deleted_at is null and t.requires_review and t.status = 'completed' and t.reviewed_at is null and can_manage_project(t.project_id)")).rows[0].n as number,
  })).catch(() => ({ unread: 0, approvals: 0, review: 0 }));
  return (
    <InternalShell
      user={user}
      nav={[
        { href: "/m", label: "Dashboard", exact: true, icon: <IconDashboard /> },
        { href: "/m/projects", label: "Projects", icon: <IconProjects /> },
        { href: "/m/tasks", label: "Tasks", icon: <IconTasks />, badge: counts.review },
        { href: "/m/approvals", label: "Approvals", icon: <IconApprovals />, badge: counts.approvals },
        { href: "/m/payments", label: "Payments", icon: <IconPayments /> },
        { href: "/m/schedule", label: "Execution Schedule", icon: <IconSchedule /> },
        { href: "/m/notifications", label: "Notifications", icon: <IconBell />, badge: counts.unread },
        { href: "/m/team", label: "Team & Clients", icon: <IconTeam /> },
        { href: "/m/settings", label: "Settings", icon: <IconSettings /> },
        { href: "/m/profile", label: "My Profile", icon: <IconUser /> },
      ]}
      upcoming={["Site Updates", "Procurement", "Snags", "Reports"]}
    >
      {children}
    </InternalShell>
  );
}
