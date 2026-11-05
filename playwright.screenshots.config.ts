import { defineConfig, devices } from '@playwright/test'
import { webServer } from './playwright.config.ts'

const WEB_PORT = process.env.E2E_WEB_PORT ?? '5191'

// `npm run screenshots`: writes the README images to docs/screenshots/.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'screenshots.spec.ts',
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  webServer,
})
