// Permission tests: runs real queries as each demo person and checks the
// DATABASE refuses what they shouldn't do. Every test is rolled back, so
// demo data is left unchanged. Run: npm run test:security
import pg from "pg";
import fs from "node:fs";

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
pg.types.setTypeParser(20, Number);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

await db.query("set role service_role");
const people = Object.fromEntries((await db.query("select split_part(email,'@',1) as k, id from profiles")).rows.map((r) => [r.k, r.id]));
const projects = Object.fromEntries((await db.query("select lower(split_part(name,' ',1)) as k, id from projects")).rows.map((r) => [r.k, r.id]));
await db.query("reset role");

let passed = 0, failed = 0;
async function as(who, fn) {
  await db.query("begin");
  try {
    if (who) await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: people[who] })]);
    await db.query(`set local role ${who ? "authenticated" : "anon"}`);
    return await fn((sql, p) => db.query(sql, p).then((r) => r.rows));
  } finally {
    await db.query("rollback");
  }
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓", name);
  } catch (e) {
    failed++;
    console.log("  ✗", name, "\n     ", e.message);
  }
}
const eq = (a, b, msg = "") => { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); };
async function denied(p) {
  try { await p; } catch (e) { return; }
  throw new Error("expected the database to refuse, but it allowed it");
}

console.log("\nClients");
await test("Client sees only their own project", () => as("amit", async (q) => {
  const r = await q("select id from projects");
  eq(r.length, 1); eq(r[0].id, projects.amit);
}));
await test("Client cannot open another client's project by ID", () => as("amit", async (q) => {
  eq((await q("select * from projects where id = $1", [projects.kavita])).length, 0);
  eq((await q("select * from payment_milestones where project_id = $1", [projects.kavita])).length, 0);
}));
await test("Client cannot see internal tasks or estimated costs", () => as("amit", async (q) => {
  eq((await q("select * from tasks")).length, 0, "tasks");
  eq((await q("select * from project_scope_costs")).length, 0, "costs");
  eq((await q("select * from internal_notes")).length, 0, "notes");
}));
await test("Client cannot change their project or payment records", () => as("amit", async (q) => {
  eq((await q("update projects set name = 'hacked' where id = $1 returning id", [projects.amit])).length, 0);
  await denied(q("insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, recorded_by) select id, project_id, 100, current_date, $1 from payment_milestones limit 1", [people.amit]));
}));
await test("Client cannot give themselves a staff role", () => as("amit", async (q) => {
  await denied(q("update profiles set role = 'owner' where id = auth.uid()"));
}));
await test("Client cannot read the audit log", () => as("amit", async (q) => {
  eq((await q("select * from audit_logs")).length, 0);
}));
await test("Client sees payment balances for their own project only", () => as("amit", async (q) => {
  const r = await q("select name, outstanding_paise from payment_milestone_balances where name = 'Design finalisation'");
  eq(r.length, 1); eq(r[0].outstanding_paise, 5000000, "₹50,000 outstanding in paise");
}));

console.log("\nEmployees");
await test("Execution staff see only assigned projects", () => as("ganesh", async (q) => {
  const ids = (await q("select id from projects")).map((r) => r.id).sort();
  eq(ids.length, 2); eq(ids.includes(projects.rohan), false);
}));
await test("Employees get no client financial data", () => as("ganesh", async (q) => {
  eq((await q("select * from payment_milestones")).length, 0, "milestones");
  eq((await q("select * from payment_transactions")).length, 0, "transactions");
  eq((await q("select * from project_scope_costs")).length, 0, "costs");
}));
await test("Employees cannot create projects", () => as("ganesh", async (q) => {
  await denied(q("select create_project('{\"name\":\"x\"}'::jsonb)"));
}));
await test("Employee can update own task progress but not its deadline", () => as("ganesh", async (q) => {
  const [t] = await q("select id from tasks where assigned_to = auth.uid() and status = 'not_started' limit 1");
  eq((await q("update tasks set status = 'in_progress' where id = $1 returning id", [t.id])).length, 1);
  await denied(q("update tasks set due_date = due_date + 10 where id = $1", [t.id]));
}));
await test("Employees cannot see other employees' private details", () => as("ganesh", async (q) => {
  // Ganesh is not on Rohan's villa; he shouldn't see Rohan's contact details
  eq((await q("select * from profiles where id = $1", [people.rohan])).length, 0);
}));

console.log("\nProject managers");
await test("PM sees only projects they manage", () => as("neha", async (q) => {
  const r = await q("select id from projects");
  eq(r.length, 1); eq(r[0].id, projects.kavita);
}));
await test("PM cannot edit another PM's project", () => as("neha", async (q) => {
  eq((await q("update projects set name = 'x' where id = $1 returning id", [projects.amit])).length, 0);
}));
await test("PM can create a project and becomes its manager", () => as("neha", async (q) => {
  const [{ id }] = await q("select create_project('{\"name\":\"Test flat\"}'::jsonb) as id");
  eq((await q("select * from projects where id = $1", [id])).length, 1);
}));
await test("Only owner/admin can delete a project", () => as("neha", async (q) => {
  await denied(q("update projects set deleted_at = now() where id = $1", [projects.kavita]));
}));

console.log("\nApprovals & payments integrity");
await test("Client approval is recorded and the approved revision becomes immutable", () => as("amit", async (q) => {
  const [rev] = await q(`select r.id, r.approval_id, r.project_id from approval_revisions r join approvals a on a.id = r.approval_id
                          where a.title = 'Kitchen shutter laminate'`);
  await q("insert into approval_responses (approval_id, revision_id, project_id, action, responded_by) values ($1,$2,$3,'approve',auth.uid())", [rev.approval_id, rev.id, rev.project_id]);
  eq((await q("select status from approvals where id = $1", [rev.approval_id]))[0].status, "approved");
  await q("set local role service_role"); // even full database access cannot alter it
  await denied(q("update approval_revisions set colour = 'Red' where id = $1", [rev.id]));
}));
await test("A client cannot approve on staff's behalf by editing the status", () => as("aditya", async (q) => {
  await denied(q("update approval_revisions set status = 'approved' where status = 'published'"));
}));
await test("Recorded payments can't be deleted or edited, only voided", () => as("aditya", async (q) => {
  const [t] = await q("select id from payment_transactions limit 1");
  eq((await q("delete from payment_transactions where id = $1 returning id", [t.id])).length, 0, "rows deleted");
  await denied(q("update payment_transactions set amount_paise = 1 where id = $1", [t.id]));
}));

console.log("\nGeneral");
await test("Signed-out visitors can read nothing", () => as(null, async (q) => {
  await denied(q("select * from projects"));
}));
await test("Owner sees every project in the organisation", () => as("rahul", async (q) => {
  eq((await q("select id from projects")).length, 3);
}));
await test("Important actions are in the audit trail with who did them", () => as("rahul", async (q) => {
  const r = await q("select count(*)::int as n from audit_logs where entity_type = 'projects' and action = 'insert' and actor_id = auth.uid()");
  eq(r[0].n, 3);
}));

console.log(`\n${passed} passed, ${failed} failed\n`);
await db.end();
process.exit(failed ? 1 : 0);
