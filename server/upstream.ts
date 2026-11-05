// The one place the backend talks to the Twinn API. The API key is added here and nowhere else.

import type { Company } from './config.ts'

export interface UpstreamRequest {
  method: 'GET' | 'POST'
  /** Path under the company's base URL, such as `/parts/query`. */
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

export interface UpstreamResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export type Upstream = (req: UpstreamRequest) => Promise<UpstreamResponse>

/** Response headers worth passing back to the browser. Everything else is dropped. */
export const PASS_HEADERS = [
  'content-type',
  'location',
  'retry-after',
  'idempotency-status',
  'x-error-code',
  'x-correlation-id',
  'opdc-request-id',
  'opdc-request-state',
]

/** Long enough for `Prefer: wait=25` plus the network on either side. */
const TIMEOUT_MS = 40_000

export function httpUpstream(company: Company): Upstream {
  return async ({ method, path, query, headers, body }) => {
    const url = new URL(company.baseUrl + path)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json, application/problem+json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
        'x-api-key': company.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const out: Record<string, string> = {}
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h)
      if (v !== null) out[h] = v
    }
    return { status: res.status, headers: out, body: await res.text() }
  }
}
