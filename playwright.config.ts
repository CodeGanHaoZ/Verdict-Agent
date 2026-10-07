import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/start-backend.mjs",
      url: "http://127.0.0.1:3102/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npm run dev --workspace @verdict/web -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        VITE_PRIMARY_API: "http://127.0.0.1:3101",
        VITE_SECONDARY_API: "http://127.0.0.1:3102",
      },
    },
  ],
});
