// End-to-end check of Release 3 (stages, timeline, tasks, dependencies,
// blockers) in a real browser, with screenshots. Run on fresh demo data:
//   bash scripts/db-reset.sh && npm run build && npm start   (another terminal)
//   node scripts/e2e-release3.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import pg from "pg";
const { chromium } = createRequire(import.meta.url)("playwright");

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "screenshots/release3";
fs.mkdirSync(OUT, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const browser = await chromium.launch();
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`); if (!cond) failures++; };

async function session(email, { mobile = false } = {}) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "Demo@1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button:has-text('Sign in')")]);
  return { ctx, page };
}
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const settle = (page) => page.waitForLoadState("networkidle");
const until = async (sql, args, test = (r) => r) => { for (let i = 0; i < 60; i++) { const r = await one(sql, args); if (test(r)) return r; await new Promise((x) => setTimeout(x, 500)); } throw new Error("timed out waiting for " + sql); };
const ok = (page, text) => page.waitForSelector(`.form-ok:has-text("${text}")`, { timeout: 15000 });

const amit = (await one("select id from projects where name like 'Amit%'")).id;
const kavita = (await one("select id from projects where name like 'Kavita%'")).id;
const rohan = (await one("select id from projects where name like 'Rohan%'")).id;

// A sample site photo for evidence uploads
const fx = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await fx.setContent(`<body style="margin:0;height:900px;background:linear-gradient(180deg,#d9d4cc 0 55%,#b9ada0 55% 100%);font-family:Arial;position:relative">
  <div style="position:absolute;left:120px;top:160px;width:260px;height:420px;background:#f4f1ec;border:6px solid #8a7d70"></div>
  <div style="position:absolute;left:500px;top:220px;width:520px;height:30px;background:#6d6257"></div>
  <div style="position:absolute;left:520px;top:300px;width:22px;height:220px;background:#e7c35a"></div>
  <div style="position:absolute;left:600px;top:300px;width:22px;height:220px;background:#e7c35a"></div>
  <div style="position:absolute;left:30px;bottom:30px;color:#fff;font-size:30px;text-shadow:0 1px 3px #000">Living room · conduit before plaster</div></body>`);
const photo = `${OUT}/_site-photo.jpg`;
await fx.screenshot({ path: photo, type: "jpeg", quality: 80 });
await fx.close();

console.log("\nManagement: execution schedule");
const owner = await session("rahul@meraghar.demo");
await owner.page.goto(`${BASE}/m/schedule`);
check(await owner.page.locator("text=Where the delays start").count() > 0, "Execution schedule overview loads");
check(await owner.page.locator("text=Laminate batch from vendor").count() > 0, "Vendor-caused carpentry delay is shown with its cause");
await shot(owner.page, "01-execution-schedule-overview");

await owner.page.goto(`${BASE}/m/projects/${kavita}/schedule`);
check(await owner.page.locator("text=Delay impact").count() > 0, "Delay impact on later stages and the handover is calculated");
await shot(owner.page, "02-project-schedule-delay-impact");

await owner.page.goto(`${BASE}/m/projects/${amit}/schedule`);
const carp = (await one("select id from project_stages where project_id = $1 and name = 'Carpentry'", [amit])).id;
await owner.page.click(`#stage-${carp} > summary`);
await owner.page.waitForSelector(`#stage-${carp} >> text=Update stage`);
await shot(owner.page, "03-project-schedule-stage-open");

await owner.page.goto(`${BASE}/m/projects/${amit}/schedule?view=gantt`);
check(await owner.page.locator("text=Target handover").count() > 0, "Gantt timeline renders with the target handover");
await shot(owner.page, "04-gantt-timeline");
await owner.page.goto(`${BASE}/m/projects/${amit}/schedule?view=calendar`);
await shot(owner.page, "05-calendar-view");
await owner.page.goto(`${BASE}/m/projects/${amit}/schedule?view=milestones`);
await shot(owner.page, "06-milestones-view");

console.log("\nProject manager sets up a schedule from the default stages");
const pm = await session("aditya@meraghar.demo");
await pm.page.goto(`${BASE}/m/projects/${rohan}/schedule`);
const only = (await one("select id from project_stages where project_id = $1", [rohan])).id;
await pm.page.click(`#stage-${only} > summary`);
await pm.page.click(`#stage-${only} button:has-text('Remove stage')`);
await pm.page.waitForSelector("text=Set up default stages");
await pm.page.click("button:has-text('Set up default stages')");
await until("select count(*)::int as n from tasks where project_id = $1 and template_id is not null", [rohan], (r) => r.n > 20);
const rc = await one("select count(*)::int as n, (select count(*)::int from tasks where project_id = $1 and template_id is not null) as t from project_stages where project_id = $1 and deleted_at is null", [rohan]);
check(rc.n === 17 && rc.t > 20, `17 stages and ${rc.t} standard tasks created, each stage waiting for the previous one`);
await pm.page.goto(`${BASE}/m/projects/${rohan}/schedule?view=gantt`);
await shot(pm.page, "07-new-project-default-stages-gantt");

console.log("\nManager creates a task that waits for a client approval");
await pm.page.goto(`${BASE}/m/tasks/new?project=${amit}&stage=${carp}`);
await pm.page.fill("input[name=title]", "Order wardrobe handles from Hettich");
await pm.page.fill("textarea[name=description]", "Order 4 brushed-gold profile handles once the client approves. Delivery to site before wardrobe installation.");
await pm.page.selectOption("select[name=assigned_to]", { label: "Ganesh More · Execution" });
const due = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
await pm.page.fill("input[name=due_date]", due);
await pm.page.selectOption("select[name=priority]", "high");
await pm.page.check("input[name=requires_review]");
const handles = (await one("select id from approvals where title = 'Master bedroom wardrobe handles'")).id;
await pm.page.selectOption("select[name=dep_approval]", [handles]);
await shot(pm.page, "08-new-task-form");
await Promise.all([pm.page.waitForURL(/\/m\/tasks\/[0-9a-f-]{36}$/), pm.page.click("button:has-text('Create task')")]);
await settle(pm.page);
check(await pm.page.locator("text=Not ready yet").count() > 0, "Task shows it is waiting for the client's approval");
const taskUrl = pm.page.url();
await shot(pm.page, "09-task-detail-manager");

console.log("\nEmployee works on tasks and flags a blocker");
const emp = await session("ganesh@meraghar.demo");
await emp.page.goto(`${BASE}/e/tasks`);
check(await emp.page.locator("text=Order wardrobe handles from Hettich").count() > 0, "New task appears in the employee's list");
check(await emp.page.locator("text=Waiting on client approval").count() > 0, "Employee sees the client dependency on the task");
await shot(emp.page, "10-employee-my-tasks");
const notif = await one("select count(*)::int as n from notifications where recipient_id = (select id from profiles where email = 'ganesh@meraghar.demo') and event_type = 'task.assigned' and title like '%wardrobe handles%'");
check(notif.n === 1, "Employee was notified of the new task");

const lights = (await one("select id from tasks where title = 'Install profile lights in living room'")).id;
await emp.page.goto(`${BASE}/e/tasks/${lights}`);
await emp.page.selectOption("form:has(textarea[name=description]) select[name=delay_type]", "vendor");
await emp.page.fill("form:has(select[name=delay_type]) textarea[name=description]", "Profile light drivers not delivered by the supplier. Expected Friday.");
await emp.page.click("button:has-text('Flag blocker')");
await ok(emp.page, "Blocker flagged");
await emp.page.reload();
check(await emp.page.locator("text=Blocked:").count() > 0, "Task is now blocked with the reason shown");
await emp.page.goto(`${BASE}/e/blockers`);
await shot(emp.page, "11-employee-blockers");

console.log("\nSupervisor completes a task with photo evidence (phone)");
const sup = await session("sanjay@meraghar.demo", { mobile: true });
const elec = (await one("select id from tasks where title = 'Confirm electrical point positions with client'")).id;
await sup.page.goto(`${BASE}/e/tasks/${elec}`);
await sup.page.fill("textarea[name=notes]", "Walked through all rooms with Mr Jain. Two points moved in the master bedroom; marked on site.");
await sup.page.setInputFiles("input[name=evidence]", [photo]);
await sup.page.waitForSelector("text=1 file ready");
await sup.page.click("button:has-text('Mark complete')");
await until("select status from tasks where id = $1", [elec], (r) => r.status === "completed");
await sup.page.reload();
check(await sup.page.locator("img[alt='_site-photo.jpg']").count() > 0, "Evidence photo is saved on the task");
await shot(sup.page, "12-employee-task-complete-mobile");

console.log("\nManagers resolve the blocker and review work");
const neha = await session("neha@meraghar.demo");
await neha.page.goto(`${BASE}/m/notifications`);
check(await neha.page.locator("text=Profile light drivers").count() > 0, "Project manager was notified about the blocker");
await neha.page.goto(`${BASE}/m/tasks/${lights}`);
await neha.page.click("summary:has-text('Mark resolved')");
await neha.page.fill("input[name=note]", "Drivers delivered this morning");
await neha.page.click("button:has-text('Resolve')");
await until("select count(*)::int as n from blockers where task_id = $1 and resolved_at is null", [lights], (r) => r.n === 0);
check((await one("select status from tasks where id = $1", [lights])).status === "in_progress", "Resolving the blocker puts the task back in progress");

const conduit = (await one("select id from tasks where title = 'Check concealed conduit before plastering'")).id;
await pm.page.goto(`${BASE}/m/tasks?view=review`);
check(await pm.page.locator("text=Check concealed conduit").count() > 0, "Completed work waiting for review is listed");
await pm.page.goto(`${BASE}/m/tasks/${conduit}`);
await pm.page.click("button:has-text('Accept')");
await until("select reviewed_at is not null as ok from tasks where id = $1", [conduit], (r) => r.ok);
check((await one("select reviewed_at is not null as ok from tasks where id = $1", [conduit])).ok, "Review accepted and recorded");

console.log("\nManager moves a stage; later stages follow; client sees the new timeline");
await pm.page.goto(`${BASE}/m/projects/${amit}/schedule`);
await pm.page.click(`#stage-${carp} > summary`);
const form = pm.page.locator(`#stage-${carp} form:has(button:has-text('Save stage'))`);
const end = await form.locator("input[name=planned_end_date]").inputValue();
const later = new Date(Date.parse(end + "T00:00:00Z") + 5 * 86400000).toISOString().slice(0, 10);
await form.locator("input[name=planned_end_date]").fill(later);
await form.locator("button:has-text('Save stage')").click();
await pm.page.waitForSelector(`#stage-${carp} .form-error`);
check(true, "Saving a date change without a reason is refused");
await form.locator("input[name=reason]").fill("Shutter laminate approval came 5 days late");
await form.locator("button:has-text('Save stage')").click();
await ok(pm.page, "later stage");
const moved = await one("select count(*)::int as n from schedule_changes where project_id = $1 and entity_type = 'stage'", [amit]);
check(moved.n >= 3, `Carpentry and the ${moved.n - 1} stages after it moved, each with the reason recorded`);
await pm.page.goto(`${BASE}/m/projects/${amit}/schedule`);
await shot(pm.page, "13-schedule-history-after-move");

await pm.page.goto(`${BASE}/m/tasks`);
await shot(pm.page, "14-management-tasks-workload");

const client = await session("amit@client.demo");
await client.page.goto(`${BASE}/c/notifications`);
check(await client.page.locator("text=Your project timeline has been updated").count() === 1, "Client got one timeline update (not one per stage)");
check(await client.page.locator("text=Shutter laminate approval").count() === 0, "Internal reason is not shown to the client");
await client.page.goto(`${BASE}/c/project`);
check(await client.page.locator("text=Check concealed conduit").count() === 0, "Client never sees internal tasks");
await shot(client.page, "15-client-timeline");
const cm = await session("amit@client.demo", { mobile: true });
await cm.page.goto(`${BASE}/c/project`);
await shot(cm.page, "16-client-timeline-mobile");

console.log("\nPermissions in the browser");
await emp.page.goto(`${BASE}/e/projects/${rohan}`);
check(await emp.page.locator("text=404").count() > 0 || await emp.page.locator("text=could not be found").count() > 0, "Employee can't open a project they're not assigned to");
const rohanTask = (await one("select id from tasks where project_id = $1 limit 1", [rohan])).id;
await emp.page.goto(`${BASE}/e/tasks/${rohanTask}`);
check(await emp.page.locator("text=404").count() > 0 || await emp.page.locator("text=could not be found").count() > 0, "Employee can't open another project's task");

await owner.page.goto(`${BASE}/m/settings`);
await owner.page.click("summary:has-text('Carpentry')");
await shot(owner.page, "17-settings-default-stages-tasks");
await owner.page.goto(`${BASE}/m`);
await shot(owner.page, "18-management-dashboard");
await emp.page.goto(`${BASE}/e`);
await shot(emp.page, "19-employee-dashboard");
const empMobile = await session("ganesh@meraghar.demo", { mobile: true });
await empMobile.page.goto(taskUrl.replace("/m/", "/e/"));
await shot(empMobile.page, "20-employee-task-mobile");

await browser.close();
await db.end();
console.log(failures ? `\n${failures} check(s) failed\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
