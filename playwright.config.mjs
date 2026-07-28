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
    // The fixture server serves from its own working directory, so a leftover
    // one from another checkout answers on this port and the suite silently
    // tests that tree instead of this one. Reuse is a local convenience only.
    reuseExistingServer: !process.env.CI,
  },
});
