// End-to-end check of Release 4 (site updates, photo gallery, client purchases,
// snags, documents) in a real browser, with screenshots. Run on fresh demo data:
//   bash scripts/db-reset.sh && npm run build && npm start   (another terminal)
//   node scripts/e2e-release4.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import pg from "pg";
const { chromium } = createRequire(import.meta.url)("playwright");

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "screenshots/release4";
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

// Realistic-looking sample site photos for uploads
async function makePhoto(name, label, bg) {
  const fx = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await fx.setContent(`<body style="margin:0;height:900px;background:${bg};font-family:Arial;position:relative">
    <div style="position:absolute;left:0;right:0;top:560px;bottom:0;background:linear-gradient(180deg,#b3a493,#8f8172)"></div>
    <div style="position:absolute;left:110px;top:170px;width:420px;height:390px;background:#efe9df;border:8px solid #7d6e60"></div>
    <div style="position:absolute;left:600px;top:260px;width:460px;height:300px;background:#d8cdbd;border-top:26px solid #5f554b"></div>
    <div style="position:absolute;left:630px;top:300px;width:16px;height:240px;background:#c9a65a"></div>
    <div style="position:absolute;left:30px;bottom:30px;color:#fff;font-size:30px;text-shadow:0 1px 3px #000">${label}</div></body>`);
  const path = `${OUT}/_${name}.jpg`;
  await fx.screenshot({ path, type: "jpeg", quality: 80 });
  await fx.close();
  return path;
}
const p1 = await makePhoto("p1", "Kitchen · tall unit carcass fixed", "linear-gradient(180deg,#e2dbd0,#cfc6b8)");
const p2 = await makePhoto("p2", "Kitchen · loft shutters", "linear-gradient(180deg,#ddd6cb,#c8bfb0)");
const p3 = await makePhoto("p3", "Plywood stock (team only)", "linear-gradient(180deg,#d6d0c6,#bdb4a6)");
const snagPhoto = await makePhoto("snag", "Bathroom · grout gap near basin", "linear-gradient(180deg,#e6e6e2,#cfd2cf)");
const fixPhoto = await makePhoto("fix", "Bathroom · grout refilled", "linear-gradient(180deg,#eceae4,#d6d8d2)");

console.log("\nSite supervisor posts a site update with photos and sends it for review");
const sup = await session("sanjay@meraghar.demo");
await sup.page.goto(`${BASE}/e/updates/new?project=${amit}`);
await sup.page.fill("#title", "Kitchen carpentry underway");
await sup.page.fill("#area", "Kitchen");
await sup.page.fill("#work_category", "Carpentry");
await sup.page.fill("#work_completed", "Tall unit and base carcasses fixed to the wall and levelled. Loft shutters hung.");
await sup.page.fill("#current_activity", "Fixing the hob cut-out and the sink base.");
await sup.page.fill("#next_activity", "Shutters and handles after the laminate approval.");
await sup.page.fill("#blockers", "Two plywood sheets were damaged in transit; replacements arrive Friday.");
await sup.page.setInputFiles("input[name=photos]", [p1, p2, p3]);
await sup.page.waitForSelector("text=3 files ready");
await shot(sup.page, "01-employee-new-site-update");
await Promise.all([sup.page.waitForURL(/\/e\/updates\/[0-9a-f-]{36}/), sup.page.click("button:has-text('Send for review')")]);
await settle(sup.page);
check(await sup.page.locator("text=Sent to the project manager for review").count() > 0, "Update is sent for review");
const upd = await one("select id, status from site_updates where title = 'Kitchen carpentry underway'");
check(upd.status === "pending_review", "Saved as waiting for review");
check((await one("select count(*)::int as n from site_update_media where site_update_id = $1", [upd.id])).n === 3, "3 photos stored");
check((await one("select count(*)::int as n from notifications where entity_id = $1 and event_type = 'site_update.submitted'", [upd.id])).n >= 1, "Project manager notified");

console.log("\nProject manager reviews, hides an internal photo and shares with the client");
const pm = await session("aditya@meraghar.demo");
await pm.page.goto(`${BASE}/m/updates`);
check(await pm.page.locator("text=Kitchen carpentry underway").count() > 0, "Update appears under To review");
await shot(pm.page, "02-manager-updates-to-review");
await pm.page.goto(`${BASE}/m/updates/${upd.id}`);
const third = pm.page.locator("li", { has: pm.page.locator("input[value='Plywood stock (team only)']") }).first();
const media3 = (await one("select id from site_update_media where site_update_id = $1 order by sort_order desc limit 1", [upd.id])).id;
await pm.page.fill(`form:has(input[name=media_id][value='${media3}']) input[name=caption]`, "Plywood stock (team only)");
await pm.page.click(`form:has(input[name=media_id][value='${media3}']) button:has-text('Hide from client')`);
await until("select client_visible from site_update_media where id = $1", [media3], (r) => r.client_visible === false);
void third;
await pm.page.reload();
await shot(pm.page, "03-manager-review-site-update");
await pm.page.click("button:has-text('Share with client') >> nth=0");
await until("select status, client_visible from site_updates where id = $1", [upd.id], (r) => r.status === "published" && r.client_visible);
check(true, "Update shared with the client");
check((await one("select count(*)::int as n from notifications where entity_id = $1 and event_type = 'site_update.published'", [upd.id])).n >= 1, "Client notified about the new update");

