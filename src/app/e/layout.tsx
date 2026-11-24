import { requireUser } from "@/lib/auth";
import { InternalShell } from "@/components/InternalShell";
import { IconDashboard, IconProjects, IconTasks, IconUser } from "@/components/icons";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("employee");
  return (
    <InternalShell
      user={user}
      nav={[
        { href: "/e", label: "My Dashboard", exact: true, icon: <IconDashboard /> },
        { href: "/e/tasks", label: "My Tasks", icon: <IconTasks /> },
        { href: "/e/projects", label: "My Projects", icon: <IconProjects /> },
        { href: "/e/profile", label: "Profile", icon: <IconUser /> },
      ]}
      upcoming={["Site Updates", "Blockers", "Notifications"]}
    >
      {children}
    </InternalShell>
  );
}
