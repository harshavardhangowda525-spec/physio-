import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

function inDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function sendText(page: Page, text: string) {
  const field = page.locator(".composer input, .composer textarea").first();
  await expect(field).toBeEnabled();
  await field.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

const chips = (page: Page) => page.getByRole("group", { name: "Suggested replies" });

test("patient submits a home-visit request end to end, staff confirm it in the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Welcome to Physiotherapy Treatment at Home")).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, "01-landing");

  await chips(page).getByRole("button", { name: "Request a home physiotherapy appointment" }).click();
  await expect(page.getByText("What is the patient's full name?")).toBeVisible();
  await sendText(page, "Priya Sharma");
  await sendText(page, "12345");
  await expect(page.getByText(/10-digit Indian phone number/).last()).toBeVisible();
  await sendText(page, "98765 43210");
  await sendText(page, inDays(4));
  await expect(page.getByText(/preference only/)).toBeVisible();
  await chips(page).getByRole("button", { name: /Evening/ }).click();
  await sendText(page, "Jayanagar 4th Block");
  await expect(page.getByText(/Step 6 of 9/)).toBeVisible();
  await shot(page, "02-mid-flow");
  await sendText(page, "Knee pain while climbing stairs, two weeks now");
  await chips(page).getByRole("button", { name: "Female physiotherapist" }).click();
  await expect(page.getByText("Your consent")).toBeVisible();
  await chips(page).getByRole("button", { name: "I agree" }).click();
  await expect(page.getByText("Please check your request")).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "03-summary");

  await chips(page).getByRole("button", { name: "Submit request" }).click();
  const success = page.locator(".card--success");
  await expect(success).toContainText("This is a request, not a confirmed booking.");
  const ref = (await success.locator(".ref-value").innerText()).trim();
  expect(ref).toMatch(/^PTH-\d{6}-[A-Z2-9]{4}$/);
  await page.waitForTimeout(600);
  await shot(page, "04-success");

  // Staff side
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/login$/);
  await shot(page, "05-login");
  await page.getByLabel("Email").fill(process.env.E2E_STAFF_EMAIL ?? "");
  await page.getByLabel("Password").fill(process.env.E2E_STAFF_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Appointment requests" })).toBeVisible();
  await page.getByLabel(/Search name/).fill(ref);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: "Priya Sharma" })).toBeVisible();
  await page.getByLabel(/Search name/).fill("");
  await page.getByRole("button", { name: "Apply" }).click();
  await shot(page, "06-dashboard");

  await page.getByRole("link", { name: "Priya Sharma" }).first().click();
  await expect(page.getByText("Not confirmed.")).toBeVisible();
  await page.getByLabel("Add a note (staff only)").fill("Called patient, agreed 5 pm visit.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Called patient, agreed 5 pm visit.")).toBeVisible();
  await page.getByLabel("Status").selectOption("CONFIRMED");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".page-head .pill")).toHaveText("Confirmed");
  await shot(page, "07-detail");

  // Patient checks status: now confirmed by staff
  await page.goto("/");
  await chips(page).getByRole("button", { name: "Check appointment-request status" }).click();
  await sendText(page, ref);
  await sendText(page, "9876543210");
  await expect(page.locator(".card--info").last()).toContainText("Confirmed by the clinic team");
});

test("urgent symptoms get emergency guidance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Welcome to Physiotherapy")).toBeVisible();
  await sendText(page, "My mother has chest pain and trouble breathing");
  await expect(page.locator(".card--urgent")).toContainText("112");
  await expect(chips(page).getByRole("link", { name: "Call 112" })).toHaveAttribute("href", "tel:112");
  await page.waitForTimeout(400);
  await shot(page, "08-urgent");
});

test("the embeddable widget opens the chat on a host website", async ({ page }) => {
  test.skip(!process.env.E2E_HOST_PAGE, "Set E2E_HOST_PAGE to a page that includes widget.js");
  await page.goto(process.env.E2E_HOST_PAGE!);
  await page.getByRole("button", { name: "Book a home visit" }).click();
  const frame = page.frameLocator("iframe[title='Appointment assistant']");
  await expect(frame.getByText("Welcome to Physiotherapy Treatment at Home")).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "09-widget-on-host");
});

test("dashboard pages are not reachable without signing in", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const p of ["/dashboard", "/dashboard/settings", "/dashboard/notifications"]) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/dashboard\/login$/);
  }
  const res = await page.request.get("/api/staff/export");
  expect(res.status()).toBe(401);
  await ctx.close();
});
