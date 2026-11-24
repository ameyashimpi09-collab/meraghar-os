// End-to-end check of Release 2 (approvals, payments, reminders) in a real
// browser, with screenshots. Run on fresh demo data with the app on :3000:
//   bash scripts/db-reset.sh && npm run build && npm start   (another terminal)
//   node scripts/e2e-release2.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "screenshots/release2";
fs.mkdirSync(OUT, { recursive: true });
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

// Sample design files: a rendered "laminate board" image and a one-page PDF spec
const fx = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await fx.setContent(`<body style="margin:0;display:grid;grid-template-columns:2fr 1fr;height:800px;font-family:Georgia">
  <div style="background:linear-gradient(115deg,#6b4a2f 0%,#8a6440 18%,#5d3f27 32%,#94704b 55%,#6e4c30 75%,#a07a52 100%);position:relative">
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(0,0,0,.06) 0 2px,transparent 2px 9px)"></div>
    <div style="position:absolute;left:40px;bottom:40px;color:#fff;font-size:34px">Walnut veneer · TV unit</div></div>
  <div style="background:#efe9df;display:grid;grid-template-rows:1fr 1fr 1fr">
    <div style="background:#2f2d2a"></div><div style="background:#c9b79c"></div><div style="background:#ece6dc;border-top:1px solid #d5ccbd"></div></div></body>`);
const imgPath = `${OUT}/_sample-design.jpg`;
await fx.screenshot({ path: imgPath, type: "jpeg", quality: 85 });
const pdfPath = `${OUT}/_sample-spec.pdf`;
await fx.setContent(`<h1 style="font-family:Georgia">TV unit · Specification sheet</h1><p>Walnut veneer, PU matte, 2400 x 450 x 1800 mm.</p>`);
await fx.pdf({ path: pdfPath, format: "A4" });
await fx.close();

console.log("\nManager creates and sends an approval");
const owner = await session("rahul@meraghar.demo");
await owner.page.goto(`${BASE}/m/approvals`);
check((await owner.page.locator("text=Living room wallpaper").count()) > 0, "Approvals list shows real approvals across projects");
await shot(owner.page, "01-management-approvals-list");

await owner.page.goto(`${BASE}/m/projects`);
await owner.page.click("text=Amit Jain");
await owner.page.waitForSelector("text=Design & material approvals");
await owner.page.click("text=+ New approval");
await owner.page.fill("input[name=title]", "Living room TV unit – walnut");
await owner.page.fill("input[name=area]", "Living room");
await owner.page.fill("input[name=category]", "Carpentry");
await owner.page.fill("input[name=item_name]", "TV unit with fluted panel");
const deadline = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
await owner.page.fill("input[name=deadline]", deadline);
await Promise.all([owner.page.waitForURL(/\/m\/approvals\/[0-9a-f-]{36}$/), owner.page.click("button:has-text('Create and add details')")]);
const approvalUrl = owner.page.url();
check(true, "Approval created as a draft");

await owner.page.fill("textarea[name=client_description]", "Wall-mounted TV unit in natural walnut veneer with a fluted panel behind the TV and two floating drawers. Concealed wiring channel included.");
await owner.page.fill("input[name=material_brand]", "Greenlam");
await owner.page.fill("input[name=material_type]", "Natural veneer on BWP ply");
await owner.page.fill("input[name=colour]", "American walnut");
await owner.page.fill("input[name=finish]", "PU matte");
await owner.page.fill("input[name=dimensions]", "2400 W x 450 D x 1800 H mm");
await owner.page.fill("input[name=quantity]", "1");
await owner.page.fill("input[name=quantity_unit]", "unit");
await owner.page.fill("input[name=commercial_impact]", "18500");
await owner.page.setInputFiles("input[name=files]", [imgPath, pdfPath]);
await owner.page.waitForSelector("text=2 files ready");
await owner.page.click("button:has-text('Save draft')");
await owner.page.waitForSelector("text=with 2 files added");
await settle(owner.page);
check((await owner.page.locator("img[alt='_sample-design.jpg']").count()) >= 1, "Design image uploaded and shown");
await shot(owner.page, "02-approval-draft-editor");
await owner.page.click("button:has-text('Send revision 1 to client')");
await owner.page.waitForSelector("text=Sent to the client");
await owner.page.reload();
check((await owner.page.locator("text=Waiting for client").count()) > 0, "Status is now 'Waiting for client'");

console.log("\nClient reviews and approves");
const client = await session("amit@client.demo");
await client.page.waitForSelector("text=What we need from you");
check((await client.page.locator("text=Living room TV unit – walnut").count()) > 0, "Client home lists the new approval");
await client.page.goto(`${BASE}/c/approvals`);
await shot(client.page, "03-client-approvals-list");
await Promise.all([client.page.waitForURL(/\/c\/approvals\/[0-9a-f-]{36}$/), client.page.click("text=Living room TV unit – walnut")]);
await client.page.waitForSelector("text=Confirm approval");
check((await client.page.locator("text=American walnut").count()) > 0, "Client sees specifications");
check((await client.page.locator("text=+₹18,500 additional").count()) > 0, "Client sees the commercial impact");
await shot(client.page, "04-client-approval-detail");
await client.page.click("button:has-text('Confirm approval')");
await client.page.waitForSelector("text=Please tick the box");
check(true, "Approval without the confirmation tick is refused");
await client.page.check("input[name=confirm]");
await client.page.click("button:has-text('Confirm approval')");
await client.page.waitForSelector("text=You approved revision 1");
check(true, "Client approval recorded");

