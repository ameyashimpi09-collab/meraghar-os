// Demo data for previewing Meraghar OS locally.
// Creates the organisation, default lists, demo staff + clients and three
// sample projects. Every record goes through the same database rules as
// the real app. All demo passwords: Demo@1234
import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";

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
  await q("select seed_default_task_templates($1)", [org.id]);
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
let amitStages = {};
const amitTasks = {};
await as(id.rahul, "authenticated", async () => {
  // Stages for Amit's project
  const st = async (pid, name, order, start, end, status, pct, extra = {}) =>
    (await q(
      `insert into project_stages (project_id, name, sort_order, start_date, planned_end_date, actual_end_date, status, completion_pct, client_description, is_milestone, created_by, delay_type, delay_reason, assigned_team, template_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(select id from stage_templates where name = $2 limit 1)) returning id`,
      [pid, name, order, start, end, status === "completed" ? end : null, status, pct, extra.desc ?? null, extra.milestone ?? false, id.rahul, extra.delay ?? null, extra.delayReason ?? null, extra.team ?? null],
    ))[0].id;
  const chain = async (ids) => {
    for (let i = 1; i < ids.length; i++) await q("insert into stage_dependencies (stage_id, depends_on_stage_id) values ($1,$2)", [ids[i], ids[i - 1]]);
  };
  const a1 = await st(amit, "Project onboarding", 1, d(-40), d(-38), "completed", 100, { team: "Aditya" });
  const a2 = await st(amit, "Site measurement", 2, d(-37), d(-35), "completed", 100, { team: "Sanjay" });
  const a3 = await st(amit, "Design development", 3, d(-34), d(-18), "completed", 100, { team: "Pooja" });
  const a4 = await st(amit, "Design finalisation", 4, d(-17), d(-8), "completed", 100, { milestone: true, team: "Pooja" });
  const amitElec = await st(amit, "Electrical and plumbing", 5, d(-7), d(4), "in_progress", 60, { desc: "Concealed wiring for living room and bedrooms is underway.", team: "Sanjay + electrician" });
  const amitCarp = await st(amit, "Carpentry", 6, d(5), d(30), "not_started", 0, { desc: "Factory production of kitchen and wardrobe shutters.", team: "Ganesh + factory" });
  const a7 = await st(amit, "Kitchen installation", 7, d(31), d(36), "not_started", 0, { team: "Ganesh" });
  const a8 = await st(amit, "Handover", 8, d(55), d(55), "not_started", 0, { milestone: true });
  await chain([a1, a2, a3, a4, amitElec, amitCarp, a7, a8]);
  amitStages = { elec: amitElec, carp: amitCarp, kitchen: a7 };

  const k1 = await st(kavita, "Design finalisation", 1, d(-70), d(-55), "completed", 100, { milestone: true });
  const k2 = await st(kavita, "Civil work", 2, d(-54), d(-40), "completed", 100);
  const kavitaCarp = await st(kavita, "Carpentry", 3, d(-39), d(-10), "delayed", 75, { desc: "Wardrobe shutters awaiting final laminate delivery.", delay: "vendor", delayReason: "Laminate batch from vendor delayed by 2 weeks" });
  const k4 = await st(kavita, "Final finishing", 4, d(-9), d(-4), "not_started", 0);
  const k5 = await st(kavita, "Handover", 5, d(-3), d(-3), "not_started", 0, { milestone: true });
  await chain([k1, k2, kavitaCarp, k4, k5]);

  await st(rohan, "Project onboarding", 1, d(12), d(15), "not_started", 0);

  // Tasks
  const task = async (pid, title, who, due, priority, status, extra = {}) =>
    (await q(
      `insert into tasks (project_id, stage_id, title, description, assigned_to, created_by, start_date, due_date, priority, status, blocked_reason, delay_type, requires_review)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [pid, extra.stage ?? null, title, extra.desc ?? null, who, id.rahul, extra.start ?? null, due, priority, status, extra.blocked ?? null, extra.delay ?? null, extra.review ?? false],
    ))[0].id;
  await task(amit, "Confirm electrical point positions with client", id.sanjay, d(0), "high", "in_progress", { stage: amitElec, start: d(-2) });
  amitTasks.cutting = await task(amit, "Send kitchen shutter cutting list to factory", id.ganesh, d(7), "high", "not_started", { stage: amitCarp, start: d(5), desc: "Use drawing K-02. Shutter laminate must be the client-approved one." });
  amitTasks.wardrobe = await task(amit, "Finalise wardrobe internal layout drawing", id.pooja, d(-2), "critical", "in_progress", { start: d(-6) });
  await task(amit, "Upload site measurement photos", id.sanjay, d(-5), "medium", "completed");
  amitTasks.conduit = await task(amit, "Check concealed conduit before plastering", id.sanjay, d(-1), "high", "completed", { stage: amitElec, review: true, start: d(-4) });
  amitTasks.factory = await task(amit, "Follow up factory production", id.aditya, d(20), "medium", "not_started", { stage: amitCarp, start: d(8) });
  amitTasks.install = await task(amit, "Install kitchen units and countertop", id.ganesh, d(35), "high", "not_started", { stage: a7, start: d(31), review: true });
  await task(kavita, "Fix wardrobe shutters – master bedroom", id.ganesh, d(-6), "critical", "blocked", { blocked: "Laminate batch delayed by vendor", delay: "vendor", stage: kavitaCarp });
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
  // Tasks that wait for other work or for the client's decision
  const [lam] = await q("select id from approvals where project_id = $1 and title = 'Kitchen shutter laminate'", [amit]);
  await q("insert into task_dependencies (task_id, depends_on_approval_id) values ($1,$2)", [amitTasks.cutting, lam.id]);
  await q("insert into task_dependencies (task_id, depends_on_task_id) values ($1,$2)", [amitTasks.factory, amitTasks.cutting]);
  await q("insert into task_dependencies (task_id, depends_on_task_id) values ($1,$2)", [amitTasks.install, amitTasks.factory]);

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

// Work notes and a site-level blocker raised by the supervisor
await as(id.sanjay, "authenticated", async () => {
  await q("insert into task_comments (task_id, author_id, body) values ($1,$2,$3)", [amitTasks.conduit, id.sanjay, "All conduits checked room by room. Photos of each wall attached before plastering."]);
  await q("select blocker_raise($1)", [{ project_id: amit, stage_id: amitStages.elec, delay_type: "site_builder", description: "Society allows material lift use only after 6 PM this week. Plaster and wiring material delivery is slow." }]);
});
await as(id.pooja, "authenticated", async () => {
  await q("insert into task_comments (task_id, author_id, body) values ($1,$2,$3)", [amitTasks.wardrobe, id.pooja, "Waiting for the client to confirm loft height before I finalise."]);
});

// One snag on Kavita's project, raised by the client
await as(id.kavita, "authenticated", async () => {
  await q(
    `insert into snags (project_id, area, category, description, urgency, raised_by)
     values ($1,'Kitchen','carpentry','Drawer below the hob does not close fully.','high',$2)`,
    [kavita, id.kavita],
  );
});

// ---------- Release 4: site updates with photos, more purchases, documents ----------
// A simple "site photo" (wall, floor and a few shapes) as a PNG, so demo data has real images.
function sitePhoto(seed, w = 800, h = 600) {
  const rnd = (() => { let x = seed * 9973; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
  const wall = [210 + rnd() * 30, 200 + rnd() * 30, 185 + rnd() * 30], floor = [150 + rnd() * 40, 120 + rnd() * 30, 95 + rnd() * 30];
  const rects = Array.from({ length: 4 }, () => ({ x: rnd() * w * 0.8, y: rnd() * h * 0.6, w: 60 + rnd() * 220, h: 60 + rnd() * 260,
    c: [130 + rnd() * 70, 115 + rnd() * 60, 95 + rnd() * 50] }));
  const horizon = Math.round(h * (0.6 + rnd() * 0.1));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c = y < horizon ? wall.map((v) => v - (y / h) * 25) : floor.map((v) => v - ((y - horizon) / h) * 30 + ((x + y) % 40 < 2 ? -15 : 0));
      for (const r of rects) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) c = r.c.map((v) => v - ((x - r.x) / r.w) * 20);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
async function storeFile(projectId, entityType, entityId, name, mime, buf, uid) {
  const fid = randomUUID();
  await q(`insert into stored_files (id, project_id, entity_type, entity_id, file_name, mime_type, size_bytes, data, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [fid, projectId, entityType, entityId, name, mime, buf.length, buf, uid]);
  return fid;
}
async function addUpdate(uid, projectId, u, photos) {
  const [row] = await q(
    `insert into site_updates (project_id, title, site_datetime, area, work_category, work_completed, current_activity, next_activity, blockers, status, client_visible, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,auth.uid()) returning id`,
    [projectId, u.title, u.at, u.area, u.work, u.done, u.now ?? null, u.next ?? null, u.blockers ?? null, u.status, u.client_visible]);
  let i = 0;
  for (const p of photos) {
    const fid = await storeFile(projectId, "site_update", row.id, `site-${p.seed}.png`, "image/png", sitePhoto(p.seed), uid);
    await q(`insert into site_update_media (site_update_id, project_id, storage_path, area, caption, client_visible, sort_order, uploaded_by, file_name, mime_type)
             values ($1,$2,$3,$4,$5,$6,$7,auth.uid(),$8,'image/png')`, [row.id, projectId, fid, p.area ?? u.area, p.caption ?? null, p.visible ?? true, ++i, `site-${p.seed}.png`]);
  }
  return row.id;
}
const ts = (n, hh = 11) => `${d(n)}T${String(hh).padStart(2, "0")}:30:00+05:30`;
// Shared updates (written and shared by the project manager)
await as(id.aditya, "authenticated", async () => {
  await addUpdate(id.aditya, amit, { title: "Site handed over, demolition complete", at: ts(-12), area: "Whole home", work: "Civil work", status: "published", client_visible: true,
    done: "Old kitchen platform and bathroom tiles removed. Debris cleared from the flat and the society lift area.", now: "Marking the new electrical points on walls.", next: "Wall chasing for conduits starts on Monday." },
    [{ seed: 11, area: "Kitchen", caption: "Kitchen after removing the old platform" }, { seed: 12, area: "Master bedroom", caption: "Master bedroom, ready for marking" }, { seed: 13, area: "Living room" }]);
  await addUpdate(id.aditya, amit, { title: "Electrical conduits in progress", at: ts(-4, 16), area: "Living room", work: "Electrical", status: "published", client_visible: true,
    done: "Conduits laid in the living room and both bedrooms as per the approved layout. Switchboard positions checked with you on site.", now: "Kitchen conduits and the AC points.", next: "Plumbing lines in the kitchen and bathrooms, then plastering.",
    blockers: "Society lift only after 6 PM; material delivery slow." },
    [{ seed: 21, caption: "Living room conduits before plaster" }, { seed: 22, area: "Master bedroom", caption: "Bed-side switch points" }, { seed: 23, area: "Kitchen", caption: "Kitchen points marked" }, { seed: 24, visible: false, caption: "Damaged section near shaft (team only)" }]);
});
// Waiting for review (written by the site supervisor)
await as(id.sanjay, "authenticated", async () => {
  await addUpdate(id.sanjay, amit, { title: "Kitchen plumbing lines laid", at: ts(-1, 17), area: "Kitchen", work: "Plumbing", status: "pending_review", client_visible: true,
    done: "Inlet and drain lines laid for the sink and the washing machine point. Pressure test done, no leaks.", next: "Plaster on the kitchen walls tomorrow." },
    [{ seed: 31, caption: "Sink inlet and drain" }, { seed: 32, caption: "Washing machine point" }]);
});
await as(id.neha, "authenticated", async () => {
  await addUpdate(id.neha, kavita, { title: "Wardrobe shutters installed", at: ts(-2), area: "Master bedroom", work: "Wardrobes", status: "published", client_visible: true,
    done: "Wardrobe shutters fitted and aligned. Handles go on after you confirm the finish.", next: "Kitchen shutters and the loft." },
    [{ seed: 41, caption: "Wardrobe with shutters" }, { seed: 42, area: "Kitchen", caption: "Kitchen carcass ready" }]);
});
// More client purchases on Amit's project + a reference image
await as(id.rahul, "authenticated", async () => {
  const rows = await q(
    `insert into purchase_requirements (project_id, item_name, category, area, width, height, depth, unit, required_purchase_date, required_delivery_date, status, responsibility, description, technical_specs, created_by)
     values ($1,'Washing machine','Appliance','Utility',600,850,560,'mm',$2,$3,'purchased','client','Front load, fits under the utility counter.','Water inlet and drain on the left. 15A socket provided.',auth.uid()),
            ($1,'Chimney','Appliance','Kitchen',90,null,null,'cm',$4,$5,'delivery_scheduled','client','Wall-mounted, 90 cm wide, matching the hob.','Duct outlet 6 inch. Suction 1200 m³/h or more.',auth.uid()),
            ($1,'Ceiling fans','Fans','Whole home',null,null,null,'mm',$6,$7,'not_yet_required','client','Four fans: living, dining and two bedrooms.',null,auth.uid()),
            ($1,'Sanitaryware set','Sanitaryware','Bathroom',null,null,null,'mm',$8,$9,'delivered','client','WC, basin and health faucet as selected.',null,auth.uid())
     returning id, item_name`, [amit, d(-6), d(-1), d(-3), d(2), d(30), d(45), d(-20), d(-10)]);
  const fridge = (await q("select id from purchase_requirements where project_id = $1 and item_name = 'Refrigerator'", [amit]))[0];
  const fid = await storeFile(amit, "purchase", fridge.id, "fridge-reference.png", "image/png", sitePhoto(77, 400, 400), id.rahul);
  await q("update purchase_requirements set reference_image_path = $2, suggested_options = $3, technical_specs = $4 where id = $1",
    [fridge.id, fid, "Samsung RT42 or LG GL-T422 (both fit)", "Leave 25 mm on each side and 50 mm at the back for ventilation."]);
  void rows;
  // Shared documents
  for (const [title, type, visible, seed] of [["Final floor plan", "floor_plan", true, 51], ["Electrical layout", "electrical_layout", true, 52], ["Site measurements", "site_measurement", false, 53]]) {
    const docId = randomUUID();
    const fid2 = await storeFile(amit, "document", docId, `${title}.png`, "image/png", sitePhoto(seed, 500, 360), id.rahul);
    await q(`insert into project_documents (id, project_id, doc_type, title, storage_path, file_name, mime_type, size_bytes, client_visible, uploaded_by)
             values ($1,$2,$3,$4,$5,$6,'image/png',$7,$8,auth.uid())`, [docId, amit, type, title, fid2, `${title}.png`, 40000, visible]);
  }
});

console.log(`Seeded: organisation, ${people.length} people, 3 projects. Password for all demo accounts: Demo@1234`);
await db.end();
