import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

// Runs against the mock backend (MOCK=1) so no API key is needed.
const API_PORT = process.env.E2E_API_PORT ?? '8791'
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5191'

export const webServer: PlaywrightTestConfig['webServer'] = [
  {
    command: 'tsx server/index.ts',
    env: { MOCK: '1', PORT: API_PORT, NODE_ENV: 'test' } as Record<string, string>,
    url: `http://localhost:${API_PORT}/api/companies`,
    reuseExistingServer: false,
  },
  {
    command: 'vite',
    env: { API_PORT, WEB_PORT } as Record<string, string>,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: false,
  },
]

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'screenshots.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer,
})