const mobile = await session("amit@client.demo", { mobile: true });
await mobile.page.goto(approvalUrl.replace("/m/", "/c/"));
await mobile.page.waitForSelector("text=You approved revision 1");
await shot(mobile.page, "05-client-approval-mobile");

console.log("\nManager revises the approved design");
await owner.page.goto(approvalUrl);
check((await owner.page.locator("text=Approved by Amit Jain").count()) > 0, "Manager sees who approved and when");
await owner.page.click("button:has-text('Revise (creates revision 2)')");
await owner.page.waitForSelector("text=Revision 2 · draft");
await owner.page.fill("input[name=colour]", "Smoked oak");
await owner.page.click("button:has-text('Save draft')");
await owner.page.waitForSelector("text=Draft saved");
await owner.page.reload();
check((await owner.page.locator("text=Revision 1").first().count()) > 0 && (await owner.page.locator("text=American walnut").count()) > 0, "Revision 1 is kept exactly as approved");
await shot(owner.page, "06-approval-revision-history");

console.log("\nPayments");
await owner.page.goto(`${BASE}/m/projects`);
await owner.page.click("text=Amit Jain");
await owner.page.click("text=Open payments →");
await owner.page.waitForSelector("text=Payment schedule");
const row = owner.page.locator("details.milestone", { hasText: "Carpentry commencement" });
await row.locator("summary").first().click();
await row.locator("input[name=amount]").first().fill("50,000");
await row.locator("input[name=reference]").fill("UTR 4521 8890");
await row.locator("input[name=receipt]").first().setInputFiles(pdfPath);
await row.locator("input[name=publish_receipt]").check();
await row.locator("button:has-text('Record payment')").click();
await owner.page.waitForSelector("text=Payment recorded");
await owner.page.reload();
const row2 = owner.page.locator("details.milestone", { hasText: "Carpentry commencement" });
check((await row2.locator("summary").first().textContent()).includes("Partially paid"), "Milestone shows Partially paid");
check((await row2.locator("summary").first().textContent()).includes("₹1,50,000"), "Outstanding updated to ₹1,50,000");
await row2.locator("summary").first().click();
await row2.locator("input[name=amount]").first().fill("500000");
await row2.locator("button:has-text('Record payment')").click();
await owner.page.waitForSelector("text=more than the ₹1,50,000 still due");
check(true, "Over-payment is refused with a clear message");
await row2.locator("input[placeholder^='e.g. Carpentry start']").fill("Carpentry start moved after site handover");
await row2.locator("input[name=new_due_date]").fill(new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10));
await row2.locator("button:has-text('Change')").click();
await owner.page.waitForSelector("text=Due date changed");
await owner.page.reload();
await owner.page.locator("details.milestone", { hasText: "Carpentry commencement" }).locator("summary").first().click();
check((await owner.page.locator("text=Carpentry start moved after site handover").count()) > 0, "Due date change history shows the reason");
await shot(owner.page, "07-project-payments");

await owner.page.goto(`${BASE}/m/payments`);
await owner.page.click("button:has-text('Run today’s reminders now')");
await owner.page.waitForSelector(".form-ok");
check(true, `Reminders run: ${await owner.page.locator(".form-ok").textContent()}`);
await shot(owner.page, "08-payments-overview");

console.log("\nClient sees payments and notifications");
await client.page.goto(`${BASE}/c/payments`);
check((await client.page.locator("text=Download receipt").count()) > 0, "Client can download the published receipt");
check((await client.page.locator("text=Will pay").count()) === 0, "No internal notes on the client page");
await shot(client.page, "09-client-payments");
await client.page.goto(`${BASE}/c/notifications`);
check((await client.page.locator("text=Payment received: ₹50,000").count()) > 0, "Client was notified of the payment");
await shot(client.page, "10-client-notifications");
await mobile.page.goto(`${BASE}/c/payments`);
await shot(mobile.page, "11-client-payments-mobile");

const receiptHref = await client.page.goto(`${BASE}/c/payments`).then(() => client.page.locator("a:has-text('Download receipt')").getAttribute("href"));
const res = await client.page.request.get(`${BASE}${receiptHref}`);
check(res.status() === 200 && res.headers()["content-type"] === "application/pdf", "Receipt file downloads for the client");

console.log("\nPermissions in the browser");
const pm = await session("neha@meraghar.demo");
const r404 = await pm.page.goto(approvalUrl);
check(r404.status() === 404, "Another PM cannot open this approval (404)");
const fileHref = await owner.page.goto(approvalUrl).then(() => owner.page.locator("img[alt='_sample-design.jpg']").first().getAttribute("src"));
check((await pm.page.request.get(`${BASE}${fileHref}`)).status() === 404, "Another PM cannot open its design file");
const anon = await browser.newContext();
check((await anon.request.get(`${BASE}${fileHref}`)).status() === 401, "Signed-out visitors cannot open files");
const emp = await session("ganesh@meraghar.demo");
const empPay = await emp.page.goto(`${BASE}/m/payments`);
check(!emp.page.url().includes("/m/payments"), "Employees are kept out of payments");
void empPay;

await owner.page.goto(`${BASE}/m`);
await shot(owner.page, "12-management-dashboard");
await owner.page.goto(`${BASE}/m/notifications`);
await shot(owner.page, "13-management-notifications");

await browser.close();
console.log(failures ? `\n${failures} check(s) failed\n` : "\nAll browser checks passed\n");
process.exit(failures ? 1 : 0);
