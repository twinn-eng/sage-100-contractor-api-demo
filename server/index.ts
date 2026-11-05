import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { mockUpstream } from './mock/mock-upstream.ts'
import { httpUpstream } from './upstream.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const config = loadConfig()
const app = createApp(config, (company) =>
  config.mock ? mockUpstream({ async: process.env.MOCK_ASYNC === '1' }) : httpUpstream(company),
)

// `npm start` serves the built app from the same port; in development Vite serves it.
if (process.env.NODE_ENV === 'production' && existsSync('dist')) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  const names = config.companies.map((c) => c.id).join(', ')
  console.log(`API proxy on http://localhost:${port} (${config.mock ? 'mock data' : 'live'}; companies: ${names})`)
})
