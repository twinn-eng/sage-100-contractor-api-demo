// Which companies the backend can reach, read from the environment.
//
// One API key reaches one Sage company, so a "company" here is a label plus the base URL and key
// that reach it. The browser only ever sees `id` and `label`.

export interface Company {
  id: string
  label: string
  baseUrl: string
  apiKey: string
}

export interface Config {
  mock: boolean
  port: number
  companies: Company[]
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/

function parseCompanies(env: NodeJS.ProcessEnv): Company[] {
  const out: Company[] = []
  if (env.COMPANIES?.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(env.COMPANIES)
    } catch {
      throw new Error('COMPANIES is not valid JSON. See .env.example.')
    }
    if (!Array.isArray(parsed)) throw new Error('COMPANIES must be a JSON array. See .env.example.')
    for (const c of parsed as Record<string, unknown>[]) {
      out.push({
        id: String(c.id ?? ''),
        label: String(c.label ?? c.id ?? ''),
        baseUrl: String(c.baseUrl ?? ''),
        apiKey: String(c.apiKey ?? ''),
      })
    }
  }
  // Numbered variables, for hosts where a JSON value is awkward: COMPANY_1_ID, COMPANY_1_LABEL, ...
  for (let n = 1; env[`COMPANY_${n}_ID`]; n++) {
    out.push({
      id: env[`COMPANY_${n}_ID`] ?? '',
      label: env[`COMPANY_${n}_LABEL`] ?? env[`COMPANY_${n}_ID`] ?? '',
      baseUrl: env[`COMPANY_${n}_BASE_URL`] ?? '',
      apiKey: env[`COMPANY_${n}_API_KEY`] ?? '',
    })
  }
  return out
}

function validate(companies: Company[]): Company[] {
  const seen = new Set<string>()
  for (const c of companies) {
    if (!ID.test(c.id)) throw new Error(`Company id "${c.id}" must be lowercase letters, digits and dashes.`)
    if (seen.has(c.id)) throw new Error(`Company id "${c.id}" is configured twice.`)
    seen.add(c.id)
    let url: URL
    try {
      url = new URL(c.baseUrl)
    } catch {
      throw new Error(`Company "${c.id}" has no valid baseUrl.`)
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new Error(`Company "${c.id}": baseUrl must use https.`)
    }
    c.baseUrl = c.baseUrl.replace(/\/+$/, '')
    if (!c.apiKey || c.apiKey.includes('xxxxxxxx')) {
      throw new Error(`Company "${c.id}" has no API key. Set one, or run with MOCK=1.`)
    }
  }
  return companies
}

export const MOCK_COMPANIES: Company[] = [
  { id: 'demo', label: 'Demo company (sample data)', baseUrl: 'mock:', apiKey: '' },
]

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mock = env.MOCK === '1' || env.MOCK === 'true'
  const port = Number(env.PORT ?? env.API_PORT ?? 8787)
  if (mock) return { mock, port, companies: MOCK_COMPANIES }
  const companies = validate(parseCompanies(env))
  if (companies.length === 0) {
    throw new Error('No companies configured. Copy .env.example to .env and add a key, or run with MOCK=1.')
  }
  return { mock, port, companies }
}
