// The browser's side of the backend proxy. Every call names the company; the backend checks it
// against its configuration and adds that company's API key.

import type {
  ErrorCode,
  InventoryAllocationInput,
  InventoryAllocationWriteResult,
  MatchRequest,
  MatchResponse,
  Problem,
  QueryRequest,
  QueryResponse,
} from './types'

export interface CompanyOption {
  id: string
  label: string
}

/** A failed call, carrying the API's problem document and its error code. */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | string
  readonly problem: Problem

  constructor(status: number, problem: Problem, code?: string | null) {
    super(problem.detail || problem.title)
    this.status = status
    this.problem = problem
    this.code = code || codeFromType(problem.type) || `HTTP_${status}`
  }
}

/** `https://twinn.engineering/errors/insufficient-inventory` is `INSUFFICIENT_INVENTORY`. */
export function codeFromType(type: string | undefined): string | null {
  const slug = type?.match(/\/errors\/([a-z0-9-]+)$/)?.[1]
  return slug ? slug.toUpperCase().replace(/-/g, '_') : null
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const problem = (body as Problem | null) ?? { type: 'about:blank', title: res.statusText || 'Request failed', status: res.status }
    throw new ApiError(res.status, problem, res.headers.get('x-error-code'))
  }
  return body as T
}

export async function listCompanies(): Promise<{ mock: boolean; data: CompanyOption[] }> {
  return parse(await fetch('/api/companies'))
}

export interface WriteOptions {
  dryRun: boolean
  idempotencyKey: string
  /** Seconds to hold each call for an answer. */
  wait?: number
  signal?: AbortSignal
  /** Called while a write that outlived its wait is being followed. */
  onPending?: (requestId: string) => void
}

export interface WriteOutcome {
  result: InventoryAllocationWriteResult
  idempotencyStatus: string | null
  /** Set when the answer came from following a `202`. */
  requestId: string | null
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function createClient(company: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)) {
  const base = `/api/${encodeURIComponent(company)}`
  const post = (path: string, body: unknown, init: RequestInit = {}) =>
    fetchImpl(`${base}${path}`, {
      ...init,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
      body: JSON.stringify(body),
    })

  return {
    company,

    async query<T>(entity: string, body: QueryRequest, signal?: AbortSignal): Promise<QueryResponse<T>> {
      return parse(await post(`/query/${entity}`, body, { signal }))
    },

    async match<T>(entity: string, body: MatchRequest, signal?: AbortSignal): Promise<MatchResponse<T>> {
      return parse(await post(`/match/${entity}`, body, { signal }))
    },

    /**
     * Records (or, with `dryRun`, validates) an allocation.
     *
     * The call asks the API to hold it for up to `wait` seconds. A write that takes longer answers
     * `202` with a `Location`; that is not success, so this follows `Location` until the request has
     * an outcome, which is exactly what the original call would have answered.
     */
    async postAllocation(body: InventoryAllocationInput, opts: WriteOptions): Promise<WriteOutcome> {
      const wait = opts.wait ?? 25
      let res = await post(`/inventory-allocations${opts.dryRun ? '?dryRun=true' : ''}`, body, {
        signal: opts.signal,
        headers: { 'idempotency-key': opts.idempotencyKey, prefer: `wait=${wait}` },
      })
      let requestId: string | null = null
      while (res.status === 202) {
        const location = res.headers.get('location')
        const accepted = (await res.json().catch(() => ({}))) as { requestId?: string }
        requestId = res.headers.get('opdc-request-id') ?? accepted.requestId ?? requestId
        if (!location) throw new ApiError(502, { type: 'about:blank', title: 'Accepted without a Location', status: 502 })
        opts.onPending?.(requestId ?? '')
        const retryAfter = Number(res.headers.get('retry-after') ?? 0)
        if (retryAfter > 0) await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000))
        res = await fetchImpl(`${location}?wait=${wait}`, { signal: opts.signal })
      }
      const idempotencyStatus = res.headers.get('idempotency-status')
      const result = await parse<InventoryAllocationWriteResult>(res)
      return { result, idempotencyStatus, requestId }
    },
  }
}

export type Client = ReturnType<typeof createClient>
