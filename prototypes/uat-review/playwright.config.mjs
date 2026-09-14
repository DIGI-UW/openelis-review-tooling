import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const prototypeRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: prototypeRoot,
  testMatch: "validation.spec.mjs",
  outputDir: new URL("../../test-results/uat-prototype/", import.meta.url)
    .pathname,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: new URL(
          "../../playwright-report/uat-prototype/",
          import.meta.url,
        ).pathname,
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4189",
    viewport: { width: 1440, height: 1000 },
    video: "on",
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node serve.mjs",
    cwd: prototypeRoot,
    url: "http://127.0.0.1:4189/",
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
