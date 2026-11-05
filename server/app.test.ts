// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { loadConfig, type Config } from './config.ts'
import { mockUpstream } from './mock/mock-upstream.ts'
import type { Upstream, UpstreamResponse } from './upstream.ts'

const KEY = 'opdc_v3_dev_test_secret_value'
const config: Config = { mock: false, port: 0, companies: [{ id: 'acme', label: 'Acme', baseUrl: 'https://demo.twinn.engineering/api/v3', apiKey: KEY }] }

function recordingApp(answer: UpstreamResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: '{"data":[]}' }) {
  const upstream = vi.fn<Upstream>(async () => answer)
  return { app: createApp(config, () => upstream), upstream }
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', body: JSON.stringify(body), headers })

describe('backend proxy', () => {
  it('lists companies without their keys or URLs', async () => {
    const { app } = recordingApp()
    const text = await (await app.request('/api/companies')).text()
    expect(JSON.parse(text)).toEqual({ mock: false, data: [{ id: 'acme', label: 'Acme' }] })
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('twinn.engineering')
  })

  it('refuses a company that is not configured, and entities outside the allowlist', async () => {
    const { app, upstream } = recordingApp()
    expect((await app.request('/api/other/query/parts', post({}))).status).toBe(404)
    expect((await app.request('/api/acme/query/employees', post({}))).status).toBe(404)
    expect((await app.request('/api/acme/match/inventory-quantities', post({}))).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('forwards an allowed query', async () => {
    const { app, upstream } = recordingApp()
    const res = await app.request('/api/acme/query/parts', post({ page: { pageNumber: 2, pageSize: 25 } }))
    expect(res.status).toBe(200)
    expect(upstream).toHaveBeenCalledWith({ method: 'POST', path: '/parts/query', body: { page: { pageNumber: 2, pageSize: 25 } } })
  })

  it('adds an Idempotency-Key when the browser sends none, keeps one it does, and passes dryRun', async () => {
    const { app, upstream } = recordingApp()
    await app.request('/api/acme/inventory-allocations?dryRun=true', post({ lines: [] }))
    const first = upstream.mock.calls[0][0]
    expect(first.query).toEqual({ dryRun: 'true' })
    expect(first.headers!['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.headers!.prefer).toBe('wait=25')
    await app.request('/api/acme/inventory-allocations', post({ lines: [] }, { 'idempotency-key': 'mine', prefer: 'wait=5' }))
    expect(upstream.mock.calls[1][0]).toMatchObject({ query: {}, headers: { 'idempotency-key': 'mine', prefer: 'wait=5' } })
  })

  it('rewrites a 202 Location to its own requests route', async () => {
    const { app, upstream } = recordingApp({
      status: 202,
      headers: { 'content-type': 'application/json', location: '/api/v3/requests/abc-123', 'opdc-request-id': 'abc-123' },
      body: '{"requestId":"abc-123","state":"pending"}',
    })
    const res = await app.request('/api/acme/inventory-allocations', post({}))
    expect(res.status).toBe(202)
    expect(res.headers.get('location')).toBe('/api/acme/requests/abc-123')
    await app.request('/api/acme/requests/abc-123?wait=25')
    expect(upstream).toHaveBeenLastCalledWith({ method: 'GET', path: '/requests/abc-123', query: { wait: '25' } })
  })

  it('answers bad JSON with a problem, without calling the API', async () => {
    const { app, upstream } = recordingApp()
    const res = await app.request('/api/acme/query/parts', { method: 'POST', body: '{nope' })
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('configuration', () => {
  it('reads companies from JSON or numbered variables, and refuses placeholder keys', () => {
    const c = loadConfig({
      COMPANIES: JSON.stringify([{ id: 'demo', label: 'Demo', baseUrl: 'https://demo.twinn.engineering/api/v3/', apiKey: 'k1' }]),
      COMPANY_1_ID: 'mine',
      COMPANY_1_BASE_URL: 'https://dashboard.twinn.engineering/api/v3',
      COMPANY_1_API_KEY: 'k2',
    })
    expect(c.companies.map((x) => [x.id, x.baseUrl])).toEqual([
      ['demo', 'https://demo.twinn.engineering/api/v3'],
      ['mine', 'https://dashboard.twinn.engineering/api/v3'],
    ])
    expect(() => loadConfig({ COMPANY_1_ID: 'x', COMPANY_1_BASE_URL: 'https://demo.twinn.engineering/api/v3', COMPANY_1_API_KEY: 'opdc_v3_dev_xxxxxxxxxxxxxxxx_x' })).toThrow(/no API key/)
    expect(() => loadConfig({})).toThrow(/No companies configured/)
    expect(loadConfig({ MOCK: '1' }).companies[0].id).toBe('demo')
  })
})

describe('mock mode', () => {
  const app = createApp({ mock: true, port: 0, companies: [{ id: 'demo', label: 'Demo', baseUrl: 'mock:', apiKey: '' }] }, () => mockUpstream({ latencyMs: 0 }))
  const allocation = (quantity: string) => ({
    ticketNumber: 'T-1',
    description: 'Test',
    transactionDate: '2026-11-05',
    purpose: 'JOB_REQUISITION',
    jobNumber: 2401,
    status: 4,
    lines: [{ partNumber: 1001, quantity, sourceLocation: 1, debitAccount: 5110, costCode: '15.100', costType: 1 }],
  })

  it('simulates a successful write, with job cost, inventory and a balanced journal', async () => {
    const res = await app.request('/api/demo/inventory-allocations', post(allocation('6'), { 'idempotency-key': 'k-1' }))
    expect(res.status).toBe(200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await res.json()
    expect(r.document.lines[0]).toMatchObject({ cost: '1.8600', total: '11.16' })
    expect(r.jobCosts[0]).toMatchObject({ jobNumber: 2401, costAmount: '11.16' })
    expect(r.inventory[0]).toMatchObject({ quantityOnHandDelta: '-6.0000' })
    expect(r.ledgerTransaction.lines.map((l: { debitAmount: string; creditAmount: string }) => [l.debitAmount, l.creditAmount])).toEqual([
      ['11.16', '0.00'],
      ['0.00', '11.16'],
    ])
    const replay = await app.request('/api/demo/inventory-allocations', post(allocation('6'), { 'idempotency-key': 'k-1' }))
    expect(replay.headers.get('idempotency-status')).toBe('replayed')
  })

  it('simulates INSUFFICIENT_INVENTORY', async () => {
    const res = await app.request('/api/demo/inventory-allocations', post(allocation('500')))
    expect(res.status).toBe(422)
    expect(res.headers.get('x-error-code')).toBe('INSUFFICIENT_INVENTORY')
    expect(((await res.json()) as { errors: unknown }).errors).toEqual([{ field: 'lines[0].quantity', code: 'INSUFFICIENT_INVENTORY' }])
  })
})
