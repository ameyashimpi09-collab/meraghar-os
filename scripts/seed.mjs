// Demo data for previewing Meraghar OS locally.
// Creates the organisation, default lists, demo staff + clients and three
// sample projects. Every record goes through the same database rules as
// the real app. All demo passwords: Demo@1234
import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "node:fs";

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00Z");
const d = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
const PASSWORD = await bcrypt.hash("Demo@1234", 10);

async function as(uid, role, fn) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
    await db.query(`set local role ${role}`);
    const r = await fn();
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;

// ---------- Organisation + defaults (system context) ----------
const orgId = await as(null, "service_role", async () => {
  const [org] = await q(
    `insert into organisations (name, legal_name, slug, project_code_prefix)
     values ('Meraghar Interiors', 'Meraki Interior E-Solutions LLP', 'meraghar', 'MG') returning id`,
  );
  const scope = ["Civil work", "Electrical work", "Plumbing", "False ceiling", "Carpentry", "Kitchen", "Wardrobes", "Painting", "Wall treatments", "Furniture", "Lighting", "Curtains and soft furnishings", "Client-supplied items", "Other custom work"];
  for (const [i, n] of scope.entries())
    await q("insert into scope_categories (organisation_id, name, sort_order) values ($1,$2,$3)", [org.id, n, i + 1]);
  const stages = [["Project onboarding", 3], ["Site measurement", 3], ["Design development", 14], ["Design finalisation", 7], ["Material finalisation", 7], ["Civil work", 10], ["Electrical and plumbing", 10], ["False ceiling", 7], ["Painting and wall finishes", 10], ["Carpentry", 21], ["Kitchen installation", 5], ["Wardrobe installation", 5], ["Furniture and lighting", 5], ["Client-supplied item installation", 3], ["Final finishing", 5], ["Snag rectification", 5], ["Handover", 1]];
  for (const [i, [n, days]] of stages.entries())
    await q("insert into stage_templates (organisation_id, name, sort_order, default_duration_days) values ($1,$2,$3,$4)", [org.id, n, i + 1, days]);
  return org.id;
});

