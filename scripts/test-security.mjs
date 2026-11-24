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
    // Each statement runs in a savepoint, so an expected refusal doesn't abort the rest of the test
    return await fn(async (sql, p) => {
      await db.query("savepoint stmt");
      try {
        const r = await db.query(sql, p);
        await db.query("release savepoint stmt");
        return r.rows;
      } catch (e) {
        await db.query("rollback to savepoint stmt");
        throw e;
      }
    });
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

console.log("\nRelease 2: approval workflow");
// Switch identity inside one transaction (to play manager, then client)
const become = (q, who) => who
  ? q("select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)", [JSON.stringify({ sub: people[who] })]).then(() => q("set local role authenticated"))
  : q("select set_config('request.jwt.claims', '', true)").then(() => q("set local role service_role"));
const newApproval = async (q, project = projects.amit, deadline = "2099-01-01") => {
  const [a] = await q("select approval_create($1) as id", [{ project_id: project, title: "Test TV unit", area: "Living room", category: "Carpentry", item_name: "TV unit", deadline }]);
  await q("update approval_revisions set client_description = 'Walnut TV unit', colour = 'Walnut' where approval_id = $1", [a.id]);
  return a.id;
};
await test("Clients never see a draft approval or its files", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  const [rev] = await q("select id from approval_revisions where approval_id = $1", [id]);
  await q("insert into stored_files (project_id, entity_type, entity_id, file_name, mime_type, size_bytes, data, uploaded_by) values ($1,'approval_revision',$2,'a.jpg','image/jpeg',3,'\\x010203',auth.uid())", [projects.amit, rev.id]);
  await become(q, "amit");
  eq((await q("select * from approvals where id = $1", [id])).length, 0, "approval");
  eq((await q("select * from approval_revisions where approval_id = $1", [id])).length, 0, "revision");
  eq((await q("select * from stored_files where entity_id = $1", [rev.id])).length, 0, "file");
}));
await test("A manager cannot mark an approval approved or create revisions directly", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  await denied(q("update approvals set status = 'approved' where id = $1", [id]));
}));
await test("…nor insert a ready-approved revision", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  await denied(q("insert into approval_revisions (approval_id, project_id, revision_no, status) values ($1, $2, 9, 'approved')", [id, projects.amit]));
}));
await test("A PM cannot send approvals on another PM's project", () => as("neha", async (q) => {
  await denied(q("select approval_create($1)", [{ project_id: projects.amit, title: "x", area: "x", category: "x", item_name: "x" }]));
}));
await test("Sending needs a deadline and client-facing description", () => as("aditya", async (q) => {
  const [a] = await q("select approval_create($1) as id", [{ project_id: projects.amit, title: "No deadline", area: "Kitchen", category: "Tiles", item_name: "Dado" }]);
  await denied(q("select approval_publish($1)", [a.id]));
}));
await test("Full cycle: send → client approves → revise keeps revision 1 untouched", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  await q("select approval_publish($1)", [id]);
  const [r1] = await q("select id, status from approval_revisions where approval_id = $1", [id]);
  eq(r1.status, "published");
  await denied(q("update approval_revisions set colour = 'Oak' where id = $1", [r1.id])); // sent = locked
  await become(q, "amit");
  const notif = await q("select title from notifications where recipient_id = auth.uid() and entity_id = $1", [id]);
  eq(notif.length, 1, "client notified");
  await q("insert into approval_responses (approval_id, revision_id, project_id, action, responded_by) values ($1,$2,$3,'approve',auth.uid())", [id, r1.id, projects.amit]);
  await become(q, "aditya");
  eq((await q("select count(*)::int as n from notifications where recipient_id = auth.uid() and entity_id = $1", [id]))[0].n, 1, "manager notified");
  const [{ approval_new_revision: r2 }] = await q("select approval_new_revision($1)", [id]);
  await q("update approval_revisions set colour = 'Oak' where id = $1", [r2]);
  const revs = await q("select revision_no, status, colour from approval_revisions where approval_id = $1 order by revision_no", [id]);
  eq(revs.length, 2); eq(revs[0].status, "approved"); eq(revs[0].colour, "Walnut"); eq(revs[1].colour, "Oak");
  eq((await q("select status from approvals where id = $1", [id]))[0].status, "approved", "still approved until rev 2 is sent");
  await q("select approval_publish($1)", [id]);
  eq((await q("select status, current_revision_no from approvals where id = $1", [id]))[0].current_revision_no, 2);
  eq((await q("select status from approval_revisions where approval_id = $1 and revision_no = 1", [id]))[0].status, "approved", "rev 1 stays approved");
}));
await test("Client can only respond to the latest sent revision, and must explain changes", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  await q("select approval_publish($1)", [id]);
  const [r1] = await q("select id from approval_revisions where approval_id = $1", [id]);
  await q("select approval_new_revision($1)", [id]);
  await q("select approval_publish($1)", [id]);
  await become(q, "amit");
  await denied(q("insert into approval_responses (approval_id, revision_id, project_id, action, responded_by) values ($1,$2,$3,'approve',auth.uid())", [id, r1.id, projects.amit]));
}));
await test("Changes requested without a comment are refused", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  await q("select approval_publish($1)", [id]);
  const [r1] = await q("select id from approval_revisions where approval_id = $1", [id]);
  await become(q, "amit");
  await denied(q("insert into approval_responses (approval_id, revision_id, project_id, action, responded_by) values ($1,$2,$3,'request_changes',auth.uid())", [id, r1.id, projects.amit]));
}));
await test("Query → manager reply → back with the client", () => as("aditya", async (q) => {
  const id = await newApproval(q);
  await q("select approval_publish($1)", [id]);
  const [r1] = await q("select id from approval_revisions where approval_id = $1", [id]);
  await become(q, "amit");
  await q("insert into approval_responses (approval_id, revision_id, project_id, action, comment, responded_by) values ($1,$2,$3,'raise_query','Is this veneer?',auth.uid())", [id, r1.id, projects.amit]);
  await become(q, "aditya");
  await q("select approval_reply($1, 'Yes, natural veneer')", [id]);
  eq((await q("select status from approvals where id = $1", [id]))[0].status, "pending");
  await become(q, "amit");
  eq((await q("select body from approval_messages where approval_id = $1", [id]))[0].body, "Yes, natural veneer");
}));
await test("Employees can see approvals but not change them", () => as("pooja", async (q) => {
  eq((await q("select id from approvals where project_id = $1", [projects.amit])).length > 0, true);
  eq((await q("update approvals set deadline = '2099-01-01' where project_id = $1 returning id", [projects.amit])).length, 0);
}));

