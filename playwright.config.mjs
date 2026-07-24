import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  outputDir: "test-results",
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/static-server.mjs",
    url: "http://127.0.0.1:4173/tests/fixtures/widget.html",
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
