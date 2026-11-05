// The form's model: header and lines as the user edits them, the checks made before anything is
// sent, and the request body built from them.

import type {
  AllocationPurpose,
  AllocationStatus,
  CostCode,
  CostType,
  InventoryAllocationInput,
  InventoryAllocationLineInput,
  InventoryLocation,
  Job,
  JobPhase,
  LedgerAccount,
  LedgerSubaccount,
  Part,
} from '../api/types'

export interface HeaderDraft {
  ticketNumber: string
  orderNumber: string
  job: Job | null
  phase: JobPhase | null
  transactionDate: string
  status: AllocationStatus
  description: string
  /** `null` lets the form choose from the lines. */
  purpose: AllocationPurpose | null
  deliveryVia: string
}

export interface LineDraft {
  key: string
  part: Part | null
  description: string
  unit: string
  quantity: string
  /** Sent only on a return; the server values issues and transfers itself. */
  cost: string
  source: InventoryLocation | null
  destination: InventoryLocation | null
  account: LedgerAccount | null
  subaccount: LedgerSubaccount | null
  costCode: CostCode | null
  costType: CostType | null
}

export type HeaderField = 'ticketNumber' | 'orderNumber' | 'jobNumber' | 'phaseNumber' | 'transactionDate' | 'status' | 'description' | 'purpose' | 'deliveryVia'
export type LineField =
  | 'partNumber'
  | 'quantity'
  | 'cost'
  | 'sourceLocation'
  | 'destinationLocation'
  | 'debitAccount'
  | 'debitSubAccount'
  | 'costCode'
  | 'costType'

export type FieldErrors<F extends string> = Partial<Record<F, string>>

export interface Validation {
  header: FieldErrors<HeaderField>
  lines: FieldErrors<LineField>[]
  form: string[]
  ok: boolean
}

export const STATUSES: { value: AllocationStatus; label: string; hint: string }[] = [
  { value: 1, label: '1 Open', hint: 'Records the allocation. Moves no stock.' },
  { value: 2, label: '2 Review', hint: 'Records it for review before shipping. Moves no stock.' },
  { value: 3, label: '3 Hold', hint: 'Reserves stock: lowers the quantity available at the source.' },
  { value: 4, label: '4 Shipped', hint: 'Moves stock, posts the journal and books job cost.' },
]

export const PURPOSES: { value: AllocationPurpose; label: string }[] = [
  { value: 'JOB_REQUISITION', label: 'Job requisition' },
  { value: 'LOCATION_TRANSFER', label: 'Location transfer' },
  { value: 'OTHER', label: 'Other (expense, shrinkage, return)' },
]