console.log("\nRelease 2: payments");
await test("Partial payment updates the outstanding balance", () => as("aditya", async (q) => {
  const [m] = await q("select id, outstanding_paise from payment_milestone_balances where project_id = $1 and name = 'Carpentry commencement'", [projects.amit]);
  await q("insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, recorded_by) values ($1,$2,5000000,today_ist(),auth.uid())", [m.id, projects.amit]);
  const [after] = await q("select outstanding_paise, effective_status from payment_milestone_balances where id = $1", [m.id]);
  eq(after.outstanding_paise, m.outstanding_paise - 5000000); eq(after.effective_status, "partially_paid");
}));
await test("Recording more than is outstanding is refused", () => as("aditya", async (q) => {
  const [m] = await q("select id, outstanding_paise from payment_milestone_balances where project_id = $1 and name = 'Carpentry commencement'", [projects.amit]);
  await denied(q("insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, recorded_by) values ($1,$2,$3,today_ist(),auth.uid())", [m.id, projects.amit, m.outstanding_paise + 100]));
}));
await test("A payment can't be booked against another project's milestone", () => as("aditya", async (q) => {
  // Aditya manages Amit's and Rohan's projects but not Kavita's
  const [m] = await q("select id from payment_milestones where project_id = $1 and name = 'Final handover'", [projects.amit]);
  await q("set local role service_role");
  const [k] = await q("select id from payment_milestones where project_id = $1 limit 1", [projects.kavita]);
  await q("set local role authenticated");
  await denied(q("insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, recorded_by) values ($1,$2,100,today_ist(),auth.uid())", [k.id, projects.amit]));
  const [t] = await q("insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, recorded_by) values ($1,$2,100,today_ist(),auth.uid()) returning project_id", [m.id, projects.rohan]);
  eq(t.project_id, projects.amit, "project taken from the milestone");
}));
await test("Due dates change only with a recorded reason", () => as("aditya", async (q) => {
  const [m] = await q("select id from payment_milestones where project_id = $1 and name = 'Final handover'", [projects.amit]);
  await denied(q("update payment_milestones set due_date = due_date + 10 where id = $1", [m.id]));
  await denied(q("select payment_change_due_date($1, current_date + 90, '')", [m.id]));
  await q("select payment_change_due_date($1, current_date + 90, 'Handover moved')", [m.id]);
  eq((await q("select reason from payment_due_date_changes where milestone_id = $1", [m.id]))[0].reason, "Handover moved");
}));
await test("Payment status can't be typed in (only On hold)", () => as("aditya", async (q) => {
  await denied(q("update payment_milestones set status = 'paid' where project_id = $1", [projects.amit]));
}));
await test("Voiding needs a reason and keeps the entry", () => as("aditya", async (q) => {
  const [t] = await q("select id from payment_transactions where project_id = $1 and voided_at is null limit 1", [projects.amit]);
  await denied(q("update payment_transactions set voided_at = now() where id = $1", [t.id]));
  await q("update payment_transactions set voided_at = now(), void_reason = 'Cheque bounced' where id = $1", [t.id]);
  const [v] = await q("select voided_by, void_reason from payment_transactions where id = $1", [t.id]);
  eq(v.voided_by, people.aditya); eq(v.void_reason, "Cheque bounced");
}));
await test("Clients don't see internal notes, voided entries or unpublished receipts", () => as("aditya", async (q) => {
  const [m] = await q("select id from payment_milestones where project_id = $1 limit 1", [projects.amit]);
  await q("insert into internal_notes (project_id, entity_type, entity_id, visibility, body, created_by) values ($1,'payment_milestone',$2,'management','Will pay late',auth.uid())", [projects.amit, m.id]);
  const [t] = await q("select id from payment_transactions where project_id = $1 and voided_at is null limit 1", [projects.amit]);
  const [f] = await q("insert into stored_files (project_id, entity_type, entity_id, file_name, mime_type, size_bytes, data, uploaded_by) values ($1,'payment_transaction',$2,'r.pdf','application/pdf',3,'\\x010203',auth.uid()) returning id", [projects.amit, t.id]);
  await q("update payment_transactions set receipt_path = $2 where id = $1", [t.id, f.id]);
  await become(q, "amit");
  eq((await q("select * from internal_notes")).length, 0, "notes");
  eq((await q("select * from stored_files where id = $1", [f.id])).length, 0, "unpublished receipt");
  await become(q, "aditya");
  await q("update payment_transactions set receipt_published = true where id = $1", [t.id]);
  await become(q, "amit");
  eq((await q("select * from stored_files where id = $1", [f.id])).length, 1, "published receipt");
  await become(q, "ganesh");
  eq((await q("select * from stored_files where id = $1", [f.id])).length, 0, "employee");
}));

