import { describe, expect, it, vi } from 'vitest'
import { ApiError, createClient } from './client'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const result = { document: { id: 'a', recordNumber: 5016, status: 4, purpose: 'OTHER', lines: [] }, jobCosts: [], inventory: [], dryRun: false, period: 11, year: 2026 }
const body = { transactionDate: '2026-11-05', purpose: 'OTHER' as const, lines: [] }

describe('postAllocation', () => {
  it('sends the key, the wait preference and dryRun', async () => {
    const fetch = vi.fn(async () => json(200, { ...result, dryRun: true }))
    await createClient('demo', fetch).postAllocation(body, { dryRun: true, idempotencyKey: 'k-1' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/demo/inventory-allocations?dryRun=true',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'idempotency-key': 'k-1', prefer: 'wait=25' }) }),
    )
  })

  it('follows a 202 to its Location until the request has an outcome', async () => {
    const pending = () => json(202, { requestId: 'r-1', state: 'pending' }, { location: '/api/demo/requests/r-1', 'opdc-request-id': 'r-1' })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(json(200, result, { 'idempotency-status': 'applied' }))
    const onPending = vi.fn()
    const out = await createClient('demo', fetch).postAllocation(body, { dryRun: false, idempotencyKey: 'k', onPending })
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/demo/inventory-allocations',
      '/api/demo/requests/r-1?wait=25',
      '/api/demo/requests/r-1?wait=25',
    ])
    expect(onPending).toHaveBeenCalledWith('r-1')
    expect(out).toMatchObject({ requestId: 'r-1', idempotencyStatus: 'applied', result: { document: { recordNumber: 5016 } } })
  })

  it('throws the problem when the outcome is a failure', async () => {
    const fetch = vi.fn(async () =>
      json(422, { type: 'https://twinn.engineering/errors/period-closed', title: 'Posting period is closed', status: 422 }, { 'x-error-code': 'PERIOD_CLOSED' }),
    )
    const err = await createClient('demo', fetch).postAllocation(body, { dryRun: false, idempotencyKey: 'k' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'PERIOD_CLOSED' })
  })
})
