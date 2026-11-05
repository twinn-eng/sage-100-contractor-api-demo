import type { WriteOutcome } from '../api/client'
import { PURPOSES, STATUSES } from '../lib/allocation'
import type { Banner } from '../lib/errors'
import { fmtDelta, fmtMoney, fmtQty, fmtUnitCost } from '../lib/format'

export type ResultState =
  | { kind: 'idle' }
  | { kind: 'working'; dryRun: boolean; requestId?: string }
  | { kind: 'done'; outcome: WriteOutcome }
  | { kind: 'failed'; dryRun: boolean; banner: Banner }

interface Props {
  state: ResultState
  locationNames: Map<number, string>
  onRetry?: () => void
}

export function ResultPanel({ state, locationNames, onRetry }: Props) {
  const loc = (n?: number) => (n ? `${n} ${locationNames.get(n) ?? ''}`.trim() : '')

  if (state.kind === 'idle') {
    return (
      <section className="card result result-idle" aria-labelledby="result-title" aria-live="polite">
        <h2 id="result-title">Result</h2>
        <p className="muted">
          Validate runs the allocation against the company's books and rolls it back, so you see the costs and postings without
          saving anything. Save records it in Sage.
        </p>
      </section>
    )
  }

  if (state.kind === 'working') {
    return (
      <section className="card result" aria-labelledby="result-title" aria-live="polite" aria-busy="true">
        <h2 id="result-title">{state.dryRun ? 'Validating' : 'Saving'}</h2>
        <p className="muted">
          <span className="spinner" aria-hidden="true" />
          {state.requestId
            ? ` Sage is still working on it. Following request ${state.requestId.slice(0, 8)} until it finishes.`
            : ' Waiting for Sage to answer.'}
        </p>
      </section>
    )
  }

  if (state.kind === 'failed') {
    const b = state.banner
    return (
      <section className={`card result banner banner-${b.tone}`} role="alert" aria-labelledby="result-title" data-testid="result-error">
        <h2 id="result-title">{b.title}</h2>
        {b.message ? <p>{b.message}</p> : null}
        {b.detail ? (
          <p className="detail">
            <span className="muted">From the API:</span> {b.detail}
          </p>
        ) : null}
        <p className="meta">
          {b.code ? <code className="code">{b.code}</code> : null}
          {b.correlationId ? <span>Correlation id {b.correlationId}</span> : null}
          <span>{state.dryRun ? 'Validate only: nothing was saved.' : 'Nothing was saved.'}</span>
        </p>
        {b.retrySameKey && onRetry ? (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Try again with the same key
          </button>
        ) : null}
      </section>
    )
  }

  const { result, idempotencyStatus, requestId } = state.outcome
  const doc = result.document
  const status = STATUSES.find((s) => s.value === doc.status)
  const purpose = PURPOSES.find((p) => p.value === doc.purpose)
  const gl = result.ledgerTransaction
  const debit = gl?.lines.reduce((s, l) => s + Number(l.debitAmount), 0) ?? 0
  const credit = gl?.lines.reduce((s, l) => s + Number(l.creditAmount), 0) ?? 0

  return (
    <section className={`card result ${result.dryRun ? 'result-dry' : 'result-ok'}`} aria-labelledby="result-title" aria-live="polite" data-testid="result">
      <header className="card-head row">
        <div>
          <h2 id="result-title">
            {result.dryRun ? 'Validated. Nothing was saved.' : `Allocation ${doc.recordNumber} saved`}
          </h2>
          <p className="card-sub">
            {result.dryRun
              ? 'This is what saving would do. Record numbers in a dry run are provisional and are never used.'
              : 'Recorded in Sage. It now appears in the recent allocations below.'}
          </p>
        </div>
        <span className={`pill ${result.dryRun ? 'pill-amber' : 'pill-green'}`}>{result.dryRun ? 'Dry run' : 'Saved'}</span>
      </header>

      <dl className="facts">
        <div>
          <dt>Record #</dt>
          <dd className="mono">{doc.recordNumber}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status?.label}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{purpose?.label}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd className="mono">
            {result.period}/{result.year}
          </dd>
        </div>
        {idempotencyStatus ? (
          <div>
            <dt>Idempotency</dt>
            <dd>{idempotencyStatus}</dd>
          </div>
        ) : null}
        {requestId ? (
          <div>
            <dt>Request</dt>
            <dd className="mono">{requestId.slice(0, 8)}</dd>
          </div>
        ) : null}
      </dl>

      <h3 className="caps">Lines</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Part</th>
              <th className="num">Quantity</th>
              <th className="num">Unit cost</th>
              <th className="num">Total</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.lineNumber}</td>
                <td>
                  <span className="mono">{l.partRecordNumber}</span> {l.partDescription}
                </td>
                <td className="mono num">{fmtQty(l.quantity)}</td>
                <td className="mono num">{fmtUnitCost(l.cost)}</td>
                <td className="mono num">{fmtMoney(l.total)}</td>
                <td>{loc(l.sourceLocation)}</td>
                <td>{loc(l.destinationLocation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="caps">Inventory</h3>
      {result.inventory.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Location</th>
                <th className="num">Available</th>
                <th className="num">On hand</th>
                <th className="num">History #</th>
              </tr>
            </thead>
            <tbody>
              {result.inventory.map((m, i) => (
                <tr key={i}>
                  <td className="mono">{m.partNumber}</td>
                  <td>{loc(m.location)}</td>
                  <td className="mono num">{fmtDelta(m.quantityAvailableDelta)}</td>
                  <td className="mono num">{fmtDelta(m.quantityOnHandDelta)}</td>
                  <td className="mono num">{m.historyRecordNumber ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No stock moves at status {status?.label}.</p>
      )}

      <h3 className="caps">Job cost</h3>
      {result.jobCosts.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Phase</th>
                <th>Cost code</th>
                <th>Cost type</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {result.jobCosts.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.jobNumber}</td>
                  <td className="mono">{j.phaseNumber || ''}</td>
                  <td className="mono">{j.costCode}</td>
                  <td className="mono">{j.costType}</td>
                  <td className="mono num">{fmtMoney(j.costAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No job cost. Job cost is booked when a job requisition is shipped (status 4).</p>
      )}

      <h3 className="caps">General ledger</h3>
      {gl ? (
        <div className="table-wrap">
          <table className="table">
            <caption>
              Transaction <span className="mono">{gl.transactionNumber}</span>, record <span className="mono">{gl.recordNumber}</span>
            </caption>
            <thead>
              <tr>
                <th>Account</th>
                <th>Description</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {gl.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">
                    {l.ledgerAccount}
                    {l.subAccount ? `.${l.subAccount}` : ''}
                  </td>
                  <td>{(l as { description?: string }).description}</td>
                  <td className="mono num">{Number(l.debitAmount) ? fmtMoney(l.debitAmount) : ''}</td>
                  <td className="mono num">{Number(l.creditAmount) ? fmtMoney(l.creditAmount) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="mono num">{fmtMoney(debit)}</td>
                <td className="mono num">{fmtMoney(credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="muted">No journal. A journal is posted when stock is shipped (status 4) on an issue or a return.</p>
      )}
    </section>
  )
}
