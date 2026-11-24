// End-to-end check of Release 1 in a real browser + screenshots.
// Usage: node scripts/e2e.mjs  (app must be running on :3000)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`); if (!cond) failures++; };

async function session(email, { mobile = false } = {}) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", process.env.PW ?? "Demo@1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button:has-text('Sign in')")]);
  return { ctx, page };
}
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });

console.log("\nLogin");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await shot(page, "01-login", false);
  await page.fill("#email", "amit@client.demo");
  await page.fill("#password", "wrong-password");
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector("p[role=alert]");
  check((await page.textContent("p[role=alert]")).includes("incorrect"), "Wrong password is refused");
  await ctx.close();
}

console.log("\nManagement (owner)");
const owner = await session("rahul@meraghar.demo");
check(owner.page.url().endsWith("/m"), "Owner lands on the management dashboard");
await owner.page.waitForSelector("text=Priority action centre");
await shot(owner.page, "02-management-dashboard");
await owner.page.goto(`${BASE}/m/projects`);
check((await owner.page.locator("tbody tr").count()) === 3, "Owner sees all 3 projects");
await shot(owner.page, "03-projects-list", false);

// Create a project with a brand-new client through the real form
await owner.page.goto(`${BASE}/m/projects/new`);
await owner.page.fill("input[name=client_name]", "Sameer Kulkarni");
await owner.page.fill("input[name=client_email]", `sameer.${Date.now()}@client.demo`);
await owner.page.fill("input[name=client_phone]", "+91 99230 44444");
await owner.page.fill("input[name=name]", "Sameer Kulkarni – 3BHK, Aundh");
await owner.page.fill("input[name=building_society]", "Rohan Abhilasha");
await owner.page.fill("input[name=flat_number]", "C-503");
await owner.page.selectOption("select[name=property_config]", "3 BHK");
await owner.page.fill("input[name=carpet_area_sqft]", "1180");
await owner.page.fill("input[name=expected_start_date]", "2026-12-05");
await owner.page.fill("input[name=target_handover_date]", "2027-03-31");
await owner.page.selectOption("select[name=project_manager_id]", { label: "Neha Joshi · Project Manager" });
await owner.page.selectOption("select[name=designer_id]", { label: "Pooja Patil" });
await owner.page.check("label:has-text('Ganesh More') input");
await owner.page.check("input[name=scope_included_5]"); // Kitchen
await owner.page.fill("input[name=scope_description_5]", "U-shaped kitchen, acrylic shutters");
await owner.page.fill("input[name=scope_cost_5]", "385000");
await owner.page.check("input[name=scope_included_6]"); // Wardrobes
await owner.page.fill("input[name=scope_cost_6]", "290000");
await shot(owner.page, "04-new-project-form");
await owner.page.click("button:has-text('Create project')");
await owner.page.waitForSelector("text=Temporary password");
const newEmail = (await owner.page.locator("dd").nth(0).textContent()).trim();
const newPw = (await owner.page.locator("dd").nth(1).textContent()).trim();
check(newPw.length > 8, "Project created and client login generated");
await shot(owner.page, "05-project-created", false);
await owner.page.click("text=Open project");
await owner.page.waitForSelector("text=Project profile");
check(await owner.page.isVisible("text=₹6,75,000"), "Scope estimated total shown to management (₹6,75,000)");
check(/MG-\d{6}/.test(await owner.page.textContent("body")), "Project code generated automatically");
await shot(owner.page, "06-project-detail");
await owner.page.goto(`${BASE}/m/team`);
await shot(owner.page, "07-team", false);

console.log("\nNew client logs in");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", newEmail);
  await page.fill("#password", newPw);
  await Promise.all([page.waitForURL((u) => u.pathname === "/c"), page.click("button:has-text('Sign in')")]);
  check(await page.isVisible("text=Sameer Kulkarni"), "New client sees their own new project");
  check(!(await page.textContent("body")).includes("Amit"), "New client sees nothing of other clients");
  await ctx.close();
}

console.log("\nClient (Amit)");
const amit = await session("amit@client.demo");
check(amit.page.url().endsWith("/c"), "Client lands on the client portal");
await shot(amit.page, "08-client-home");
await amit.page.goto(`${BASE}/c/project`);
await shot(amit.page, "09-client-project");
check(!(await amit.page.textContent("body")).includes("₹3,20,000"), "Client never sees estimated costs");
await amit.page.goto(`${BASE}/m`);
check(amit.page.url().endsWith("/c"), "Client typing a management URL is sent back to their portal");
const amitMobile = await session("amit@client.demo", { mobile: true });
await shot(amitMobile.page, "10-client-home-mobile");

console.log("\nEmployee (Ganesh, carpentry lead)");
const ganesh = await session("ganesh@meraghar.demo");
check(ganesh.page.url().endsWith("/e"), "Employee lands on the employee dashboard");
await shot(ganesh.page, "11-employee-dashboard");
// Try to open a project he isn't on (Rohan's villa) by ID
const rohanId = await owner.page.evaluate(async () => {
  const html = await (await fetch("/m/projects?q=Wagholi")).text();
  return html.match(/\/m\/projects\/([0-9a-f-]{36})/)[1];
});
const res = await ganesh.page.goto(`${BASE}/e/projects/${rohanId}`);
check(res.status() === 404, "Employee cannot open an unassigned project by changing the URL");
// Update a task status
await ganesh.page.goto(`${BASE}/e/tasks`);
const sel = ganesh.page.locator("select[name=status]").first();
await sel.selectOption("in_progress");
await ganesh.page.waitForTimeout(1200);
await ganesh.page.reload();
check((await ganesh.page.locator("select[name=status]").first().inputValue()) === "in_progress", "Employee task status update is saved");
const ganeshMobile = await session("ganesh@meraghar.demo", { mobile: true });
await shot(ganeshMobile.page, "12-employee-mobile");

console.log("\nProject manager (Neha)");
const neha = await session("neha@meraghar.demo");
await neha.page.goto(`${BASE}/m/projects`);
const nehaRows = await neha.page.locator("tbody tr").count();
check(nehaRows === 2, `PM sees only her projects (${nehaRows}: Kavita + the new Sameer project)`);
const ownerMobile = await session("rahul@meraghar.demo", { mobile: true });
await shot(ownerMobile.page, "13-management-mobile");

await browser.close();
console.log(failures ? `\n${failures} check(s) failed\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
