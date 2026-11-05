// MOCK=1: answers the same routes as the Twinn API from local fixtures, so the app runs and can be
// screenshotted without a key. The data is fictional. Writes are kept in memory until the process
// stops, and the rules below are a small, simplified subset of what the real API checks.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Upstream, UpstreamResponse } from '../upstream.ts'
import { match, query, type MatchBody, type QueryBody } from './query.ts'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

interface LineIn {
  partNumber?: number
  partDescription?: string
  unitDescription?: string
  quantity?: string
  cost?: string
  total?: string
  sourceLocation?: number
  destinationLocation?: number
  debitAccount?: number
  debitSubAccount?: number
  costCode?: string
  costType?: number
}

interface AllocationIn {
  ticketNumber?: string
  orderNumber?: string
  jobNumber?: number
  phaseNumber?: number
  transactionDate?: string
  status?: number
  description?: string
  purpose?: string
  deliveryVia?: string
  lines?: LineIn[]
}

interface FieldError {
  field: string
  code: string
}

const INVENTORY_ACCOUNT = 1310
const JOB_COST_ACCOUNTS = new Set([5110, 5120, 1290])

const json = (status: number, body: unknown, headers: Record<string, string> = {}): UpstreamResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

function problemResponse(status: number, code: string, title: string, detail: string, errors: FieldError[] = []) {
  return json(
    status,
    {
      type: `https://twinn.engineering/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      detail,
      ...(errors.length ? { errors } : {}),
      correlationId: randomUUID().slice(0, 8),
    },
    { 'content-type': 'application/problem+json', 'x-error-code': code },
  )
}

const dec = (v: unknown) => Number(v ?? 0)
const cents = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const qty = (n: number) => n.toFixed(4)

function isoDate(offsetDays: number) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function loadTables(): Tables {
  const raw = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as Tables
  for (const a of raw['inventory-allocations']) {
    const date = String(a.transactionDate)
    if (date.startsWith('RELATIVE:')) a.transactionDate = isoDate(Number(date.slice(9)))
    const d = new Date(String(a.transactionDate))
    a.period = d.getMonth() + 1
    a.year = d.getFullYear()
  }
  return raw
}

export function mockUpstream(options: { async?: boolean; latencyMs?: number } = {}): Upstream {
  const t = loadTables()
  const idempotent = new Map<string, UpstreamResponse>()
  const requests = new Map<string, UpstreamResponse>()
  const latency = options.latencyMs ?? 120

  const find = (table: string, pred: (r: Row) => boolean) => t[table].find(pred)
  const available = (part: number, loc: number) =>
    dec(find('inventory-quantities', (q) => q.partRecordNumber === part && q.locationNumber === loc)?.quantityAvailable)

  function validate(body: AllocationIn): UpstreamResponse | null {
    const errors: FieldError[] = []
    const need = (ok: unknown, field: string) => {
      if (ok === undefined || ok === null || (typeof ok === 'string' && ok.trim() === '')) errors.push({ field, code: 'FIELD_REQUIRED' })
    }
    need(body.ticketNumber, 'ticketNumber')
    need(body.description, 'description')
    need(body.transactionDate, 'transactionDate')
    need(body.purpose, 'purpose')
    if (body.purpose === 'JOB_REQUISITION') need(body.jobNumber, 'jobNumber')
    if (!body.lines?.length) errors.push({ field: 'lines', code: 'FIELD_REQUIRED' })
    const status = body.status ?? 1
    body.lines?.forEach((l, i) => {
      const at = `lines[${i}]`
      need(l.partNumber, `${at}.partNumber`)
      if (!(dec(l.quantity) > 0)) errors.push({ field: `${at}.quantity`, code: 'FIELD_INVALID' })
      if (!l.sourceLocation && !l.destinationLocation) errors.push({ field: `${at}.sourceLocation`, code: 'FIELD_REQUIRED' })
      const transfer = l.sourceLocation && l.destinationLocation
      if (!transfer) need(l.debitAccount, `${at}.debitAccount`)
      if (!l.sourceLocation && l.destinationLocation) need(l.cost, `${at}.cost`)
      if (status === 4 && body.purpose === 'JOB_REQUISITION' && !transfer) {
        need(l.costCode, `${at}.costCode`)
        need(l.costType, `${at}.costType`)
      }
      if (status === 4 && !transfer && JOB_COST_ACCOUNTS.has(Number(l.debitAccount)) && !body.jobNumber) {
        errors.push({ field: 'jobNumber', code: 'FIELD_REQUIRED' })
      }
    })
    if (errors.length) {
      const required = errors.every((e) => e.code === 'FIELD_REQUIRED')
      return problemResponse(
        400,
        required ? 'FIELD_REQUIRED' : 'FIELD_INVALID',
        required ? 'A required field is missing' : 'A field is invalid',
        errors.map((e) => `${e.field}: ${e.code === 'FIELD_REQUIRED' ? 'required' : 'invalid'}`).join('; '),
        errors,
      )
    }
    for (const [i, l] of body.lines!.entries()) {
      if (!find('parts', (p) => p.recordNumber === l.partNumber)) {
        return problemResponse(404, 'RECORD_NOT_FOUND', 'Record not found', `part ${l.partNumber} does not exist`, [
          { field: `lines[${i}].partNumber`, code: 'RECORD_NOT_FOUND' },
        ])
      }
    }
    if (status === 3 || status === 4) {
      const asked = new Map<string, { part: number; loc: number; qty: number; idx: number[] }>()
      body.lines!.forEach((l, i) => {
        if (!l.sourceLocation) return
        const k = `${l.partNumber}@${l.sourceLocation}`
        const e = asked.get(k) ?? { part: l.partNumber!, loc: l.sourceLocation, qty: 0, idx: [] }
        e.qty += dec(l.quantity)
        e.idx.push(i)
        asked.set(k, e)
      })
      const short = [...asked.values()].filter((e) => e.qty > available(e.part, e.loc))
      if (short.length) {
        return problemResponse(
          422,
          'INSUFFICIENT_INVENTORY',
          'Not enough inventory',
          short
            .map((e) => `part ${e.part} at location ${e.loc}: ${e.qty} requested, ${available(e.part, e.loc)} available`)
            .join('; '),
          short.flatMap((e) => e.idx.map((i) => ({ field: `lines[${i}].quantity`, code: 'INSUFFICIENT_INVENTORY' }))),
        )
      }
    }
    return null
  }

  function post(body: AllocationIn, dryRun: boolean): UpstreamResponse {
    const invalid = validate(body)
    if (invalid) return invalid
    const status = body.status ?? 1
    const purpose = body.purpose!
    const date = new Date(body.transactionDate!)
    const period = date.getMonth() + 1
    const year = date.getFullYear()
    const recordNumber = Math.max(...t['inventory-allocations'].map((a) => Number(a.recordNumber))) + 1
    const id = randomUUID()

    const lines = body.lines!.map((l, i) => {
      const part = find('parts', (p) => p.recordNumber === l.partNumber)!
      const isReturn = !l.sourceLocation
      const cost = isReturn ? dec(l.cost) : dec(part.averageCost)
      return {
        input: l,
        part,
        result: {
          id: randomUUID(),
          recordNumber,
          lineNumber: i + 1,
          partRecordNumber: l.partNumber!,
          partDescription: l.partDescription || String(part.partName),
          quantity: qty(dec(l.quantity)),
          cost: cost.toFixed(4),
          total: cents(dec(l.quantity) * cost),
          sourceLocation: l.sourceLocation ?? 0,
          ...(l.destinationLocation ? { destinationLocation: l.destinationLocation } : {}),
        },
      }
    })

    const inventory: Row[] = []
    if (status === 3 || status === 4) {
      for (const { input, result } of lines) {
        const q = dec(input.quantity)
        if (input.sourceLocation) {
          inventory.push({
            partNumber: input.partNumber,
            location: input.sourceLocation,
            quantityAvailableDelta: qty(-q),
            quantityOnHandDelta: qty(status === 4 ? -q : 0),
            ...(status === 4 ? { historyRecordNumber: 90000 + recordNumber * 10 + result.lineNumber } : {}),
          })
        }
        if (input.destinationLocation && status === 4) {
          inventory.push({
            partNumber: input.partNumber,
            location: input.destinationLocation,
            quantityAvailableDelta: qty(q),
            quantityOnHandDelta: qty(q),
          })
        }
      }
    }

    const jobCosts: Row[] = []
    if (status === 4 && purpose === 'JOB_REQUISITION' && body.jobNumber) {
      const groups = new Map<string, Row>()
      for (const { input, result } of lines) {
        if (input.sourceLocation && input.destinationLocation) continue
        const k = `${input.costCode}/${input.costType}`
        const g = groups.get(k) ?? {
          id: randomUUID(),
          recordNumber: 70000 + recordNumber * 10 + groups.size + 1,
          jobNumber: body.jobNumber,
          phaseNumber: body.phaseNumber ?? 0,
          costCode: input.costCode,
          costType: input.costType,
          costAmount: '0.00',
          billingAmount: '0.00',
        }
        const sign = input.sourceLocation ? 1 : -1
        g.costAmount = cents(dec(g.costAmount) + sign * dec(result.total))
        g.billingAmount = g.costAmount
        groups.set(k, g)
      }
      jobCosts.push(...groups.values())
    }

    let ledgerTransaction: Row | undefined
    if (status === 4) {
      const gl: Row[] = []
      let n = 0
      const add = (account: number, sub: number | undefined, debit: number, credit: number, description: string) =>
        gl.push({
          id: randomUUID(),
          recordNumber: 60000 + recordNumber,
          lineNumber: ++n,
          description,
          ledgerAccount: account,
          ...(sub ? { subAccount: sub } : {}),
          debitAmount: cents(debit),
          creditAmount: cents(credit),
        })
      for (const { input, result, part } of lines) {
        if (input.sourceLocation && input.destinationLocation) continue
        const amount = dec(result.total)
        const label = String(part.partName)
        if (input.sourceLocation) {
          add(input.debitAccount!, input.debitSubAccount, amount, 0, label)
          add(INVENTORY_ACCOUNT, undefined, 0, amount, label)
        } else {
          add(INVENTORY_ACCOUNT, undefined, amount, 0, label)
          add(input.debitAccount!, input.debitSubAccount, 0, amount, label)
        }
      }
      if (gl.length) {
        ledgerTransaction = {
          id: randomUUID(),
          recordNumber: 60000 + recordNumber,
          ledgerRecord: 880000 + recordNumber,
          transactionNumber: body.ticketNumber,
          status: 1,
          sourceNumber: 9,
          lines: gl,
        }
      }
    }

    const result = {
      document: { id, recordNumber, status, purpose, lines: lines.map((l) => l.result) },
      ...(ledgerTransaction ? { ledgerTransaction } : {}),
      jobCosts,
      inventory,
      dryRun,
      period,
      year,
    }

    if (!dryRun) {
      for (const m of inventory) {
        let row = find('inventory-quantities', (q) => q.partRecordNumber === m.partNumber && q.locationNumber === m.location)
        if (!row) {
          row = { id: randomUUID(), partRecordNumber: m.partNumber, locationNumber: m.location, quantityOnHand: qty(0), quantityAvailable: qty(0) }
          t['inventory-quantities'].push(row)
        }
        row.quantityAvailable = qty(dec(row.quantityAvailable) + dec(m.quantityAvailableDelta))
        row.quantityOnHand = qty(dec(row.quantityOnHand) + dec(m.quantityOnHandDelta))
      }
      t['inventory-allocations'].push({
        id,
        recordNumber,
        transactionNumber: body.ticketNumber,
        jobNumber: body.jobNumber ?? 0,
        phaseNumber: body.phaseNumber ?? 0,
        status,
        costOrder: body.orderNumber ?? '',
        transactionDate: body.transactionDate,
        description: body.description,
        deliveryMethod: body.deliveryVia ?? '',
        period,
        year,
        createdAt: new Date().toISOString(),
        lines: lines.map(({ input, part, result: r }) => ({
          id: r.id,
          recordNumber,
          idRef: id,
          lineNumber: r.lineNumber,
          partRecordNumber: r.partRecordNumber,
          partDescription: r.partDescription,
          alphaNumber: part.partCode,
          unitDescription: input.unitDescription || part.partUnit,
          inventoryQuantity: r.quantity,
          inventoryCost: r.cost,
          inventoryTotal: r.total,
          sourceLocation: input.sourceLocation ?? 0,
          destinationLocation: input.destinationLocation ?? 0,
          debitAccount: input.debitAccount ?? 0,
          debitSubAccount: input.debitSubAccount ?? 0,
        })),
      })
    }
    return json(200, result, dryRun ? {} : { 'idempotency-status': 'applied' })
  }

  return async (req) => {
    if (latency) await new Promise((r) => setTimeout(r, latency))
    const body = (req.body ?? {}) as Row
    const m = req.path.match(/^\/([a-z-]+)\/(query|match)$/)
    if (req.method === 'POST' && m) {
      const rows = t[m[1]]
      if (!rows) return problemResponse(404, 'RECORD_NOT_FOUND', 'Unknown entity', `${m[1]} is not an entity`)
      if (m[2] === 'query') return json(200, query(rows, body as QueryBody))
      const mb = body as unknown as MatchBody
      if (!mb.matchString || !mb.maxDistance || !mb.select?.length || !mb.matchFields?.length) {
        return problemResponse(400, 'REQUEST_INVALID', 'Invalid match request', 'select, matchFields, matchString and maxDistance are required')
      }
      return json(200, match(rows, mb))
    }
    if (req.method === 'POST' && req.path === '/inventory-allocations') {
      const dryRun = req.query?.dryRun === 'true'
      const key = req.headers?.['idempotency-key']
      const fingerprint = `${key}|${JSON.stringify(body)}`
      if (!dryRun && key) {
        const prior = idempotent.get(key)
        if (prior) {
          if (prior.headers['x-fingerprint'] !== fingerprint) {
            return problemResponse(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused', 'this key was used for a different request; use a new key')
          }
          const { 'x-fingerprint': _, ...headers } = prior.headers
          return { ...prior, headers: { ...headers, 'idempotency-status': 'replayed' } }
        }
      }
      const res = post(body as AllocationIn, dryRun)
      if (!dryRun && key && res.status !== 400) idempotent.set(key, { ...res, headers: { ...res.headers, 'x-fingerprint': fingerprint } })
      const wantsAsync = options.async || /respond-async/.test(req.headers?.prefer ?? '')
      if (wantsAsync) {
        const requestId = randomUUID()
        requests.set(requestId, res)
        return json(
          202,
          { requestId, state: 'pending', receivedAt: new Date().toISOString() },
          { location: `/api/v3/requests/${requestId}`, 'opdc-request-id': requestId, 'retry-after': '1' },
        )
      }
      return res
    }
    const r = req.path.match(/^\/requests\/([^/]+)$/)
    if (req.method === 'GET' && r) {
      const res = requests.get(r[1])
      if (!res) return problemResponse(404, 'RECORD_NOT_FOUND', 'Unknown request', 'no request with that id')
      const { 'x-fingerprint': _, ...headers } = res.headers
      return { ...res, headers: { ...headers, 'opdc-request-state': res.status < 400 ? 'succeeded' : 'failed' } }
    }
    return problemResponse(404, 'RECORD_NOT_FOUND', 'Not found', `${req.method} ${req.path} is not served by the mock`)
  }
}
