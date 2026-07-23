/* eslint-disable @import/no-default-export -- Playwright requires a default export from config modules. */
import { defineConfig } from '@playwright/test'

/** Playwright config for the ActionMenu-style dialog fixture (standalone page). */
export default defineConfig({
  testDir: './libraries/react/testing/playwright',
  testMatch: 'create-editor-dialog.pw.ts',
  use: {
    baseURL: 'http://localhost:3001',
  },
  webServer: {
    command: 'PORT=3001 bun ./libraries/react/testing/playwright/fixture.html',
    port: 3001,
    reuseExistingServer: !process.env.CI,
  },
})
