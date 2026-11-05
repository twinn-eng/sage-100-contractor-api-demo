import { useEffect, useState } from 'react'
import type { Client } from '../api/client'
import type { InventoryLocation, InventoryQuantity } from '../api/types'

/** Every inventory location, by number, for labels. A company has a handful, so one page holds them. */
export function useLocationNames(client: Client | null): Map<number, string> {
  const [names, setNames] = useState(new Map<number, string>())
  useEffect(() => {
    if (!client) return
    let live = true
    client
      .query<InventoryLocation>('inventory-locations', { select: ['recordNumber', 'locationName'], page: { pageNumber: 1, pageSize: 500 } })
      .then((r) => live && setNames(new Map(r.data.map((l) => [l.recordNumber, l.locationName ?? '']))))
      .catch(() => live && setNames(new Map()))
    return () => {
      live = false
    }
  }, [client])
  return names
}

export interface Stock {
  onHand: number
  available: number
}

/**
 * On hand and available for one part, by location. `version` changes after a save so the hint
 * shows the stock the write left behind.
 */
export function usePartStock(client: Client | null, partNumber: number | undefined, version: number) {
  const [state, setState] = useState<{ key: string; byLocation: Map<number, Stock> | null; error: boolean }>({
    key: '',
    byLocation: null,
    error: false,
  })
  const key = `${client?.company}|${partNumber}|${version}`
  useEffect(() => {
    if (!client || !partNumber) return
    const ctrl = new AbortController()
    client
      .query<InventoryQuantity>(
        'inventory-quantities',
        {
          select: ['partRecordNumber', 'locationNumber', 'quantityOnHand', 'quantityAvailable'],
          filters: { match: { field: 'partRecordNumber', operator: '=', value: partNumber } },
          page: { pageNumber: 1, pageSize: 500 },
        },
        ctrl.signal,
      )
      .then((r) => {
        const byLocation = new Map<number, Stock>()
        for (const q of r.data) {
          if (q.locationNumber === undefined) continue
          byLocation.set(q.locationNumber, { onHand: Number(q.quantityOnHand ?? 0), available: Number(q.quantityAvailable ?? 0) })
        }
        setState({ key, byLocation, error: false })
      })
      .catch(() => !ctrl.signal.aborted && setState({ key, byLocation: null, error: true }))
    return () => ctrl.abort()
  }, [client, partNumber, key])
  return state.key === key ? state : { key, byLocation: null, error: false }
}
