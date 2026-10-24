import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.PAPERLAB_TEST_URL || "http://127.0.0.1:8001",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PAPERLAB_BROWSER ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      args: ["--disable-extensions"],
    },
  },
  reporter: [["list"], ["json", { outputFile: "../docs/e2e-results.json" }]],
});
