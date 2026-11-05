import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient, listCompanies, type CompanyOption } from './api/client'
import { Combobox } from './components/Combobox'
import { HeaderCard } from './components/HeaderCard'
import { LinesCard } from './components/LinesCard'
import { RecentAllocations } from './components/RecentAllocations'
import { ResultPanel, type ResultState } from './components/ResultPanel'
import {
  emptyHeader,
  emptyLine,
  resolvePurpose,
  toInput,
  validate,
  type FieldErrors,
  type HeaderDraft,
  type HeaderField,
  type LineDraft,
  type LineField,
} from './lib/allocation'
import { bannerFor, fieldErrorsFor } from './lib/errors'
import { useLocationNames } from './lib/hooks'
import { pagedList, type Option } from './lib/paging'

const companyOption = (c: CompanyOption): Option<CompanyOption> => ({ key: c.id, number: '', name: c.label, item: c })

interface Attempt {
  body: string
  key: string
  retryable: boolean
}

export function App() {
  const [companies, setCompanies] = useState<{ mock: boolean; list: CompanyOption[] } | null>(null)
  const [companiesError, setCompaniesError] = useState<string | null>(null)
  const [company, setCompany] = useState<CompanyOption | null>(null)

  useEffect(() => {
    listCompanies()
      .then((r) => {
        setCompanies({ mock: r.mock, list: r.data })
        setCompany(r.data[0] ?? null)
      })
      .catch((e: Error) => setCompaniesError(e.message))
  }, [])

  const companyPages = useMemo(() => pagedList(async () => companies?.list ?? [], companyOption), [companies])
  const client = useMemo(() => (company ? createClient(company.id) : null), [company])
  const locationNames = useLocationNames(client)

  const [header, setHeader] = useState<HeaderDraft>(emptyHeader)
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()])
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState<{ header: FieldErrors<HeaderField>; lines: Map<number, FieldErrors<LineField>> }>({
    header: {},
    lines: new Map(),
  })
  const [result, setResult] = useState<ResultState>({ kind: 'idle' })
  const [version, setVersion] = useState(0)
  const [highlight, setHighlight] = useState<number | undefined>()
  const attempt = useRef<Attempt | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setHeader(emptyHeader())
    setLines([emptyLine()])
    setShowErrors(false)
    setServerErrors({ header: {}, lines: new Map() })
  }, [])

  const switchCompany = (o: Option<CompanyOption> | null) => {
    if (!o || o.key === company?.id) return
    setCompany(o.item)
    reset()
    setResult({ kind: 'idle' })
    setHighlight(undefined)
  }

  const validation = useMemo(() => validate(header, lines), [header, lines])
  const purpose = resolvePurpose(header, lines)
  const headerErrors = { ...(showErrors ? validation.header : {}), ...serverErrors.header }
  const lineErrors = lines.map((_, i) => ({ ...(showErrors ? validation.lines[i] : {}), ...serverErrors.lines.get(i) }))

  const editHeader = (patch: Partial<HeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setServerErrors((s) => ({ ...s, header: {} }))
  }
  const editLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))
    setServerErrors((s) => {
      if (!s.lines.has(index)) return s
      const next = new Map(s.lines)
      next.delete(index)
      return { ...s, lines: next }
    })
  }

  const submit = async (dryRun: boolean) => {
    if (!client) return
    setShowErrors(true)
    if (!validation.ok) return
    const { body, lineIndex } = toInput(header, lines)
    const text = JSON.stringify(body)
    // A retry of the same request after an unknown outcome reuses its key, so it cannot be recorded
    // twice. Anything else is a new request with a new key.
    const prior = attempt.current
    const key = !dryRun && prior && prior.retryable && prior.body === text ? prior.key : crypto.randomUUID()
    if (!dryRun) attempt.current = { body: text, key, retryable: false }
    setServerErrors({ header: {}, lines: new Map() })
    setResult({ kind: 'working', dryRun })
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    try {
      const outcome = await client.postAllocation(body, {
        dryRun,
        idempotencyKey: key,
        onPending: (requestId) => setResult({ kind: 'working', dryRun, requestId }),
      })
      setResult({ kind: 'done', outcome })
      if (!dryRun) {
        attempt.current = null
        setVersion((v) => v + 1)
        setHighlight(outcome.result.document.recordNumber)
        reset()
      }
    } catch (err) {
      const banner = bannerFor(err)
      if (!dryRun && attempt.current) attempt.current.retryable = !!banner.retrySameKey
      setServerErrors(fieldErrorsFor(err, lineIndex))
      setResult({ kind: 'failed', dryRun, banner })
    }
  }

  const working = result.kind === 'working'
  const invalidCount = showErrors ? Object.keys(validation.header).length + validation.lines.reduce((n, e) => n + Object.keys(e).length, 0) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">Twinn</span>
          <span className="brand-sep" aria-hidden="true" />
          <span className="brand-app">Sage 100 Contractor API example</span>
        </div>
        <div className="topbar-right">
          {companies?.mock ? (
            <span className="pill pill-amber" title="MOCK=1: fictional data served by the local backend">
              Sample data
            </span>
          ) : null}
          <div className="company">
            <Combobox
              label="Company"
              hideLabel
              required
              testId="company"
              value={company ? companyOption(company) : null}
              onChange={switchCompany}
              fetchPage={companyPages}
              placeholder="Choose a company"
              alignEnd
            />
          </div>
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <h1>Inventory Allocation</h1>
          <p className="subtitle">
            Sage 100 Contractor menu 12-2, read and written through the Twinn REST API.
          </p>
        </div>

        {companiesError ? (
          <section className="card banner banner-error" role="alert">
            <h2>The backend is not answering</h2>
            <p>{companiesError}. Start it with npm run dev, or npm run dev:mock for sample data.</p>
          </section>
        ) : null}

        {client ? (
          <>
            <HeaderCard client={client} header={header} errors={headerErrors} resolvedPurpose={purpose} onChange={editHeader} />
            <LinesCard
              client={client}
              lines={lines}
              errors={lineErrors}
              stockVersion={version}
              locationNames={locationNames}
              onChange={editLine}
              onAdd={() => setLines((ls) => [...ls, emptyLine()])}
              onRemove={(i) => {
                setLines((ls) => ls.filter((_, j) => j !== i))
                setServerErrors((s) => ({ ...s, lines: new Map() }))
              }}
            />
            <div className="actions">
              <p className="actions-note" role="status">
                {invalidCount
                  ? `${invalidCount} ${invalidCount === 1 ? 'field needs' : 'fields need'} attention.`
                  : validation.form[0] && showErrors
                    ? validation.form[0]
                    : 'Validate is a dry run: nothing is saved.'}
              </p>
              <button type="button" className="btn btn-secondary" disabled={working} onClick={() => submit(true)}>
                Validate only
              </button>
              <button type="button" className="btn btn-primary" disabled={working} onClick={() => submit(false)}>
                {working && !(result.kind === 'working' && result.dryRun) ? 'Saving' : 'Save allocation'}
              </button>
            </div>
            <div ref={resultRef}>
              <ResultPanel state={result} locationNames={locationNames} onRetry={() => submit(false)} />
            </div>
            <RecentAllocations client={client} version={version} highlight={highlight} locationNames={locationNames} />
          </>
        ) : null}
      </main>

      <footer className="foot">
        <span>
          An example app. API reference at <a href="https://twinn.engineering/developers">twinn.engineering/developers</a>.
        </span>
      </footer>
    </div>
  )
}
