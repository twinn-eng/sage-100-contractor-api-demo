import { useMemo } from 'react'
import type { Client } from '../api/client'
import {
  KIND_LABEL,
  lineKind,
  lineTotal,
  unitCost,
  type FieldErrors,
  type LineDraft,
  type LineField,
} from '../lib/allocation'
import { fmtMoney, fmtQty, fmtUnitCost } from '../lib/format'
import { usePartStock } from '../lib/hooks'
import * as lookups from '../lib/lookups'
import { pagedLookup } from '../lib/paging'
import { Combobox } from './Combobox'
import { Field } from './Field'

interface Props {
  client: Client
  lines: LineDraft[]
  errors: FieldErrors<LineField>[]
  stockVersion: number
  locationNames: Map<number, string>
  onChange: (index: number, patch: Partial<LineDraft>) => void
  onAdd: () => void
  onRemove: (index: number) => void
}

export function LinesCard({ client, lines, errors, stockVersion, locationNames, onChange, onAdd, onRemove }: Props) {
  const totals = useMemo(() => {
    let quantity = 0
    let cost = 0
    let priced = true
    for (const l of lines) {
      const q = Number(l.quantity)
      if (l.part && q > 0) quantity += q
      const t = lineTotal(l)
      if (t === null) {
        if (l.part && l.quantity) priced = false
      } else cost += t
    }
    return { quantity, cost, priced }
  }, [lines])

  return (
    <section className="card" aria-labelledby="lines-title">
      <header className="card-head row">
        <div>
          <h2 id="lines-title">Lines</h2>
          <p className="card-sub">Each line uses two of source, destination and account: an issue, a transfer or a return.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onAdd}>
          Add line
        </button>
      </header>
      <ol className="lines">
        {lines.map((line, i) => (
          <LineRow
            key={line.key}
            index={i}
            client={client}
            line={line}
            errors={errors[i] ?? {}}
            stockVersion={stockVersion}
            locationNames={locationNames}
            canRemove={lines.length > 1}
            onChange={(patch) => onChange(i, patch)}
            onRemove={() => onRemove(i)}
          />
        ))}
      </ol>
      <footer className="totals" aria-label="Totals">
        <div>
          <span className="caps">Lines</span>
          <span className="mono">{lines.filter((l) => l.part).length}</span>
        </div>
        <div>
          <span className="caps">Quantity</span>
          <span className="mono">{fmtQty(totals.quantity)}</span>
        </div>
        <div>
          <span className="caps">Estimated total</span>
          <span className="mono" data-testid="estimated-total">
            {fmtMoney(totals.cost)}
            {totals.priced ? '' : ' +'}
          </span>
        </div>
        <p className="totals-note">
          Estimated from each part's average cost. The API values issues and transfers itself and returns the cost it used.
        </p>
      </footer>
    </section>
  )
}

interface RowProps {
  index: number
  client: Client
  line: LineDraft
  errors: FieldErrors<LineField>
  stockVersion: number
  locationNames: Map<number, string>
  canRemove: boolean
  onChange: (patch: Partial<LineDraft>) => void
  onRemove: () => void
}