console.log("\nClient sees the update and the photo gallery");
const cl = await session("amit@client.demo");
await cl.page.goto(`${BASE}/c`);
check(await cl.page.locator("text=Latest from site").count() > 0, "Client home shows the latest site update");
await shot(cl.page, "04-client-home");
await cl.page.goto(`${BASE}/c/updates`);
check(await cl.page.locator("text=Kitchen carpentry underway").count() > 0, "Client sees the shared update");
check(await cl.page.locator("text=Plywood stock").count() === 0, "Team-only photo is not shown to the client");
check(await cl.page.locator("text=damaged in transit").count() === 0, "Internal blockers are not shown to the client");
await shot(cl.page, "05-client-site-updates-feed");
await cl.page.goto(`${BASE}/c/updates?view=photos`);
await shot(cl.page, "06-client-photos-by-room");
await cl.page.locator("ul button").first().click();
await cl.page.waitForSelector("[role=dialog]");
await shot(cl.page, "07-client-photo-full-screen", false);
await cl.page.keyboard.press("Escape");

console.log("\nManager adds a client purchase with dimensions");
await pm.page.goto(`${BASE}/m/projects/${amit}/purchases`);
const add = pm.page.locator("section:has(h2:has-text('Add an item')) form");
await add.locator("input[name=item_name]").fill("Microwave (built-in)");
await add.locator("input[name=category]").fill("Appliance");
await add.locator("input[name=area]").fill("Kitchen");
await add.locator("input[name=width]").fill("595");
await add.locator("input[name=height]").fill("455");
await add.locator("input[name=depth]").fill("560");
await add.locator("textarea[name=description]").fill("Built-in microwave for the tall unit, above the oven.");
await add.locator("textarea[name=technical_specs]").fill("Niche 560 × 450 × 550 mm. 15A socket behind the unit.");
await add.locator("input[name=required_purchase_date]").fill(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
await add.locator("input[name=required_delivery_date]").fill(new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10));
await add.locator("select[name=status]").selectOption("client_informed");
await add.locator("button:has-text('Add item')").click();
await until("select id from purchase_requirements where item_name = 'Microwave (built-in)'", []);
const mw = await one("select id, width_mm from purchase_requirements where item_name = 'Microwave (built-in)'");
check(Number(mw.width_mm) === 595, "Purchase saved with dimensions");
check((await one("select count(*)::int as n from notifications where entity_id = $1 and event_type = 'purchase.required'", [mw.id])).n === 1, "Client asked to purchase it");
await pm.page.reload();
await shot(pm.page, "08-manager-project-purchases");

console.log("\nClient updates the purchase");
await cl.page.goto(`${BASE}/c/purchases`);
await shot(cl.page, "09-client-purchases");
const card = cl.page.locator(`#p-${mw.id}`);
await card.locator("input[value=delivery_scheduled]").check();
await card.locator("input[name=client_delivery_on]").fill(new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10));
await card.locator("textarea[name=client_remarks]").fill("Bought Bosch BFL634GS1I, delivery booked.");
await card.locator("button:has-text('Save update')").click();
await until("select status from purchase_requirements where id = $1", [mw.id], (r) => r.status === "delivery_scheduled");
check(true, "Client's delivery date and note are saved");
check((await one("select count(*)::int as n from notifications where entity_id = $1 and event_type = 'purchase.updated'", [mw.id])).n >= 1, "Manager notified of the client's update");
await pm.page.goto(`${BASE}/m/purchases`);
check(await pm.page.locator("text=Washing machine").count() > 0, "Procurement shows the late client purchase");
await shot(pm.page, "10-procurement-overview");

