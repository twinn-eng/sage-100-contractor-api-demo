import { Fragment, useEffect, useState } from 'react'
import type { Client } from '../api/client'
import type { InventoryAllocation, PageResponse } from '../api/types'
import { STATUSES } from '../lib/allocation'
import { fmtDate, fmtMoney, fmtQty } from '../lib/format'

interface Props {
  client: Client
  /** Bumped after a save, so the new allocation appears. */
  version: number
  highlight?: number
  locationNames: Map<number, string>
}

const PAGE_SIZE = 10
const STATUS_PILL: Record<number, string> = { 1: 'pill-grey', 2: 'pill-blue', 3: 'pill-amber', 4: 'pill-green' }

export function RecentAllocations({ client, version, highlight, locationNames }: Props) {
  const [pageNumber, setPageNumber] = useState(1)
  const key = `${client.company}|${version}|${pageNumber}`
  const [loaded, setLoaded] = useState<{ key: string; rows: InventoryAllocation[]; page: PageResponse | null; error: string | null }>({
    key: '',
    rows: [],
    page: null,
    error: null,
  })
  const state = { ...loaded, loading: loaded.key !== key }
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    client
      .query<InventoryAllocation>(
        'inventory-allocations',
        {
          select: ['id', 'recordNumber', 'transactionNumber', 'transactionDate', 'jobNumber', 'phaseNumber', 'status', 'description'],
          children: ['lines'],
          orderBy: ['recordNumber DESC'],
          page: { pageNumber, pageSize: PAGE_SIZE },
        },
        ctrl.signal,
      )
      .then((r) => setLoaded({ key, rows: r.data, page: r.page, error: null }))
      .catch((e: Error) => !ctrl.signal.aborted && setLoaded({ key, rows: [], page: null, error: e.message }))
    return () => ctrl.abort()
  }, [client, version, pageNumber, key])

  const pages = state.page ? Math.max(1, Math.ceil(state.page.totalCount / PAGE_SIZE)) : 1

  return (
    <section className="card" aria-labelledby="recent-title">
      <header className="card-head row">
        <div>
          <h2 id="recent-title">Recent allocations</h2>
          <p className="card-sub">Read back with a query, newest first, lines included.</p>
        </div>
        <div className="pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={pageNumber <= 1 || state.loading} onClick={() => setPageNumber((p) => p - 1)}>
            Prev
          </button>
          <span className="muted">
            Page {pageNumber} of {pages}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pageNumber >= pages || state.loading} onClick={() => setPageNumber((p) => p + 1)}>
            Next
          </button>
        </div>
      </header>
      {state.error ? <p className="field-error">{state.error}</p> : null}
      <div className="table-wrap">
        <table className="table" data-testid="recent" aria-busy={state.loading || undefined}>
          <thead>
            <tr>
              <th>Record #</th>
              <th>Ticket</th>
              <th>Date</th>
              <th>Job</th>
              <th>Status</th>
              <th>Description</th>
              <th className="num">Lines</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((a) => {
              const lines = a.lines ?? []
              const total = lines.reduce((s, l) => s + Number(l.inventoryTotal ?? 0), 0)
              const status = STATUSES.find((s) => s.value === a.status)
              const isOpen = open === a.id
              return (
                <Fragment key={a.id}>
                  <tr className={a.recordNumber === highlight ? 'row-new' : undefined}>
                    <td className="mono">
                      <button
                        type="button"
                        className="link"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} lines of allocation ${a.recordNumber}`}
                        onClick={() => setOpen(isOpen ? null : a.id)}
                      >
                        {a.recordNumber}
                      </button>
                    </td>
                    <td>{a.transactionNumber}</td>
                    <td>{fmtDate(a.transactionDate)}</td>
                    <td className="mono">{a.jobNumber || ''}</td>
                    <td>{status ? <span className={`pill ${STATUS_PILL[status.value]}`}>{status.label}</span> : a.status}</td>
                    <td>{a.description}</td>
                    <td className="mono num">{lines.length}</td>
                    <td className="mono num">{fmtMoney(total)}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="row-detail">
                      <td colSpan={8}>
                        <table className="table table-inner">
                          <thead>
                            <tr>
                              <th>Part</th>
                              <th className="num">Quantity</th>
                              <th className="num">Total</th>
                              <th>From</th>
                              <th>To</th>
                              <th>Account</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l) => (
                              <tr key={l.id}>
                                <td>
                                  <span className="mono">{l.partRecordNumber}</span> {l.partDescription}
                                </td>
                                <td className="mono num">{fmtQty(l.inventoryQuantity)}</td>
                                <td className="mono num">{fmtMoney(l.inventoryTotal)}</td>
                                <td>{l.sourceLocation ? locationNames.get(l.sourceLocation) ?? l.sourceLocation : ''}</td>
                                <td>{l.destinationLocation ? locationNames.get(l.destinationLocation) ?? l.destinationLocation : ''}</td>
                                <td className="mono">{l.debitAccount || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
            {!state.loading && state.rows.length === 0 && !state.error ? (
              <tr>
                <td colSpan={8} className="muted">
                  No allocations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
