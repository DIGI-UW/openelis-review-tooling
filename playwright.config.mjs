import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/widget",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4177",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/widget/server.mjs",
    port: 4177,
    reuseExistingServer: true,
  },
});
