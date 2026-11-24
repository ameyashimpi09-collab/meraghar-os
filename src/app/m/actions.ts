"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { requireUser, hashPassword } from "@/lib/auth";
import { asService, friendlyDbError, withUser, type Db } from "@/lib/db";
import { creatableRoles, isOrgAdmin, type AppRole } from "@/lib/roles";

export type ActionState = { error?: string; ok?: string; tempPassword?: string; email?: string; projectId?: string } | undefined;

const opt = (max = 200) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const phone = z.string().trim().max(20).regex(/^[+\d][\d\s-]{6,19}$/, "Enter a valid phone number").optional().or(z.literal("")).transform((v) => v || undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || undefined);
const uuid = z.string().uuid().optional().or(z.literal("")).transform((v) => v || undefined);

function tempPassword() {
  const words = ["Teak", "Oak", "Marble", "Linen", "Brass", "Cedar", "Slate", "Walnut", "Quartz", "Jute"];
  return `${words[randomInt(words.length)]}-${randomInt(1000, 9999)}-${words[randomInt(words.length)]}`;
}

/** Creates a login + profile. Caller must already be permission-checked. */
async function createAccount(db: Db, actor: { id: string; organisationId: string }, p: {
  role: AppRole; full_name: string; email: string; phone?: string; designation?: string;
  secondary_contact_name?: string; secondary_contact_phone?: string; preferred_contact_method?: string;
}) {
  const password = tempPassword();
  const hash = await hashPassword(password);
  const id = await asService(db, async () => {
    const exists = await db.query("select app_auth_email_exists($1) as e", [p.email]);
    if (exists.rows[0].e) throw Object.assign(new Error("dup"), { code: "23505", constraint: "email" });
    const u = await db.query("select app_auth_create_user($1, $2) as id", [p.email, hash]);
    await db.query(
      `insert into profiles (id, organisation_id, role, full_name, email, phone, designation,
                             secondary_contact_name, secondary_contact_phone, preferred_contact_method, created_by)
       values ($1,$2,$3,$4,lower($5),$6,$7,$8,$9,coalesce($10,'phone')::contact_method,$11)`,
      [u.rows[0].id, actor.organisationId, p.role, p.full_name, p.email, p.phone ?? null, p.designation ?? null,
       p.secondary_contact_name ?? null, p.secondary_contact_phone ?? null, p.preferred_contact_method ?? null, actor.id],
    );
    return u.rows[0].id as string;
  });
  return { id, password };
}

// ---------------------------------------------------------------- projects
const ProjectSchema = z.object({
  name: z.string().trim().min(3, "Project name is required").max(150),
  client_mode: z.enum(["existing", "new", "later"]),
  client_id: uuid,
  client_name: opt(120), client_email: z.string().trim().email("Enter a valid client email").optional().or(z.literal("")).transform((v) => v || undefined),
  client_phone: phone, secondary_contact_name: opt(120), secondary_contact_phone: phone,
  preferred_contact_method: z.enum(["phone", "whatsapp", "email", "in_app"]).default("whatsapp"),
  address_line: opt(300), building_society: opt(150), flat_number: opt(30), city: opt(60), pincode: opt(10),
  property_config: opt(40), carpet_area_sqft: z.coerce.number().positive().max(100000).optional().or(z.literal("")).transform((v) => v || undefined),
  possession_status: z.enum(["awaiting_possession", "possession_received", "occupied", "under_renovation"]).optional().or(z.literal("")).transform((v) => v || undefined),
  expected_start_date: date, target_handover_date: date,
  project_manager_id: uuid, designer_id: uuid,
  description: opt(2000),
});

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireUser("management");
  const parsed = ProjectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.expected_start_date && v.target_handover_date && v.target_handover_date < v.expected_start_date)
    return { error: "Target handover date must be after the start date." };
  if (v.client_mode === "existing" && !v.client_id) return { error: "Choose the client." };
  if (v.client_mode === "new" && (!v.client_name || !v.client_email)) return { error: "Client name and email are needed to create their login." };

  const execution_ids = form.getAll("execution_ids").map(String).filter((x) => z.string().uuid().safeParse(x).success);
  const scope = form.getAll("scope_category").map(String).map((category, i) => ({
    category: category.slice(0, 80),
    is_included: form.get(`scope_included_${i}`) === "on",
    description: String(form.get(`scope_description_${i}`) ?? "").slice(0, 1000),
    estimated_cost_paise: Math.max(0, Math.round(Number(String(form.get(`scope_cost_${i}`) ?? "0").replace(/[,₹\s]/g, "")) * 100) || 0),
  })).filter((s) => s.is_included || s.description);

  let projectId: string, temp: { password: string; email: string } | undefined;
  try {
    // One transaction: client login + project + team + scope. All or nothing.
    ({ projectId, temp } = await withUser(me.id, async (db) => {
      let clientId = v.client_mode === "existing" ? v.client_id : undefined;
      let temp: { password: string; email: string } | undefined;
      if (v.client_mode === "new") {
        if (!creatableRoles(me.role).includes("client")) throw Object.assign(new Error("You cannot create client accounts"), { code: "42501" });
        const acc = await createAccount(db, me, {
          role: "client", full_name: v.client_name!, email: v.client_email!, phone: v.client_phone,
          secondary_contact_name: v.secondary_contact_name, secondary_contact_phone: v.secondary_contact_phone,
          preferred_contact_method: v.preferred_contact_method,
        });
        clientId = acc.id;
        temp = { password: acc.password, email: v.client_email! };
      }
      const r = await db.query("select create_project($1) as id", [{ ...v, client_id: clientId, execution_ids, scope }]);
      return { projectId: r.rows[0].id as string, temp };
    }));
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  revalidatePath("/m", "layout");
  // A temporary client password is shown once on screen (never put in a URL or stored in plain text).
  if (!temp) redirect(`/m/projects/${projectId}`);
  return { ok: "Project created.", projectId, tempPassword: temp.password, email: temp.email };
}

