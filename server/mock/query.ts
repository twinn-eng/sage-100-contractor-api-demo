// Just enough of the API's query and match behaviour to serve the fixtures: select, filters,
// orderBy, pages, children, and name matching scored by edit distance.

type Row = Record<string, unknown>

export interface FilterNode {
  and?: FilterNode[]
  or?: FilterNode[]
  match?: { field?: string; operator: string; value?: unknown; values?: unknown[] }
}

export interface QueryBody {
  select?: string[]
  filters?: FilterNode
  orderBy?: string[]
  page?: { pageNumber?: number; pageSize?: number }
  children?: string[]
}

export interface MatchBody {
  select: string[]
  matchFields: string[]
  matchString: string
  maxDistance: number
  filters?: FilterNode
  limit?: number
}

const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v)

function compare(a: unknown, b: unknown): number {
  const x = num(a)
  const y = num(b)
  if (typeof x === 'number' && typeof y === 'number') return x - y
  return String(x ?? '').localeCompare(String(y ?? ''))
}

function like(value: unknown, pattern: unknown): boolean {
  const re = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.')
  return new RegExp(`^${re}$`, 'i').test(String(value ?? ''))
}

export function matches(row: Row, f: FilterNode | undefined): boolean {
  if (!f) return true
  if (f.and && !f.and.every((x) => matches(row, x))) return false
  if (f.or && !f.or.some((x) => matches(row, x))) return false
  if (f.match) {
    const { field = '', operator, value, values } = f.match
    const v = row[field]
    switch (operator) {
      case '=': return compare(v, value) === 0
      case '!=': return compare(v, value) !== 0
      case '>': return compare(v, value) > 0
      case '<': return compare(v, value) < 0
      case '>=': return compare(v, value) >= 0
      case '<=': return compare(v, value) <= 0
      case 'LIKE': return like(v, value)
      case 'NOT LIKE': return !like(v, value)
      case 'IN': return (values ?? []).some((x) => compare(v, x) === 0)
      default: return false
    }
  }
  return true
}

function pick(row: Row, select: string[] | undefined): Row {
  if (!select?.length) return { ...row }
  const out: Row = {}
  for (const f of select) if (row[f] !== undefined) out[f] = row[f]
  if (row.lines && !select.includes('lines')) out.lines = row.lines
  return out
}

export function query(rows: Row[], body: QueryBody) {
  let out = rows.filter((r) => matches(r, body.filters))
  for (const ob of [...(body.orderBy ?? [])].reverse()) {
    const [field, dir] = ob.trim().split(/\s+/)
    const sign = dir?.toUpperCase() === 'DESC' ? -1 : 1
    out = [...out].sort((a, b) => sign * compare(a[field], b[field]))
  }
  const pageSize = Math.min(Math.max(body.page?.pageSize ?? 100, 1), 1000)
  const pageNumber = Math.max(body.page?.pageNumber ?? 1, 1)
  const slice = out.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
  const withChildren = (r: Row): Row => {
    const { lines, ...rest } = r
    return body.children?.includes('lines') && lines ? { ...rest, lines } : rest
  }
  return {
    asOf: new Date().toISOString(),
    page: { pageNumber, pageSize, totalCount: out.length, returnedCount: slice.length },
    data: slice.map(withChildren).map((r) => pick(r, body.select)),
  }
}

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

/** The fewest edits that turn `q` into some contiguous part of `s`. */
export function substringDistance(q: string, s: string): number {
  let prev: number[] = new Array(s.length + 1).fill(0)
  for (let i = 1; i <= q.length; i++) {
    const curr = [i]
    for (let j = 1; j <= s.length; j++) {
      curr[j] = Math.min(prev[j - 1] + (q[i - 1] === s[j - 1] ? 0 : 1), prev[j] + 1, curr[j - 1] + 1)
    }
    prev = curr
  }
  return Math.min(...prev)
}

/** Whole-field distance, or the distance to a part of the field when that is close enough. */
export function score(q: string, s: string): number {
  const whole = levenshtein(q, s)
  const tolerance = q.length <= 2 ? 0 : q.length <= 5 ? 1 : 2
  const part = substringDistance(q, s)
  return part < whole && part <= tolerance ? part : whole
}

export function match(rows: Row[], body: MatchBody) {
  const q = body.matchString.trim().toLowerCase()
  const hits: { row: Row; distance: number }[] = []
  for (const row of rows) {
    if (!matches(row, body.filters)) continue
    let best = Infinity
    for (const f of body.matchFields) best = Math.min(best, score(q, String(row[f] ?? '').toLowerCase()))
    if (best <= body.maxDistance) hits.push({ row, distance: best })
  }
  hits.sort((a, b) => a.distance - b.distance)
  const limited = body.limit ? hits.slice(0, body.limit) : hits
  return {
    asOf: new Date().toISOString(),
    data: limited.map(({ row, distance }) => ({
      ...pick(row, ['id', 'recordNumber', ...body.select]),
      distance,
    })),
  }
}
