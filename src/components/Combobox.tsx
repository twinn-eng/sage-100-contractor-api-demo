// A searchable dropdown whose options come from the server one page at a time.
//
// Follows the WAI-ARIA combobox pattern: the input owns a listbox, the active option is announced
// through aria-activedescendant, and focus never leaves the input. Keys: Down/Up move, Enter picks,
// Escape closes, Page Down/Page Up change page, Home/End jump within the page.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { FetchPage, Option, Page } from '../lib/paging'

export interface ComboboxProps<T> {
  label: string
  value: Option<T> | null
  onChange: (option: Option<T> | null) => void
  fetchPage: FetchPage<T>
  placeholder?: string
  disabled?: boolean
  required?: boolean
  error?: string
  hint?: ReactNode
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean
  /** Open the list towards the left, for fields at the right edge. */
  alignEnd?: boolean
  debounceMs?: number
  testId?: string
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const display = (o: Option | null) => (o ? `${o.number}  ${o.name}`.trim() : '')

export function Combobox<T>({
  label,
  value,
  onChange,
  fetchPage,
  placeholder = 'Search or browse',
  disabled,
  required,
  error,
  hint,
  hideLabel,
  alignEnd,
  debounceMs = 250,
  testId,
}: ComboboxProps<T>) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [loaded, setLoaded] = useState<{ key: string; fetcher: FetchPage<T>; page: Page<T> | null; error: string | null } | null>(null)
  const [active, setActive] = useState(-1)
  const search = useDebounced(text, debounceMs)

  // A new search starts again at page 1.
  const [lastSearch, setLastSearch] = useState(search)
  if (search !== lastSearch) {
    setLastSearch(search)
    setPageNumber(1)
  }

  const requestKey = `${search}\u0000${pageNumber}`
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    fetchPage(search, pageNumber, ctrl.signal)
      .then((p) => {
        if (ctrl.signal.aborted) return
        setLoaded({ key: requestKey, fetcher: fetchPage, page: p, error: null })
        setActive(p.options.length ? 0 : -1)
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setLoaded({ key: requestKey, fetcher: fetchPage, page: null, error: e instanceof Error ? e.message : 'Could not load' })
      })
    return () => ctrl.abort()
  }, [open, search, pageNumber, fetchPage, requestKey])

  // While a page loads, the previous one stays on screen (dimmed) so the list does not jump.
  const fresh = !!loaded && loaded.key === requestKey && loaded.fetcher === fetchPage
  const loading = open && !fresh
  const page = loaded?.fetcher === fetchPage ? loaded.page : null
  const loadError = fresh ? loaded.error : null

  const openList = () => {
    if (disabled || open) return
    setText('')
    setPageNumber(1)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setText('')
    setActive(-1)
  }

  const pick = (o: Option<T>) => {
    onChange(o)
    close()
  }

  const go = (n: number) => {
    if (n < 1 || (n > pageNumber && !page?.hasMore)) return
    setPageNumber(n)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const count = page?.options.length ?? 0
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) openList()
        else setActive((a) => Math.min(a + 1, count - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
        break
      case 'Home':
        if (open && count) {
          e.preventDefault()
          setActive(0)
        }
        break
      case 'End':
        if (open && count) {
          e.preventDefault()
          setActive(count - 1)
        }
        break
      case 'PageDown':
        if (open) {
          e.preventDefault()
          go(pageNumber + 1)
        }
        break
      case 'PageUp':
        if (open) {
          e.preventDefault()
          go(pageNumber - 1)
        }
        break
      case 'Enter':
        if (open) {
          e.preventDefault()
          const o = page?.options[active]
          if (o) pick(o)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          close()
        }
        break
      case 'Tab':
        close()
        break
    }
  }

  const totalPages = page?.totalCount !== undefined ? Math.max(1, Math.ceil(page.totalCount / page.pageSize)) : undefined
  const status = loading
    ? 'Loading'
    : loadError
      ? loadError
      : page
        ? page.totalCount !== undefined
          ? `Page ${page.pageNumber} of ${totalPages}, ${page.totalCount} ${page.totalCount === 1 ? 'record' : 'records'}`
          : `Page ${page.pageNumber} of best matches`
        : ''

  return (
    <div className={`field cb${open ? ' cb-open' : ''}`} data-testid={testId}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
        {required && !hideLabel ? <span className="req" aria-hidden="true"> *</span> : null}
      </label>
      <div className="cb-anchor">
      <div className={`cb-control${error ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={!!error || undefined}
          aria-required={required || undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={value ? display(value) : placeholder}
          value={open ? text : display(value)}
          onChange={(e) => {
            setText(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={openList}
          onClick={openList}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        {value && !disabled && !required ? (
          <button
            type="button"
            className="cb-clear"
            aria-label={`Clear ${label}`}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(null)
              close()
            }}
          >
            ×
          </button>
        ) : null}
        <span className="cb-caret" aria-hidden="true" />
      </div>
      {open ? (
        <div className={`cb-pop${alignEnd ? ' end' : ''}`} onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={label} aria-busy={loading || undefined} className="cb-list">
            {page?.options.map((o, i) => (
              <li
                key={o.key}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`cb-opt${i === active ? ' active' : ''}${value?.key === o.key ? ' current' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.number ? <span className="cb-num">{o.number}</span> : null}
                <span className="cb-name">
                  {o.name}
                  {o.detail ? <span className="cb-detail">{o.detail}</span> : null}
                </span>
              </li>
            ))}
            {!loading && page && page.options.length === 0 ? (
              <li className="cb-empty" role="presentation">
                {search ? `Nothing matches "${search}"` : 'No records'}
              </li>
            ) : null}
          </ul>
          <div className="cb-foot">
            <span className="cb-status" role="status" aria-live="polite">
              {status}
            </span>
            <span className="cb-pager">
              <button type="button" tabIndex={-1} disabled={loading || pageNumber <= 1} onClick={() => go(pageNumber - 1)} aria-label="Previous page">
                Prev
              </button>
              <button type="button" tabIndex={-1} disabled={loading || !page?.hasMore} onClick={() => go(pageNumber + 1)} aria-label="Next page">
                Next
              </button>
            </span>
          </div>
        </div>
      ) : null}
      </div>
      {error ? (
        <p id={`${id}-msg`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