function LineRow({ index, client, line, errors, stockVersion, locationNames, canRemove, onChange, onRemove }: RowProps) {
  const partPages = useMemo(() => pagedLookup(client, lookups.parts), [client])
  const locationPages = useMemo(() => pagedLookup(client, lookups.locations), [client])
  const accountPages = useMemo(() => pagedLookup(client, lookups.accounts), [client])
  const accountNumber = line.account?.recordNumber
  const subPages = useMemo(
    () => pagedLookup(client, lookups.subaccounts, { match: { field: 'controlAccount', operator: '=', value: accountNumber } }),
    [client, accountNumber],
  )
  const codePages = useMemo(() => pagedLookup(client, lookups.costCodes), [client])
  const typePages = useMemo(() => pagedLookup(client, lookups.costTypes), [client])

  const kind = lineKind(line)
  const stock = usePartStock(client, line.part?.recordNumber, stockVersion)
  const cost = unitCost(line)
  const total = lineTotal(line)
  const n = index + 1

  let stockHint: string | null = null
  if (line.part && stock.byLocation) {
    if (line.source) {
      const s = stock.byLocation.get(line.source.recordNumber)
      const where = locationNames.get(line.source.recordNumber) ?? `location ${line.source.recordNumber}`
      stockHint = s ? `At ${where}: ${fmtQty(s.onHand)} on hand, ${fmtQty(s.available)} available` : `None stocked at ${where}`
    } else {
      let onHand = 0
      let available = 0
      for (const s of stock.byLocation.values()) {
        onHand += s.onHand
        available += s.available
      }
      const count = stock.byLocation.size
      stockHint = `${fmtQty(onHand)} on hand, ${fmtQty(available)} available across ${count} ${count === 1 ? 'location' : 'locations'}`
    }
  } else if (line.part && stock.error) {
    stockHint = 'Stock levels could not be loaded'
  }

  const shortAtSource =
    line.source && line.quantity && stock.byLocation
      ? Number(line.quantity) > (stock.byLocation.get(line.source.recordNumber)?.available ?? 0)
      : false

  return (
    <li className="line" aria-label={`Line ${n}`} data-testid={`line-${n}`}>
      <div className="line-head">
        <span className="line-no">Line {n}</span>
        <span className={`pill pill-${kind}`}>{KIND_LABEL[kind]}</span>
        {canRemove ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remove line ${n}`}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="line-grid">
        <div className="c-part">
          <Combobox
            label="Part"
            testId={`line-${n}-part`}
            required
            value={line.part ? lookups.parts.toOption(line.part) : null}
            onChange={(o) => onChange({ part: o?.item ?? null })}
            fetchPage={partPages}
            error={errors.partNumber}
            hint={
              stockHint ? (
                <span className={shortAtSource ? 'stock short' : 'stock'} data-testid={`line-${n}-stock`}>
                  {stockHint}
                </span>
              ) : undefined
            }
          />
        </div>
        <Field label="Quantity" required error={errors.quantity} className="c-qty">
          {(p) => (
            <input
              {...p}
              className="mono num"
              inputMode="decimal"
              value={line.quantity}
              onChange={(e) => onChange({ quantity: e.target.value })}
              placeholder="0"
            />
          )}
        </Field>
        <Field
          label="Unit cost"
          error={errors.cost}
          className="c-cost"
          hint={kind === 'return' ? 'The cost it comes back at.' : 'Average cost; set by the API.'}
        >
          {(p) =>
            kind === 'return' ? (
              <input {...p} className="mono num" inputMode="decimal" value={line.cost} onChange={(e) => onChange({ cost: e.target.value })} placeholder="0.00" />
            ) : (
              <input {...p} className="mono num" readOnly tabIndex={-1} value={cost === null ? '' : fmtUnitCost(cost)} />
            )
          }
        </Field>
        <div className="field c-total">
          <span className="field-label">Total</span>
          <output className="readout mono num" aria-label={`Line ${n} total`}>
            {total === null ? '' : fmtMoney(total)}
          </output>
        </div>

        <div className="c-loc">
          <Combobox
            label="Source"
            testId={`line-${n}-source`}
            value={line.source ? lookups.locations.toOption(line.source) : null}
            onChange={(o) => onChange({ source: o?.item ?? null })}
            fetchPage={locationPages}
            error={errors.sourceLocation}
            placeholder="Location it leaves"
          />
        </div>
        <div className="c-loc">
          <Combobox
            label="Destination"
            testId={`line-${n}-destination`}
            value={line.destination ? lookups.locations.toOption(line.destination) : null}
            onChange={(o) => onChange({ destination: o?.item ?? null })}
            fetchPage={locationPages}
            error={errors.destinationLocation}
            placeholder="Location it arrives at"
          />
        </div>
        <div className="c-loc">
          <Combobox
            label="Account"
            testId={`line-${n}-account`}
            value={line.account ? lookups.accounts.toOption(line.account) : null}
            onChange={(o) => onChange({ account: o?.item ?? null, subaccount: null })}
            fetchPage={accountPages}
            error={errors.debitAccount}
            placeholder="Expense or job account"
          />
        </div>
        <div className="c-loc">
          <Combobox
            key={accountNumber ?? 'none'}
            label="Subaccount"
            testId={`line-${n}-subaccount`}
            value={line.subaccount ? lookups.subaccounts.toOption(line.subaccount) : null}
            onChange={(o) => onChange({ subaccount: o?.item ?? null })}
            fetchPage={subPages}
            disabled={!line.account || kind === 'transfer'}
            error={errors.debitSubAccount}
            placeholder={line.account ? 'None' : 'Choose an account first'}
            alignEnd
          />
        </div>

        <div className="c-code">
          <Combobox
            label="Cost code"
            testId={`line-${n}-cost-code`}
            value={line.costCode ? lookups.costCodes.toOption(line.costCode) : null}
            onChange={(o) => onChange({ costCode: o?.item ?? null })}
            fetchPage={codePages}
            error={errors.costCode}
            placeholder="For job cost"
          />
        </div>
        <div className="c-code">
          <Combobox
            label="Cost type"
            testId={`line-${n}-cost-type`}
            value={line.costType ? lookups.costTypes.toOption(line.costType) : null}
            onChange={(o) => onChange({ costType: o?.item ?? null })}
            fetchPage={typePages}
            error={errors.costType}
            placeholder="For job cost"
          />
        </div>
        <Field label="Description" className="c-desc">
          {(p) => (
            <input
              {...p}
              maxLength={75}
              value={line.description}
              placeholder={line.part?.partName ?? 'From the part'}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          )}
        </Field>
        <Field label="Unit" className="c-unit">
          {(p) => (
            <input {...p} maxLength={10} value={line.unit} placeholder={line.part?.partUnit ?? ''} onChange={(e) => onChange({ unit: e.target.value })} />
          )}
        </Field>
      </div>
    </li>
  )
}