console.log("\nRelease 2: reminders and notifications");
await test("Reminders follow the schedule: 7, 3, 0 days before, 1 day after, then every 3 days", () => as(null, async (q) => {
  await q("set local role service_role");
  const [m] = await q("select id, due_date from payment_milestones where project_id = $1 and name = 'Final handover'", [projects.amit]);
  const sentOn = [];
  for (let off = -8; off <= 8; off++) {
    const n = (await q("select run_reminders(($1::date + $2::int)) as n", [m.due_date, off]))[0].n;
    const mine = (await q("select count(*)::int as c from notifications where entity_id = $1", [m.id]))[0].c;
    if (n > 0 && mine > sentOn.reduce((s, x) => s + x[1], 0)) sentOn.push([off, mine - sentOn.reduce((s, x) => s + x[1], 0)]);
  }
  eq(sentOn.map((x) => x[0]).join(","), "-7,-3,0,1,4,7", "days relative to due date");
}));
await test("A reminder is never sent twice, and paused milestones are skipped", () => as(null, async (q) => {
  await q("set local role service_role");
  const [m] = await q("select id, due_date from payment_milestones where project_id = $1 and name = 'Final handover'", [projects.amit]);
  await q("select run_reminders(($1::date - 3))", [m.due_date]);
  eq((await q("select run_reminders(($1::date - 3)) as n", [m.due_date]))[0].n >= 0, true);
  eq((await q("select count(*)::int as c from notifications where entity_id = $1", [m.id]))[0].c, 1, "only one");
  await q("update payment_milestones set reminders_paused = true, reminder_pause_reason = 'test' where id = $1", [m.id]);
  await q("select run_reminders($1::date)", [m.due_date]);
  eq((await q("select count(*)::int as c from notifications where entity_id = $1", [m.id]))[0].c, 1, "paused");
}));
await test("Only owner/admin can trigger reminders", () => as("aditya", async (q) => {
  await denied(q("select run_reminders()"));
}));
await test("People only see their own notifications and can only mark them read", () => as("amit", async (q) => {
  const mine = await q("select recipient_id, title from notifications");
  eq(mine.every((n) => n.recipient_id === people.amit), true);
  await denied(q("update notifications set title = 'x' where recipient_id = auth.uid()"));
  await denied(q("insert into notifications (organisation_id, recipient_id, event_type, title) select organisation_id, id, 'x', 'x' from profiles where id = auth.uid()"));
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
