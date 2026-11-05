// Turns an API problem into a banner and field messages the form can show next to the inputs.

import { ApiError } from '../api/client'
import type { FieldErrors, HeaderField, LineField } from './allocation'

export interface Banner {
  tone: 'error' | 'warning'
  title: string
  message: string
  /** The API's own `detail`, naming the record or field. */
  detail?: string
  code?: string
  correlationId?: string
  /** True when sending the same request again, with the same key, is the right move. */
  retrySameKey?: boolean
}

/** What each code means for the person at the screen. Codes not listed fall back to the API's text. */
const MESSAGES: Record<string, { title: string; message?: string; tone?: Banner['tone'] }> = {
  INSUFFICIENT_INVENTORY: {
    title: 'Not enough stock at the source location',
    message: 'A line asks for more than is available there. Lower the quantity, pick another location, or save it as Open or Review.',
  },
  COST_LAYERS_SHORT: {
    title: 'Not enough stock in the cost layers',
    message: 'The company values inventory by FIFO or LIFO and its layers hold less of this part than the line takes.',
  },
  FIELD_REQUIRED: { title: 'Something required is missing' },
  FIELD_INVALID: { title: 'A value was not accepted' },
  RECORD_NOT_FOUND: { title: 'A record was not found in Sage' },
  PERIOD_CLOSED: {
    title: 'That posting period is closed',
    message: 'Choose a date in an open period, or ask your accountant to open the period in Sage.',
  },
  PERIOD_UNRESOLVED: { title: 'No posting period for that date', message: 'Choose a date inside the fiscal year set up in Sage.' },
  EQUIPMENT_COST_INVALID: { title: 'Equipment accounts are not supported here', message: 'Use a job, expense or inventory account.' },
  COMPANY_READ_ONLY: { title: 'This company is read only', message: 'The company is set up for reading only, so nothing was written.' },
  COMPANY_LOCKED: { title: 'The company is busy', message: 'Sage maintenance is running or someone has the company open exclusively. Try again shortly.', tone: 'warning' },
  RATE_LIMITED: { title: 'Too many requests', message: 'Wait a few seconds and try again.', tone: 'warning' },
  IDEMPOTENCY_KEY_REUSED: { title: 'This request was already sent with different content', message: 'Save again to send it as a new request.' },
  IDEMPOTENCY_KEY_IN_FLIGHT: { title: 'This allocation is still being saved', message: 'Wait a moment, then save again to see the outcome.', tone: 'warning' },
  UPSTREAM_TIMEOUT: {
    title: 'Sage did not answer in time',
    message: 'The outcome is unknown. Save again: the request is sent with the same idempotency key, so it cannot be recorded twice.',
    tone: 'warning',
  },
  OUTCOME_UNKNOWN: {
    title: 'The outcome is unknown',
    message: 'Save again: the request is sent with the same idempotency key, so it cannot be recorded twice.',
    tone: 'warning',
  },
  REQUEST_EXPIRED: { title: 'The request was not started in time', message: 'The Sage connection was unavailable, and nothing was written. Try again.', tone: 'warning' },
  UNAUTHORIZED: { title: 'The API key was refused', message: 'Check the key configured for this company on the server.' },
  SERVICE_DISABLED: { title: 'This API key is switched off', message: 'Contact Twinn to turn it back on.' },
}

/** Field messages by code, shown under the input that caused them. */
const FIELD_MESSAGES: Record<string, string> = {
  FIELD_REQUIRED: 'Required.',
  FIELD_INVALID: 'Not accepted by the API.',
  INSUFFICIENT_INVENTORY: 'More than is available at the source.',
  COST_LAYERS_SHORT: 'More than the cost layers hold.',
  RECORD_NOT_FOUND: 'Not found in Sage.',
  SUBACCOUNT_REQUIRED: 'This account needs a subaccount.',
  EQUIPMENT_COST_INVALID: 'Equipment accounts are not supported.',
}

const RETRY_SAME_KEY = new Set(['UPSTREAM_TIMEOUT', 'OUTCOME_UNKNOWN', 'IDEMPOTENCY_KEY_IN_FLIGHT'])

export function bannerFor(err: unknown): Banner {
  if (err instanceof ApiError) {
    const known = MESSAGES[err.code]
    const retrySameKey = RETRY_SAME_KEY.has(err.code) || err.status === 504
    return {
      tone: known?.tone ?? (retrySameKey ? 'warning' : 'error'),
      title: known?.title ?? err.problem.title ?? 'The request failed',
      message: known?.message ?? (err.problem.detail ? '' : 'The API refused the request.'),
      detail: err.problem.detail,
      code: err.code,
      correlationId: err.problem.correlationId,
      retrySameKey,
    }
  }
  return {
    tone: 'warning',
    title: 'The server could not be reached',
    message: 'Check your connection and save again. The same idempotency key is reused, so nothing is recorded twice.',
    retrySameKey: true,
  }
}

const HEADER_FIELDS = new Set<string>(['ticketNumber', 'orderNumber', 'jobNumber', 'phaseNumber', 'transactionDate', 'status', 'description', 'purpose', 'deliveryVia'])

/**
 * Binds a problem's `errors[]` to the form. `lines[2].quantity` is the third line *sent*; blank
 * form lines are not sent, so `lineIndex` maps it back to the form's own row.
 */
export function fieldErrorsFor(err: unknown, lineIndex: number[]) {
  const header: FieldErrors<HeaderField> = {}
  const lines = new Map<number, FieldErrors<LineField>>()
  if (!(err instanceof ApiError)) return { header, lines }
  for (const item of err.problem.errors ?? []) {
    const message = FIELD_MESSAGES[item.code] ?? 'Not accepted by the API.'
    const m = item.field.match(/^lines\[(\d+)\]\.(\w+)$/)
    if (m) {
      const row = lineIndex[Number(m[1])] ?? Number(m[1])
      lines.set(row, { ...lines.get(row), [m[2] as LineField]: message })
    } else if (HEADER_FIELDS.has(item.field)) {
      header[item.field as HeaderField] = message
    }
  }
  return { header, lines }
}
