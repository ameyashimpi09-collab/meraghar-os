// End-to-end check of the quotation PDF reader in a real browser, with
// screenshots. Uses the stand-in Claude API (scripts/mock-claude.mjs):
//   bash scripts/db-reset.sh && npm run build
//   node scripts/mock-claude.mjs &                      (another terminal)
//   ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=test npm start
//   node scripts/e2e-quotation.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import pg from "pg";
const { chromium } = createRequire(import.meta.url)("playwright");

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "screenshots/quotation";
const PDF = new URL("./fixtures/sample-quotation.pdf", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query("set role service_role"); // test checks read everything
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
const ok = (page, text) => page.waitForSelector(`.form-ok:has-text("${text}")`, { timeout: 20000 });

// A fresh project with no payment schedule, created the normal way by the owner.
const rahul = (await one("select id from profiles where email = 'rahul@meraghar.demo'")).id;
const aditya = (await one("select id from profiles where email = 'aditya@meraghar.demo'")).id;
await db.query("begin");
await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rahul, role: "authenticated" })]);
await db.query("set local role authenticated");
const pid = (await one("select create_project($1) as id", [JSON.stringify({
  name: "Amit Kulkarni – 3BHK, Baner", city: "Pune", property_config: "3 BHK", project_manager_id: aditya, status: "active",
})])).id;
await db.query("commit");
await db.query("set role service_role");

console.log("\nManagement: upload and read a quotation");
const owner = await session("rahul@meraghar.demo");
const P = owner.page;
await P.goto(`${BASE}/m/projects/${pid}`);
check(await P.locator("text=Upload quotation PDF").count() > 0, "Project page offers to upload the quotation");
await P.click("text=Upload quotation PDF");
await P.waitForURL(`**/m/projects/${pid}/quotation`);
await shot(P, "01-quotation-empty");
await P.setInputFiles("input[name=pdf]", PDF);
await P.click("button:has-text('Upload and read quotation')");
check(await P.locator("button:has-text('Reading the quotation')").count() > 0, "Shows 'Reading the quotation…' while it works");
await P.waitForSelector("#review", { timeout: 60000 });
const rows = await P.locator("tr.quote-row").count();
check(rows === 8, `All 8 line items were read (got ${rows})`);
check(await P.inputValue("input[name=grand_total]") === "1016688", "Grand total read as ₹10,16,688");
check(await P.locator("text=The lines and totals match").count() > 0, "Lines and totals are checked and match");
check(await P.locator("text=Not saved to the project yet").count() > 0, "Clearly marked as not saved yet");
const d = await one("select *, quote_date::text as qd from project_quotations where project_id = $1", [pid]);
check(d.status === "draft" && d.quote_number === "SQ-2026-041" && d.qd === "2026-11-20", "Draft kept with quotation no. and date");
check(d.file_id && (await one("select entity_type from stored_files where id = $1", [d.file_id])).entity_type === "quotation", "The PDF is stored with the quotation");
await P.evaluate(() => document.getElementById("review").scrollIntoView());
await shot(P, "02-review-read-quotation");

console.log("\nManagement: correct a line, then confirm");
const amt = P.locator("tr.quote-row").nth(1).locator("input[name=amount]");
await amt.fill("2090");
check(await P.locator("text=A line may be missing or misread").count() > 0, "Warns when the lines don't add up to the subtotal");
check(await P.locator("tr.quote-row").nth(1).locator("text=Qty × rate").count() > 0, "Flags a line where qty × rate ≠ amount");
await shot(P, "03-review-mismatch-warning", false);
await amt.fill("20900");
await P.locator("tr.quote-row").nth(2).locator("input[name=description]").fill("Shoe rack with seating");
await P.click("button:has-text('Save changes')");
await ok(P, "Changes saved");
check((await one("select description from project_quotation_items where quotation_id = $1 and sort_order = 3", [d.id])).description === "Shoe rack with seating", "Edited line saved");
await P.click("button:has-text('Confirm quotation')");
await P.waitForSelector("text=Quotation confirmed and saved to the project", { timeout: 20000 });
const c = await one("select * from project_quotations where id = $1", [d.id]);
check(c.status === "confirmed" && Number(c.grand_total_paise) === 101668800 && c.confirmed_by === rahul, "Confirmed: ₹10,16,688 saved as the project's quotation value");
check(await P.locator("text=Quotation value").count() > 0, "Quotation value shown");
await shot(P, "04-confirmed-quotation");

