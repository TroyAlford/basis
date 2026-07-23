/* eslint-disable @import/no-default-export -- Playwright requires a default export from config modules. */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  testDir: './libraries/react/testing/playwright',
  testMatch: 'dialog-keyboard.pw.ts',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'bun ./libraries/docs/index.html',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
})
