import { defineConfig, devices } from "@playwright/test";
import fs from "fs";

const bundled = "/opt/pw-browsers/chromium";
const executablePath = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(bundled) ? fs.realpathSync(bundled) : undefined);

/**
 * End-to-end tests against a running server (npm run build && npm start).
 * Requires E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD for an account created with `npm run staff:create`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: executablePath ? { executablePath } : undefined,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