let seq = 0
export function emptyLine(): LineDraft {
  seq += 1
  return {
    key: `line-${seq}`,
    part: null,
    description: '',
    unit: '',
    quantity: '',
    cost: '',
    source: null,
    destination: null,
    account: null,
    subaccount: null,
    costCode: null,
    costType: null,
  }
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyHeader(): HeaderDraft {
  return {
    ticketNumber: '',
    orderNumber: '',
    job: null,
    phase: null,
    transactionDate: today(),
    status: 1,
    description: '',
    purpose: null,
    deliveryVia: '',
  }
}

export type LineKind = 'issue' | 'transfer' | 'return' | 'incomplete' | 'overfull'

/**
 * What a line does, from which two of Source, Destination and Account it fills in, as on Sage's
 * own grid: Source and Account is an issue (stock out to an expense or job), Source and
 * Destination a transfer between locations, Destination and Account a return into stock.
 */
export function lineKind(line: Pick<LineDraft, 'source' | 'destination' | 'account'>): LineKind {
  const n = Number(!!line.source) + Number(!!line.destination) + Number(!!line.account)
  if (n < 2) return 'incomplete'
  if (n > 2) return 'overfull'
  if (line.source && line.destination) return 'transfer'
  return line.source ? 'issue' : 'return'
}

export const KIND_LABEL: Record<LineKind, string> = {
  issue: 'Issue',
  transfer: 'Transfer',
  return: 'Return',
  incomplete: 'Pick two of source, destination, account',
  overfull: 'Use only two of source, destination, account',
}

export function isBlankLine(line: LineDraft): boolean {
  return !line.part && !line.quantity.trim() && !line.source && !line.destination && !line.account
}

/** Job requisition when the allocation names a job, transfer when every line is one, else other. */
export function resolvePurpose(header: HeaderDraft, lines: LineDraft[]): AllocationPurpose {
  if (header.purpose) return header.purpose
  const used = lines.filter((l) => !isBlankLine(l))
  if (used.length && used.every((l) => lineKind(l) === 'transfer')) return 'LOCATION_TRANSFER'
  return header.job ? 'JOB_REQUISITION' : 'OTHER'
}

const DECIMAL = /^\d+(\.\d+)?$/

export function validateLine(line: LineDraft, status: AllocationStatus, purpose: AllocationPurpose): FieldErrors<LineField> {
  const e: FieldErrors<LineField> = {}
  if (!line.part) e.partNumber = 'Choose a part.'
  const q = line.quantity.trim()
  if (!q) e.quantity = 'Enter a quantity.'
  else if (!DECIMAL.test(q) || Number(q) <= 0) e.quantity = 'Enter a quantity greater than zero.'
  const kind = lineKind(line)
  if (kind === 'incomplete') {
    const msg = 'Fill in two of source, destination and account.'
    if (!line.source) e.sourceLocation = msg
    if (!line.destination) e.destinationLocation = msg
    if (!line.account) e.debitAccount = msg
  } else if (kind === 'overfull') {
    const msg = 'Use only two of source, destination and account.'
    e.sourceLocation = msg
    e.destinationLocation = msg
    e.debitAccount = msg
  }
  if (kind === 'transfer' && line.source?.recordNumber === line.destination?.recordNumber) {
    e.destinationLocation = 'Destination must differ from source.'
  }
  if (kind === 'return') {
    const c = line.cost.trim()
    if (!c) e.cost = 'A return needs the unit cost it comes back at.'
    else if (!DECIMAL.test(c)) e.cost = 'Enter a cost such as 12.50.'
  }
  if (status === 4 && purpose === 'JOB_REQUISITION' && (kind === 'issue' || kind === 'return')) {
    if (!line.costCode) e.costCode = 'Required on a shipped job requisition.'
    if (!line.costType) e.costType = 'Required on a shipped job requisition.'
  }
  return e
}

export function validate(header: HeaderDraft, lines: LineDraft[]): Validation {
  const h: FieldErrors<HeaderField> = {}
  if (!header.ticketNumber.trim()) h.ticketNumber = 'Enter a ticket number.'
  if (!header.description.trim()) h.description = 'Enter a description.'
  if (!header.transactionDate) h.transactionDate = 'Choose a date.'
  const purpose = resolvePurpose(header, lines)
  if (purpose === 'JOB_REQUISITION' && !header.job) h.jobNumber = 'A job requisition needs a job.'
  const used = lines.map((l) => !isBlankLine(l))
  const lineErrors = lines.map((l, i) => (used[i] ? validateLine(l, header.status, purpose) : {}))
  const form: string[] = []
  if (!used.some(Boolean)) form.push('Add at least one line.')
  const ok = Object.keys(h).length === 0 && form.length === 0 && lineErrors.every((e) => Object.keys(e).length === 0)
  return { header: h, lines: lineErrors, form, ok }
}

/** The request body, plus which form line each sent line came from (blank lines are not sent). */
export function toInput(header: HeaderDraft, lines: LineDraft[]): { body: InventoryAllocationInput; lineIndex: number[] } {
  const lineIndex: number[] = []
  const sent: InventoryAllocationLineInput[] = []
  lines.forEach((l, i) => {
    if (isBlankLine(l)) return
    lineIndex.push(i)
    const kind = lineKind(l)
    const out: InventoryAllocationLineInput = {
      partNumber: l.part!.recordNumber,
      quantity: l.quantity.trim(),
    }
    if (l.description.trim()) out.partDescription = l.description.trim()
    if (l.unit.trim()) out.unitDescription = l.unit.trim()
    if (l.source) out.sourceLocation = l.source.recordNumber
    if (l.destination) out.destinationLocation = l.destination.recordNumber
    if (l.account && kind !== 'transfer') {
      out.debitAccount = l.account.recordNumber
      if (l.subaccount) out.debitSubAccount = l.subaccount.recordNumber
    }
    if (kind === 'return' && l.cost.trim()) out.cost = l.cost.trim()
    if (l.costCode) out.costCode = String(l.costCode.recordNumber)
    if (l.costType) out.costType = l.costType.recordNumber
    sent.push(out)
  })
  const body: InventoryAllocationInput = {
    ticketNumber: header.ticketNumber.trim(),
    transactionDate: header.transactionDate,
    status: header.status,
    description: header.description.trim(),
    purpose: resolvePurpose(header, lines),
    lines: sent,
  }
  if (header.orderNumber.trim()) body.orderNumber = header.orderNumber.trim()
  if (header.job) body.jobNumber = header.job.recordNumber
  if (header.job && header.phase?.phaseNumber) body.phaseNumber = header.phase.phaseNumber
  if (header.deliveryVia.trim()) body.deliveryVia = header.deliveryVia.trim()
  return { body, lineIndex }
}

/** Unit cost shown on the line: what was typed on a return, else the part's average cost. */
export function unitCost(line: LineDraft): number | null {
  if (lineKind(line) === 'return') return line.cost.trim() && DECIMAL.test(line.cost.trim()) ? Number(line.cost) : null
  const avg = line.part?.averageCost
  return avg !== undefined && avg !== null ? Number(avg) : null
}

export function lineTotal(line: LineDraft): number | null {
  const c = unitCost(line)
  const q = Number(line.quantity)
  if (c === null || !line.quantity.trim() || isNaN(q)) return null
  return Math.round(q * c * 100) / 100
}