// ---------- People ----------
const people = [
  ["owner", "Rahul", "rahul@meraghar.demo", "Founder & Director", "+91 98220 00001"],
  ["admin", "Sneha Kulkarni", "sneha@meraghar.demo", "Operations Admin", "+91 98220 00002"],
  ["project_manager", "Aditya Deshpande", "aditya@meraghar.demo", "Senior Project Manager", "+91 98220 00003"],
  ["project_manager", "Neha Joshi", "neha@meraghar.demo", "Project Manager", "+91 98220 00004"],
  ["designer", "Pooja Patil", "pooja@meraghar.demo", "Interior Designer", "+91 98220 00005"],
  ["site_supervisor", "Sanjay Pawar", "sanjay@meraghar.demo", "Site Supervisor", "+91 98220 00006"],
  ["execution", "Ganesh More", "ganesh@meraghar.demo", "Carpentry Lead", "+91 98220 00007"],
  ["client", "Amit Jain", "amit@client.demo", null, "+91 99230 11111"],
  ["client", "Kavita Mehta", "kavita@client.demo", null, "+91 99230 22222"],
  ["client", "Rohan Shah", "rohan@client.demo", null, "+91 99230 33333"],
];
const id = {};
await as(null, "service_role", async () => {
  for (const [role, name, email, designation, phone] of people) {
    const [u] = await q("select app_auth_create_user($1,$2) as id", [email, PASSWORD]);
    await q(
      `insert into profiles (id, organisation_id, role, full_name, email, phone, designation, preferred_contact_method)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u.id, orgId, role, name, email, phone, designation, role === "client" ? "whatsapp" : "phone"],
    );
    id[name.split(" ")[0].toLowerCase()] = u.id;
  }
});

// ---------- Projects (created by the owner through the real create_project) ----------
async function createProject(payload) {
  return as(id.rahul, "authenticated", async () => (await q("select create_project($1) as id", [payload]))[0].id);
}
const scope = (items) => items.map(([category, description, lakhs]) => ({ category, description, is_included: true, estimated_cost_paise: Math.round(lakhs * 100000 * 100) }));

const amit = await createProject({
  name: "Amit Jain – 2BHK, Baner", client_id: id.amit, project_manager_id: id.aditya, designer_id: id.pooja,
  execution_ids: [id.sanjay, id.ganesh], address_line: "Survey No. 42, Baner Road", building_society: "Kolte Patil Western Avenue",
  flat_number: "B-1104", city: "Pune", pincode: "411045", property_config: "2 BHK", carpet_area_sqft: 865,
  possession_status: "possession_received", expected_start_date: d(-40), target_handover_date: d(55),
  scope: scope([["Kitchen", "L-shaped modular kitchen with tall unit", 3.2], ["Wardrobes", "Master and kids bedroom sliding wardrobes", 2.6], ["False ceiling", "Living + master bedroom gypsum ceiling with cove", 1.1], ["Electrical work", "Rewiring for ceiling lights, TV unit points", 0.8], ["Painting", "Full flat, Asian Paints Royale", 0.9], ["Furniture", "TV unit, crockery unit, study desk", 1.8]]),
});
const kavita = await createProject({
  name: "Kavita Mehta – 3BHK, Kothrud", client_id: id.kavita, project_manager_id: id.neha, designer_id: id.pooja,
  execution_ids: [id.ganesh], address_line: "Paud Road, Kothrud", building_society: "Paranjape Blue Ridge",
  flat_number: "A-702", city: "Pune", pincode: "411038", property_config: "3 BHK", carpet_area_sqft: 1240,
  possession_status: "occupied", expected_start_date: d(-75), target_handover_date: d(-3),
  scope: scope([["Civil work", "Kitchen and bathroom wall changes", 1.4], ["Kitchen", "Parallel kitchen, quartz counter", 4.1], ["Wardrobes", "3 bedrooms, hinged shutters", 3.8], ["Wall treatments", "Living room fluted panel + wallpaper", 0.9], ["Lighting", "Profile lights and pendants", 0.7]]),
});
const rohan = await createProject({
  name: "Rohan Shah – Villa, Wagholi", client_id: id.rohan, project_manager_id: id.aditya, designer_id: id.pooja,
  execution_ids: [id.sanjay], address_line: "Kesnand Road, Wagholi", building_society: "Godrej Nature Plus",
  flat_number: "Villa 18", city: "Pune", pincode: "412207", property_config: "Villa", carpet_area_sqft: 2850,
  possession_status: "awaiting_possession", expected_start_date: d(12), target_handover_date: d(150),
  scope: scope([["Carpentry", "Full villa carpentry package", 9.5], ["False ceiling", "All rooms", 2.4], ["Furniture", "Loose furniture sourcing", 6]]),
});

// ---------- Execution data so dashboards show real records ----------
await as(id.rahul, "authenticated", async () => {
  // Stages for Amit's project
  const st = async (pid, name, order, start, end, status, pct, extra = {}) =>
    (await q(
      `insert into project_stages (project_id, name, sort_order, start_date, planned_end_date, actual_end_date, status, completion_pct, client_description, is_milestone, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [pid, name, order, start, end, status === "completed" ? end : null, status, pct, extra.desc ?? null, extra.milestone ?? false, id.rahul],
    ))[0].id;
  await st(amit, "Project onboarding", 1, d(-40), d(-38), "completed", 100);
  await st(amit, "Site measurement", 2, d(-37), d(-35), "completed", 100);
  await st(amit, "Design development", 3, d(-34), d(-18), "completed", 100, { milestone: true });
  await st(amit, "Design finalisation", 4, d(-17), d(-8), "completed", 100);
  await st(amit, "Electrical and plumbing", 5, d(-7), d(4), "in_progress", 60, { desc: "Concealed wiring for living room and bedrooms is underway." });
  const amitCarp = await st(amit, "Carpentry", 6, d(5), d(30), "not_started", 0, { desc: "Factory production of kitchen and wardrobe shutters." });
  await st(amit, "Kitchen installation", 7, d(31), d(36), "not_started", 0);
  await st(amit, "Handover", 8, d(55), d(55), "not_started", 0, { milestone: true });

  await st(kavita, "Design finalisation", 1, d(-70), d(-55), "completed", 100);
  await st(kavita, "Civil work", 2, d(-54), d(-40), "completed", 100);
  await st(kavita, "Carpentry", 3, d(-39), d(-10), "delayed", 75, { desc: "Wardrobe shutters awaiting final laminate delivery." });
  await st(kavita, "Final finishing", 4, d(-9), d(-4), "not_started", 0);
  await st(kavita, "Handover", 5, d(-3), d(-3), "not_started", 0, { milestone: true });

  await st(rohan, "Project onboarding", 1, d(12), d(15), "not_started", 0);

  // Tasks
  const task = (pid, title, who, due, priority, status, extra = {}) =>
    q(
      `insert into tasks (project_id, stage_id, title, description, assigned_to, created_by, start_date, due_date, priority, status, blocked_reason, delay_type)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pid, extra.stage ?? null, title, extra.desc ?? null, who, id.rahul, extra.start ?? null, due, priority, status, extra.blocked ?? null, extra.delay ?? null],
    );
  await task(amit, "Confirm electrical point positions with client", id.sanjay, d(0), "high", "in_progress");
  await task(amit, "Send kitchen shutter cutting list to factory", id.ganesh, d(3), "high", "not_started", { stage: amitCarp });
  await task(amit, "Finalise wardrobe internal layout drawing", id.pooja, d(-2), "critical", "in_progress");
  await task(amit, "Upload site measurement photos", id.sanjay, d(-5), "medium", "completed");
  await task(kavita, "Fix wardrobe shutters – master bedroom", id.ganesh, d(-6), "critical", "blocked", { blocked: "Laminate batch delayed by vendor", delay: "vendor" });
  await task(kavita, "Install profile lights in living room", id.ganesh, d(1), "medium", "not_started");
  await task(kavita, "Share revised handover date with client", id.neha, d(-1), "high", "not_started");
  await task(rohan, "Schedule site measurement visit", id.sanjay, d(14), "medium", "not_started");
  await task(rohan, "Prepare mood board options", id.pooja, d(6), "medium", "not_started");

  // Approvals go through the same workflow functions as the app
  const approval = async (pid, title, area, category, item, deadline, rev) => {
    const [a] = await q("select approval_create($1) as id", [{ project_id: pid, title, area, category, item_name: item, deadline }]);
    await q(
      `update approval_revisions set client_description = $2, material_brand = $3, material_type = $4, specifications = $5,
              colour = $6, finish = $7, dimensions = $8, quantity = $9, quantity_unit = $10, commercial_impact_paise = $11
        where approval_id = $1 and status = 'draft'`,
      [a.id, rev.desc, rev.brand ?? null, rev.type ?? null, rev.specs ?? null, rev.colour ?? null, rev.finish ?? null,
       rev.dims ?? null, rev.qty ?? null, rev.unit ?? null, rev.impact ?? null],
    );
    if (rev.publish !== false) await q("select approval_publish($1)", [a.id]);
    return a.id;
  };
  await approval(amit, "Kitchen shutter laminate", "Kitchen", "Laminate", "Shutter laminate", d(2), {
    desc: "Laminate for all kitchen shutters (base and wall units). Matte finish hides fingerprints and suits the white quartz counter.",
    brand: "Merino", type: "HPL laminate, 1 mm", specs: "Anti-fingerprint, scratch resistant", colour: "Frosty White (MR 21043)", finish: "Super matte",
    dims: "Shutter sizes as per kitchen drawing K-02", qty: 18, unit: "sheets" });
  await approval(amit, "Master bedroom wardrobe handles", "Master bedroom", "Hardware", "Wardrobe handles", d(6), {
    desc: "Profile handles for the 4-door wardrobe.", brand: "Hettich", type: "Aluminium profile handle", colour: "Brushed gold", finish: "Brushed", dims: "160 mm", qty: 4, unit: "nos" });
  await approval(amit, "Living room TV unit design", "Living room", "Carpentry", "TV unit", d(10), {
    desc: "Wall-mounted TV unit with fluted panel and floating drawers.", publish: false });
  await approval(kavita, "Living room wallpaper", "Living room", "Wall finish", "Wallpaper", d(1), {
    desc: "Textured beige wallpaper for the accent wall behind the sofa.", brand: "Marshalls", colour: "Sand beige", finish: "Textured", dims: "Wall 3.6 m x 2.9 m", qty: 3, unit: "rolls", impact: 1250000 });
  await approval(kavita, "Pendant light selection", "Dining", "Lighting", "Pendant lights", d(4), {
    desc: "Set of three matte black dome pendants above the dining table.", brand: "Philips", colour: "Matte black", qty: 3, unit: "nos" });
  // Make two of Kavita's approvals overdue (as if sent earlier)
  await q("update approvals set deadline = $2 where project_id = $1 and title in ('Living room wallpaper', 'Pendant light selection')", [kavita, d(-4)]);

  // Payment schedule (Release 2 module)
  const pay = async (pid, name, lakhs, due, order, receivedLakhs) => {
    const [m] = await q(
      `insert into payment_milestones (project_id, name, amount_paise, due_date, sort_order, created_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [pid, name, Math.round(lakhs * 1e7), due, order, id.rahul],
    );
    if (receivedLakhs)
      await q(
        `insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, method, reference, recorded_by)
         values ($1,$2,$3,$4,'Bank transfer','NEFT demo',$5)`,
        [m.id, pid, Math.round(receivedLakhs * 1e7), due, id.rahul],
      );
  };
  await pay(amit, "Booking", 1, d(-40), 1, 1);
  await pay(amit, "Design finalisation", 1.5, d(-8), 2, 1);
  await pay(amit, "Carpentry commencement", 2, d(5), 3, 0);
  await pay(amit, "Final handover", 1, d(55), 4, 0);
  await pay(kavita, "Booking", 2, d(-75), 1, 2);
  await pay(kavita, "Carpentry commencement", 4, d(-39), 2, 4);
  await pay(kavita, "Installation", 3, d(-10), 3, 1.5);
  await pay(rohan, "Booking", 3, d(-2), 1, 0);
});

// Client purchases
await as(id.rahul, "authenticated", async () => {
  await q(
    `insert into purchase_requirements (project_id, item_name, category, area, width, height, depth, unit, required_purchase_date, required_delivery_date, status, created_by, description)
     values ($1,'Refrigerator','Appliance','Kitchen',700,1800,720,'mm',$2,$3,'client_informed',$4,'Double door, frost-free. Must fit the tall-unit cut-out.'),
            ($1,'Built-in hob','Appliance','Kitchen',860,null,510,'mm',$5,$6,'purchase_required',$4,'3 burner glass hob, cut-out 830 x 480 mm.')`,
    [amit, d(20), d(30), id.rahul, d(8), d(12)],
  );
});

// One snag on Kavita's project, raised by the client
await as(id.kavita, "authenticated", async () => {
  await q(
    `insert into snags (project_id, area, category, description, urgency, raised_by)
     values ($1,'Kitchen','carpentry','Drawer below the hob does not close fully.','high',$2)`,
    [kavita, id.kavita],
  );
});

console.log(`Seeded: organisation, ${people.length} people, 3 projects. Password for all demo accounts: Demo@1234`);
await db.end();
