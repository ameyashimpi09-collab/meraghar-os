import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import NewProjectForm from "./NewProjectForm";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const user = await requireUser("management");
  const data = await withUser(user.id, async (db) => {
    const people = (await db.query(
      `select id, full_name, role, designation from profiles where is_active and deleted_at is null order by full_name`,
    )).rows;
    const categories = (await db.query(`select name from scope_categories where is_active order by sort_order`)).rows.map((r) => r.name as string);
    return { people, categories };
  });
  return (
    <>
      <PageHeader title="New project" subtitle="The project code is created automatically. Everything is saved together, so a half-finished project is never left behind." />
      <NewProjectForm
        me={{ id: user.id, role: user.role }}
        managers={data.people.filter((p) => ["owner", "admin", "project_manager"].includes(p.role))}
        designers={data.people.filter((p) => p.role === "designer")}
        execution={data.people.filter((p) => ["site_supervisor", "execution", "designer"].includes(p.role))}
        clients={data.people.filter((p) => p.role === "client")}
        categories={data.categories}
      />
    </>
  );
}
