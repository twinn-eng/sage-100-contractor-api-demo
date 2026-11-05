// Turns a lookup into pages for the dropdown: `query` pages when browsing, `match` when searching.

import type { Client } from '../api/client'
import type { FilterNode } from '../api/types'

export interface Option<T = unknown> {
  key: string
  /** The number Sage shows: record number, phase, cost code. */
  number: string
  name: string
  /** Optional second line, such as a part code. */
  detail?: string
  item: T
}

export interface Page<T = unknown> {
  options: Option<T>[]
  pageNumber: number
  pageSize: number
  /** Total records when known (browsing); undefined for a search. */
  totalCount?: number
  hasMore: boolean
}

export type FetchPage<T = unknown> = (search: string, pageNumber: number, signal?: AbortSignal) => Promise<Page<T>>

export interface Lookup<T> {
  entity: string
  /** Field holding the number shown in the list. */
  numberField: keyof T & string
  /** Is the number an integer (searchable with `=`) or a decimal string (cost codes)? */
  numberKind: 'integer' | 'decimal'
  select: (keyof T & string)[]
  matchFields: (keyof T & string)[]
  orderBy: string[]
  toOption: (item: T) => Option<T>
}

export const PAGE_SIZE = 25

const and = (...nodes: (FilterNode | undefined)[]): FilterNode | undefined => {
  const list = nodes.filter((n): n is FilterNode => !!n)
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : { and: list }
}

/** Edit distance allowed for a search, by its length, so short searches stay precise. */
export function maxDistanceFor(search: string): number {
  const n = search.trim().length
  return n <= 3 ? 1 : n <= 6 ? 2 : 3
}

/**
 * Builds the page fetcher for a lookup.
 *
 * - No search: `POST /{entity}/query` with `page`, so every page comes from the server.
 * - A number: `query` filtered on the number field, also paged.
 * - Text: `POST /{entity}/match`. Matching ranks every candidate before it can answer, so the API
 *   does not page it; this asks for one more hit than the pages shown so far and slices, which keeps
 *   the same next and previous controls.
 */
export function pagedLookup<T>(
  client: Pick<Client, 'query' | 'match'>,
  lookup: Lookup<T>,
  scope?: FilterNode,
  pageSize = PAGE_SIZE,
): FetchPage<T> {
  return async (search, pageNumber, signal) => {
    const q = search.trim()
    if (!q || /^\d+(\.\d+)?$/.test(q)) {
      const byNumber: FilterNode | undefined = q
        ? { match: { field: lookup.numberField, operator: '=', value: lookup.numberKind === 'integer' ? Number(q) : q } }
        : undefined
      const res = await client.query<T>(
        lookup.entity,
        {
          select: lookup.select,
          filters: and(scope, byNumber),
          orderBy: lookup.orderBy,
          page: { pageNumber, pageSize },
        },
        signal,
      )
      return {
        options: res.data.map(lookup.toOption),
        pageNumber,
        pageSize,
        totalCount: res.page.totalCount,
        hasMore: pageNumber * pageSize < res.page.totalCount,
      }
    }
    const limit = pageNumber * pageSize + 1
    const res = await client.match<T>(
      lookup.entity,
      {
        select: lookup.select,
        matchFields: lookup.matchFields,
        matchString: q,
        maxDistance: maxDistanceFor(q),
        filters: scope,
        limit,
      },
      signal,
    )
    const hits = res.data.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
    return {
      options: hits.map((h) => lookup.toOption(h as T)),
      pageNumber,
      pageSize,
      hasMore: res.data.length > pageNumber * pageSize,
    }
  }
}

/** Pages a list already in memory, such as the configured companies. */
export function pagedList<T>(load: () => Promise<T[]>, toOption: (item: T) => Option<T>, pageSize = PAGE_SIZE): FetchPage<T> {
  let cache: Promise<T[]> | null = null
  return async (search, pageNumber) => {
    cache ??= load()
    const all = (await cache).map(toOption)
    const q = search.trim().toLowerCase()
    const hits = q ? all.filter((o) => `${o.number} ${o.name}`.toLowerCase().includes(q)) : all
    return {
      options: hits.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      pageNumber,
      pageSize,
      totalCount: hits.length,
      hasMore: pageNumber * pageSize < hits.length,
    }
  }
}