console.log("\nManagement: payment schedule from the quotation");
check(await P.locator("text=Create the payment schedule from this quotation").count() > 0, "Offers to create the payment schedule");
await P.locator("input[name=ms_pct]").nth(0).fill("15");
check(await P.locator("text=(must be 100%)").count() > 0, "Percentages must add up to 100%");
await P.locator("input[name=ms_pct]").nth(0).fill("10");
await P.click("button:has-text('Create payment schedule')");
await P.waitForURL(`**/m/projects/${pid}/payments`, { timeout: 20000 });
const ms = (await db.query("select name, amount_paise from payment_milestones where project_id = $1 and deleted_at is null order by sort_order", [pid])).rows;
check(ms.length === 5 && ms.reduce((s, m) => s + Number(m.amount_paise), 0) === 101668800, "5 milestones created, adding up exactly to the quotation");
check(Number(ms[0].amount_paise) === 10166900, `Booking advance = 10% rounded to the rupee (got ₹${Number(ms[0].amount_paise) / 100})`);
check(await P.locator("text=fully covered by the payment schedule").count() > 0, "Payments page compares the schedule with the quotation");
await shot(P, "05-payments-from-quotation");
await P.goto(`${BASE}/m/projects/${pid}`);
check(await P.locator("text=Quotation value").count() > 0, "Project page shows the quotation value");
await shot(P, "06-project-page-quotation");

console.log("\nManagement: revised quotation");
await P.goto(`${BASE}/m/projects/${pid}/quotation`);
await P.setInputFiles("input[name=pdf]", PDF);
await P.click("button:has-text('Upload and read revised quotation')");
await P.waitForSelector("#review", { timeout: 60000 });
check(await one("select count(*)::int as n from project_quotations where project_id = $1 and status = 'confirmed'", [pid]).then((r) => r.n === 1), "Current quotation stays in place while the revision is checked");
await P.locator("input[name=grand_total]").fill("1050000");
await P.locator("input[name=tax]").fill("188400");
await P.click("button:has-text('Confirm quotation')");
await P.waitForSelector("text=Quotation confirmed and saved to the project", { timeout: 20000 });
const st = (await db.query("select status, grand_total_paise from project_quotations where project_id = $1 order by created_at", [pid])).rows;
check(st.length === 2 && st[0].status === "replaced" && st[1].status === "confirmed" && Number(st[1].grand_total_paise) === 105000000, "Revision confirmed; the old one is kept as history");
check(await P.locator("text=Earlier quotations").count() > 0, "Earlier quotation listed");
check(await P.locator("text=not yet in schedule").count() + await P.locator("text=Not yet in schedule").count() > 0, "Shows the amount not yet in the payment schedule");
await shot(P, "07-revised-with-history");

console.log("\nManagement: discard an upload");
await P.setInputFiles("input[name=pdf]", PDF);
await P.click("button:has-text('Upload and read revised quotation')");
await P.waitForSelector("#review", { timeout: 60000 });
await P.click("button:has-text('Discard this upload')");
await P.waitForSelector("#review", { state: "detached", timeout: 20000 });
check(await one("select count(*)::int as n from project_quotations where project_id = $1 and status = 'draft'", [pid]).then((r) => r.n === 0), "Draft and its PDF removed");

console.log("\nWho can see it");
const neha = await session("neha@meraghar.demo");
await neha.page.goto(`${BASE}/m/projects/${pid}/quotation`);
check(await neha.page.locator("text=Quotation value").count() === 0 && await neha.page.locator("text=10,50,000").count() === 0, "A project manager of another project cannot see it");
const pooja = await session("pooja@meraghar.demo");
await pooja.page.goto(`${BASE}/m/projects/${pid}/quotation`);
check(!pooja.page.url().includes("/quotation"), "Designer is sent away from the quotation page");
const qf = (await one("select file_id from project_quotations where project_id = $1 and status = 'confirmed'", [pid])).file_id;
const fileRes = await pooja.page.request.get(`${BASE}/files/${qf}`);
check(fileRes.status() === 404, "Designer cannot open the quotation PDF");
const ownerFile = await P.request.get(`${BASE}/files/${qf}`);
check(ownerFile.status() === 200 && (ownerFile.headers()["content-type"] ?? "").includes("pdf"), "Owner can open the quotation PDF");

console.log("\nMobile");
const mob = await session("aditya@meraghar.demo", { mobile: true });
await mob.page.goto(`${BASE}/m/projects/${pid}/quotation`);
check(await mob.page.locator("text=Quotation value").count() > 0, "Project manager of the project sees the quotation on mobile");
await shot(mob.page, "08-quotation-mobile");

await browser.close();
await db.end();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll quotation checks passed");
process.exit(failures ? 1 : 0);
