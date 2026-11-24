export type AppRole =
  | "owner"
  | "admin"
  | "project_manager"
  | "designer"
  | "site_supervisor"
  | "execution"
  | "client";

export const ROLE_LABEL: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  project_manager: "Project Manager",
  designer: "Designer",
  site_supervisor: "Site Supervisor",
  execution: "Execution Team",
  client: "Client",
};

export const MEMBER_ROLE_LABEL: Record<string, string> = {
  project_manager: "Project Manager",
  designer: "Designer",
  site_supervisor: "Site Supervisor",
  execution: "Execution",
  client: "Client",
};

export const STAFF_ROLES: AppRole[] = ["owner", "admin", "project_manager", "designer", "site_supervisor", "execution"];

export const isManagement = (r: AppRole) => r === "owner" || r === "admin" || r === "project_manager";
export const isOrgAdmin = (r: AppRole) => r === "owner" || r === "admin";
export const isStaff = (r: AppRole) => r !== "client";

export function homeFor(role: AppRole) {
  if (role === "client") return "/c";
  if (isManagement(role)) return "/m";
  return "/e";
}

/** Which account types each role may create. */
export function creatableRoles(role: AppRole): AppRole[] {
  if (role === "owner") return ["admin", "project_manager", "designer", "site_supervisor", "execution", "client"];
  if (role === "admin") return ["project_manager", "designer", "site_supervisor", "execution", "client"];
  if (role === "project_manager") return ["client"];
  return [];
}
