import { useMemo } from 'react'
import type { Client } from '../api/client'
import type { AllocationPurpose, AllocationStatus } from '../api/types'
import { PURPOSES, STATUSES, type FieldErrors, type HeaderDraft, type HeaderField } from '../lib/allocation'
import * as lookups from '../lib/lookups'
import { pagedLookup } from '../lib/paging'
import { Combobox } from './Combobox'
import { Field } from './Field'

interface Props {
  client: Client
  header: HeaderDraft
  errors: FieldErrors<HeaderField>
  resolvedPurpose: AllocationPurpose
  onChange: (patch: Partial<HeaderDraft>) => void
}

export function HeaderCard({ client, header, errors, resolvedPurpose, onChange }: Props) {
  const jobPages = useMemo(() => pagedLookup(client, lookups.jobs), [client])
  const jobNumber = header.job?.recordNumber
  const phasePages = useMemo(
    () => pagedLookup(client, lookups.phases, { match: { field: 'recordNumber', operator: '=', value: jobNumber } }),
    [client, jobNumber],
  )
  const status = STATUSES.find((s) => s.value === header.status)

  return (
    <section className="card" aria-labelledby="header-title">
      <header className="card-head">
        <h2 id="header-title">Allocation</h2>
        <p className="card-sub">The ticket header, as on the 12-2 screen in Sage.</p>
      </header>
      <div className="grid grid-3">
        <Field label="Ticket #" required error={errors.ticketNumber}>
          {(p) => (
            <input {...p} maxLength={20} value={header.ticketNumber} onChange={(e) => onChange({ ticketNumber: e.target.value })} />
          )}
        </Field>
        <Field label="Date" required error={errors.transactionDate}>
          {(p) => <input {...p} type="date" value={header.transactionDate} onChange={(e) => onChange({ transactionDate: e.target.value })} />}
        </Field>
        <Field label="Status" hint={status?.hint} error={errors.status}>
          {(p) => (
            <select {...p} value={header.status} onChange={(e) => onChange({ status: Number(e.target.value) as AllocationStatus })}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Combobox
          label="Job"
          testId="job"
          value={header.job ? lookups.jobs.toOption(header.job) : null}
          onChange={(o) => onChange({ job: o?.item ?? null, phase: null })}
          fetchPage={jobPages}
          error={errors.jobNumber}
          placeholder="No job"
        />
        <Combobox
          key={jobNumber ?? 'none'}
          label="Phase"
          testId="phase"
          value={header.phase ? lookups.phases.toOption(header.phase) : null}
          onChange={(o) => onChange({ phase: o?.item ?? null })}
          fetchPage={phasePages}
          disabled={!header.job}
          error={errors.phaseNumber}
          placeholder={header.job ? 'No phase' : 'Choose a job first'}
        />
        <Field label="Order #" error={errors.orderNumber}>
          {(p) => <input {...p} maxLength={20} value={header.orderNumber} onChange={(e) => onChange({ orderNumber: e.target.value })} />}
        </Field>

        <Field label="Description" required error={errors.description} wide>
          {(p) => <input {...p} maxLength={50} value={header.description} onChange={(e) => onChange({ description: e.target.value })} />}
        </Field>
        <Field label="Delivery via" error={errors.deliveryVia}>
          {(p) => <input {...p} maxLength={30} value={header.deliveryVia} onChange={(e) => onChange({ deliveryVia: e.target.value })} />}
        </Field>

        <Field
          label="Purpose"
          error={errors.purpose}
          hint="Decides whether a shipped allocation books job cost."
        >
          {(p) => (
            <select
              {...p}
              value={header.purpose ?? ''}
              onChange={(e) => onChange({ purpose: (e.target.value || null) as AllocationPurpose | null })}
            >
              <option value="">Automatic ({PURPOSES.find((x) => x.value === resolvedPurpose)?.label})</option>
              {PURPOSES.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </section>
  )
}
