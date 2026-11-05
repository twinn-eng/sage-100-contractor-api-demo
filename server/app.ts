// The backend: a thin proxy that keeps API keys on the server.
//
// The Twinn API does not answer cross-origin requests from a browser, and an API key must never be
// shipped to one, so the browser calls these routes and this process calls the API.

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Company, Config } from './config.ts'
import type { Upstream, UpstreamResponse } from './upstream.ts'

/** Entities the browser may read with `query`. */
export const QUERY_ENTITIES = new Set([
  'parts',
  'inventory-locations',
  'inventory-quantities',
  'jobs',
  'job-phases',
  'ledger-accounts',
  'ledger-subaccounts',
  'cost-codes',
  'cost-types',
  'inventory-allocations',
])

/** Entities the browser may search with `match`. Not every entity has a name to match on. */
export const MATCH_ENTITIES = new Set([
  'parts',
  'inventory-locations',
  'jobs',
  'job-phases',
  'ledger-accounts',
  'ledger-subaccounts',
  'cost-codes',
  'cost-types',
])

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/
const MAX_BODY = 256 * 1024

type Env = { Variables: { company: Company } }

function problem(c: Context, status: 400 | 404 | 413 | 502, title: string, detail: string) {
  return c.json({ type: 'about:blank', title, status, detail }, status, {
    'content-type': 'application/problem+json',
  })
}

/** Passes an upstream answer through, rewriting `Location` to this backend's own route. */
function relay(c: Context<Env>, res: UpstreamResponse) {
  const headers = new Headers()
  for (const [k, v] of Object.entries(res.headers)) headers.set(k, v)
  const loc = headers.get('location')
  const id = loc?.match(/\/requests\/([^/?#]+)/)?.[1]
  if (id) headers.set('location', `/api/${c.var.company.id}/requests/${id}`)
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers })
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text()
  if (text.length > MAX_BODY) throw new RangeError('too large')
  return text ? JSON.parse(text) : {}
}

export function createApp(config: Config, upstreamFor: (company: Company) => Upstream) {
  const app = new Hono<Env>()
  const byId = new Map(config.companies.map((co) => [co.id, co]))
  const upstreams = new Map(config.companies.map((co) => [co.id, upstreamFor(co)]))

  // A one-line access log. Never headers or bodies: they carry keys and business data.
  app.use('/api/*', async (c, next) => {
    const start = Date.now()
    await next()
    if (process.env.NODE_ENV !== 'test') {
      console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`)
    }
  })

  app.get('/api/companies', (c) =>
    c.json({
      mock: config.mock,
      data: config.companies.map(({ id, label }) => ({ id, label })),
    }),
  )

  app.use('/api/:company/*', async (c, next) => {
    const company = byId.get(c.req.param('company'))
    if (!company) return problem(c, 404, 'Unknown company', 'That company is not configured on this server.')
    c.set('company', company)
    await next()
  })

  const call = (c: Context<Env>) => upstreams.get(c.var.company.id)!

  const guarded = async (c: Context<Env>, run: () => Promise<Response>) => {
    try {
      return await run()
    } catch (err) {
      if (err instanceof SyntaxError) return problem(c, 400, 'Invalid JSON', 'The request body is not valid JSON.')
      if (err instanceof RangeError) return problem(c, 413, 'Request too large', 'The request body is too large.')
      console.error(`${c.req.method} ${c.req.path} failed: ${(err as Error).name}`)
      return problem(c, 502, 'API unreachable', 'The Twinn API could not be reached. Try again in a moment.')
    }
  }

  app.post('/api/:company/query/:entity', (c) =>
    guarded(c, async () => {
      const entity = c.req.param('entity')
      if (!QUERY_ENTITIES.has(entity)) return problem(c, 404, 'Unknown entity', `${entity} is not available here.`)
      const body = await readJson(c)
      return relay(c, await call(c)({ method: 'POST', path: `/${entity}/query`, body }))
    }),
  )

  app.post('/api/:company/match/:entity', (c) =>
    guarded(c, async () => {
      const entity = c.req.param('entity')
      if (!MATCH_ENTITIES.has(entity)) return problem(c, 404, 'Unknown entity', `${entity} cannot be searched by name.`)
      const body = await readJson(c)
      return relay(c, await call(c)({ method: 'POST', path: `/${entity}/match`, body }))
    }),
  )

  app.post('/api/:company/inventory-allocations', (c) =>
    guarded(c, async () => {
      const body = await readJson(c)
      const dryRun = c.req.query('dryRun') === 'true'
      const key = c.req.header('idempotency-key')
      const headers: Record<string, string> = {
        'idempotency-key': key && key.length <= 128 ? key : randomUUID(),
        prefer: c.req.header('prefer') ?? 'wait=25',
      }
      const query: Record<string, string> = dryRun ? { dryRun: 'true' } : {}
      return relay(c, await call(c)({ method: 'POST', path: '/inventory-allocations', query, headers, body }))
    }),
  )

  app.get('/api/:company/requests/:id', (c) =>
    guarded(c, async () => {
      const id = c.req.param('id')
      if (!REQUEST_ID.test(id)) return problem(c, 400, 'Invalid request id', 'That is not a request id.')
      const wait = c.req.query('wait')
      const query: Record<string, string> = wait && /^\d{1,2}s?$/.test(wait) ? { wait } : {}
      return relay(c, await call(c)({ method: 'GET', path: `/requests/${id}`, query }))
    }),
  )

  app.all('/api/*', (c) => problem(c, 404, 'Not found', 'No such route.'))

  return app
}
