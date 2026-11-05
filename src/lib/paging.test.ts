import { describe, expect, it, vi } from 'vitest'
import { maxDistanceFor, pagedList, pagedLookup, type Lookup } from './paging'

interface Row {
  recordNumber: number
  name: string
}

const lookup: Lookup<Row> = {
  entity: 'jobs',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['recordNumber', 'name'],
  matchFields: ['name'],
  orderBy: ['recordNumber'],
  toOption: (r) => ({ key: String(r.recordNumber), number: String(r.recordNumber), name: r.name, item: r }),
}

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ recordNumber: from + i, name: `Job ${from + i}` }))

function fakeClient(total = 60) {
  return {
    query: vi.fn(async (_entity: string, body: { page?: { pageNumber?: number; pageSize?: number } }) => {
      const size = body.page!.pageSize!
      const start = (body.page!.pageNumber! - 1) * size
      const data = rows(1 + start, Math.max(0, Math.min(size, total - start)))
      return { asOf: '', page: { pageNumber: body.page!.pageNumber!, pageSize: size, totalCount: total, returnedCount: data.length }, data }
    }),
    match: vi.fn(async (_entity: string, body: { limit?: number }) => ({
      asOf: '',
      data: rows(1, Math.min(body.limit!, 30)).map((r, i) => ({ ...r, distance: i % 3 })),
    })),
  }
}

describe('pagedLookup', () => {
  it('browses with query pages and knows when there are more', async () => {
    const client = fakeClient(60)
    const fetch = pagedLookup(client as never, lookup, undefined, 25)
    const p1 = await fetch('', 1)
    expect(p1.options).toHaveLength(25)
    expect(p1).toMatchObject({ pageNumber: 1, totalCount: 60, hasMore: true })
    expect(client.query).toHaveBeenLastCalledWith(
      'jobs',
      expect.objectContaining({ page: { pageNumber: 1, pageSize: 25 }, orderBy: ['recordNumber'] }),
      undefined,
    )
    const p3 = await fetch('', 3)
    expect(p3.options.map((o) => o.number)).toEqual(rows(51, 10).map((r) => String(r.recordNumber)))
    expect(p3.hasMore).toBe(false)
    expect(client.match).not.toHaveBeenCalled()
  })

  it('searches text with match, asking for one more hit than it shows', async () => {
    const client = fakeClient()
    const fetch = pagedLookup(client as never, lookup, undefined, 10)
    const p1 = await fetch('  harbor ', 1)
    expect(client.match).toHaveBeenLastCalledWith(
      'jobs',
      expect.objectContaining({ matchString: 'harbor', matchFields: ['name'], limit: 11, maxDistance: 2 }),
      undefined,
    )
    expect(p1.options).toHaveLength(10)
    expect(p1.hasMore).toBe(true)
    expect(p1.totalCount).toBeUndefined()

    const p3 = await fetch('harbor', 3)
    expect(client.match).toHaveBeenLastCalledWith('jobs', expect.objectContaining({ limit: 31 }), undefined)
    expect(p3.options.map((o) => o.number)).toEqual(['21', '22', '23', '24', '25', '26', '27', '28', '29', '30'])
    expect(p3.hasMore).toBe(false)
  })

  it('looks a number up with an equals filter, combined with the scope', async () => {
    const client = fakeClient()
    const scope = { match: { field: 'recordNumber', operator: '=' as const, value: 2401 } }
    await pagedLookup(client as never, lookup, scope)('42', 1)
    expect(client.query).toHaveBeenLastCalledWith(
      'jobs',
      expect.objectContaining({
        filters: { and: [scope, { match: { field: 'recordNumber', operator: '=', value: 42 } }] },
      }),
      undefined,
    )
  })

  it('keeps decimal numbers, such as cost codes, as strings', async () => {
    const client = fakeClient()
    await pagedLookup(client as never, { ...lookup, numberKind: 'decimal' })('15.100', 1)
    expect(client.query.mock.calls[0][1]).toMatchObject({ filters: { match: { value: '15.100' } } })
  })

  it('scales the allowed edit distance with the search length', () => {
    expect(maxDistanceFor('ab')).toBe(1)
    expect(maxDistanceFor('copper')).toBe(2)
    expect(maxDistanceFor('copper elbow')).toBe(3)
  })
})

describe('pagedList', () => {
  it('pages and filters a list held in memory, loading it once', async () => {
    const load = vi.fn(async () => rows(1, 30))
    const fetch = pagedList(load, lookup.toOption, 25)
    expect((await fetch('', 2)).options).toHaveLength(5)
    const hits = await fetch('job 2', 1)
    expect(hits.totalCount).toBe(11)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