const UpdateSchema = ProjectSchema.pick({
  name: true, address_line: true, building_society: true, flat_number: true, city: true, pincode: true,
  property_config: true, carpet_area_sqft: true, possession_status: true, expected_start_date: true,
  target_handover_date: true, description: true,
}).extend({
  id: z.string().uuid(),
  status: z.enum(["draft", "active", "on_hold", "completed", "cancelled"]),
  actual_handover_date: date,
});

export async function updateProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireUser("management");
  const parsed = UpdateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  try {
    const n = await withUser(me.id, async (db) => (await db.query(
      `update projects set name=$2, status=$3, address_line=$4, building_society=$5, flat_number=$6, city=coalesce($7,'Pune'),
              pincode=$8, property_config=$9, carpet_area_sqft=$10, possession_status=$11, expected_start_date=$12,
              target_handover_date=$13, actual_handover_date=$14, description=$15
        where id=$1 returning id`,
      [v.id, v.name, v.status, v.address_line ?? null, v.building_society ?? null, v.flat_number ?? null, v.city ?? null,
       v.pincode ?? null, v.property_config ?? null, v.carpet_area_sqft ?? null, v.possession_status ?? null,
       v.expected_start_date ?? null, v.target_handover_date ?? null, v.actual_handover_date ?? null, v.description ?? null],
    )).rowCount);
    if (!n) return { error: "You don't have permission to edit this project." };
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  revalidatePath(`/m/projects/${v.id}`);
  return { ok: "Project details saved." };
}

export async function addMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireUser("management");
  const v = z.object({
    project_id: z.string().uuid(), profile_id: z.string().uuid("Choose a person"),
    member_role: z.enum(["project_manager", "designer", "site_supervisor", "execution", "client"]),
  }).safeParse(Object.fromEntries(form));
  if (!v.success) return { error: v.error.issues[0].message };
  try {
    await withUser(me.id, async (db) => {
      await db.query(
        `insert into project_members (project_id, profile_id, member_role, added_by) values ($1,$2,$3,auth.uid())`,
        [v.data.project_id, v.data.profile_id, v.data.member_role],
      );
      if (v.data.member_role === "client")
        await db.query("update projects set client_id = coalesce(client_id, $2) where id = $1", [v.data.project_id, v.data.profile_id]);
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  revalidatePath(`/m/projects/${v.data.project_id}`);
  return { ok: "Added to the project." };
}

export async function removeMemberAction(form: FormData) {
  const me = await requireUser("management");
  const id = z.string().uuid().parse(form.get("member_id"));
  const pid = z.string().uuid().parse(form.get("project_id"));
  await withUser(me.id, (db) => db.query("update project_members set removed_at = now() where id = $1 and project_id = $2", [id, pid]));
  revalidatePath(`/m/projects/${pid}`);
}

// ---------------------------------------------------------------- people
export async function createPersonAction(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireUser("management");
  const v = z.object({
    role: z.enum(["admin", "project_manager", "designer", "site_supervisor", "execution", "client"]),
    full_name: z.string().trim().min(2, "Enter the full name").max(120),
    email: z.string().trim().email("Enter a valid email"),
    phone, designation: opt(80),
  }).safeParse(Object.fromEntries(form));
  if (!v.success) return { error: v.error.issues[0].message };
  if (!creatableRoles(me.role).includes(v.data.role)) return { error: "You don't have permission to create this type of account." };
  try {
    const acc = await withUser(me.id, (db) => createAccount(db, me, { ...v.data, preferred_contact_method: v.data.role === "client" ? "whatsapp" : "phone" }));
    revalidatePath("/m/team");
    return { ok: `${v.data.full_name}'s account is ready.`, tempPassword: acc.password, email: v.data.email.toLowerCase() };
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
}

export async function setActiveAction(form: FormData) {
  const me = await requireUser("management");
  if (!isOrgAdmin(me.role)) return;
  const id = z.string().uuid().parse(form.get("profile_id"));
  const active = form.get("active") === "true";
  await withUser(me.id, (db) => db.query("update profiles set is_active = $2 where id = $1", [id, active]));
  revalidatePath("/m/team");
}

export async function resetPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireUser("management");
  const id = z.string().uuid().safeParse(form.get("profile_id"));
  if (!id.success) return { error: "Invalid person." };
  try {
    return await withUser(me.id, async (db) => {
      // Must be visible to me (RLS) and something I'm allowed to create
      const r = await db.query("select role, email from profiles where id = $1", [id.data]);
      const target = r.rows[0];
      if (!target || !creatableRoles(me.role).includes(target.role)) return { error: "You can't reset this person's password." };
      const pw = tempPassword();
      const hash = await hashPassword(pw);
      await asService(db, () => db.query("select app_auth_set_password($1, $2)", [id.data, hash]));
      return { ok: "New temporary password created.", tempPassword: pw, email: target.email };
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
}
