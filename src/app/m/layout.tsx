import { requireUser } from "@/lib/auth";
import { InternalShell } from "@/components/InternalShell";
import { IconDashboard, IconProjects, IconTeam, IconUser } from "@/components/icons";

export default async function ManagementLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("management");
  return (
    <InternalShell
      user={user}
      nav={[
        { href: "/m", label: "Dashboard", exact: true, icon: <IconDashboard /> },
        { href: "/m/projects", label: "Projects", icon: <IconProjects /> },
        { href: "/m/team", label: "Team & Clients", icon: <IconTeam /> },
        { href: "/m/profile", label: "My Profile", icon: <IconUser /> },
      ]}
      upcoming={["Approvals", "Payments", "Execution Schedule", "Tasks", "Site Updates", "Procurement", "Snags", "Notifications", "Reports"]}
    >
      {children}
    </InternalShell>
  );
}