console.log("\nClient raises a concern with a photo");
await cl.page.goto(`${BASE}/c/snags/new`);
await cl.page.selectOption("#area", "Bathroom");
await cl.page.selectOption("#category", "workmanship");
await cl.page.fill("#description", "Grout gap between the basin counter and the wall tiles.");
await cl.page.check("input[name=urgency][value=medium]");
await cl.page.setInputFiles("input[name=photos]", [snagPhoto]);
await cl.page.waitForSelector("text=1 file ready");
await shot(cl.page, "11-client-raise-concern");
await Promise.all([cl.page.waitForURL(/\/c\/snags\/[0-9a-f-]{36}/), cl.page.click("button:has-text('Send to our team')")]);
const sn = await one("select id from snags where description like 'Grout gap%'");
check((await one("select count(*)::int as n from snag_attachments where snag_id = $1", [sn.id])).n === 1, "Concern saved with its photo");
check((await one("select count(*)::int as n from notifications where entity_id = $1 and event_type = 'snag.new'", [sn.id])).n >= 1, "Manager notified of the new concern");

console.log("\nManager assigns it; the team fixes it with photos");
await pm.page.goto(`${BASE}/m/snags`);
await shot(pm.page, "12-manager-snags");
await pm.page.goto(`${BASE}/m/snags/${sn.id}`);
await pm.page.selectOption("select[name=assignee]", { label: "Ganesh More · Execution" });
await pm.page.fill("form:has(select[name=assignee]) textarea[name=note]", "Please refill with white epoxy grout.");
await pm.page.click("button:has-text('Assign')");
await until("select status from snags where id = $1", [sn.id], (r) => r.status === "assigned");
check(true, "Assigned to Ganesh");
const g = await session("ganesh@meraghar.demo", { mobile: true });
await g.page.goto(`${BASE}/e/snags`);
check(await g.page.locator("text=Grout gap").count() > 0, "Concern appears in the employee's snag list");
await g.page.goto(`${BASE}/e/snags/${sn.id}`);
await g.page.click("button:has-text('Start work')");
await until("select status from snags where id = $1", [sn.id], (r) => r.status === "in_progress");
await g.page.reload();
await g.page.setInputFiles("input[name=photos]", [fixPhoto]);
await g.page.fill("form:has(button:has-text('Submit fix')) textarea[name=note]", "Old grout removed, refilled with white epoxy grout, cleaned.");
await shot(g.page, "13-employee-submit-fix-mobile");
await g.page.click("button:has-text('Submit fix')");
await until("select resolution_submitted_at from snags where id = $1", [sn.id], (r) => r.resolution_submitted_at);
check(true, "Fix submitted with a photo");
await pm.page.goto(`${BASE}/m/snags/${sn.id}`);
await shot(pm.page, "14-manager-check-fix");
await pm.page.click("button:has-text('Mark resolved')");
await until("select status from snags where id = $1", [sn.id], (r) => r.status === "awaiting_client_confirmation");
check(true, "Manager accepted; waiting for the client to confirm");

console.log("\nClient confirms");
await cl.page.goto(`${BASE}/c/snags/${sn.id}`);
await shot(cl.page, "15-client-confirm-fix");
await cl.page.click("button:has-text('Yes, it is fixed')");
await until("select status from snags where id = $1", [sn.id], (r) => r.status === "resolved");
check(true, "Client confirmed; concern resolved");
await cl.page.reload();
await shot(cl.page, "16-client-concern-resolved");

console.log("\nDocuments");
const pdf = `${OUT}/_layout.pdf`;
fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
await pm.page.goto(`${BASE}/m/projects/${amit}/documents`);
const up = pm.page.locator("section:has(h2:has-text('Upload')) form");
await up.locator("input[name=title]").fill("Kitchen elevations");
await up.locator("select[name=doc_type]").selectOption("design_presentation");
await up.locator("input[name=file]").setInputFiles(pdf);
await up.locator("input[name=client_visible]").check();
await up.locator("button:has-text('Upload document')").click();
await until("select id from project_documents where title = 'Kitchen elevations'", []);
check(true, "Document uploaded and shared");
await pm.page.reload();
await shot(pm.page, "17-manager-documents");
await cl.page.goto(`${BASE}/c/documents`);
check(await cl.page.locator("text=Kitchen elevations").count() > 0, "Client sees the shared document");
check(await cl.page.locator("text=Site measurements").count() === 0, "Team-only document is hidden from the client");
await shot(cl.page, "18-client-documents");

console.log("\nMobile and project overview");
const clm = await session("amit@client.demo", { mobile: true });
await clm.page.goto(`${BASE}/c/updates`);
await shot(clm.page, "19-client-updates-mobile");
await clm.page.goto(`${BASE}/c/purchases`);
await shot(clm.page, "20-client-purchases-mobile");
await pm.page.goto(`${BASE}/m/projects/${amit}`);
await shot(pm.page, "21-manager-project-page");
await pm.page.goto(`${BASE}/m`);
await shot(pm.page, "22-management-dashboard");

await browser.close();
await db.end();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Release 4 checks passed");
process.exit(failures ? 1 : 0);
