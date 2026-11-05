import { describe, expect, it } from 'vitest'
import type { InventoryLocation, Job, LedgerAccount, Part } from '../api/types'
import { emptyHeader, emptyLine, lineKind, lineTotal, resolvePurpose, toInput, validate, validateLine, type LineDraft } from './allocation'

const part = { id: 'p', recordNumber: 1001, partName: '3/4in copper elbow', averageCost: '1.8600' } as Part
const main = { id: 'l1', recordNumber: 1, locationName: 'Main warehouse' } as InventoryLocation
const van = { id: 'l3', recordNumber: 3, locationName: 'Service van 1' } as InventoryLocation
const jobCost = { id: 'a', recordNumber: 5110, longName: 'Material costs, job' } as LedgerAccount
const job = { id: 'j', recordNumber: 2401, jobName: 'Harbor View Clinic' } as Job

const line = (patch: Partial<LineDraft>): LineDraft => ({ ...emptyLine(), part, quantity: '6', ...patch })

describe('two of source, destination and account', () => {
  it('names what each pair does', () => {
    expect(lineKind({ source: main, destination: null, account: jobCost })).toBe('issue')
    expect(lineKind({ source: main, destination: van, account: null })).toBe('transfer')
    expect(lineKind({ source: null, destination: van, account: jobCost })).toBe('return')
  })

  it('refuses fewer than two, flagging the empty ones', () => {
    expect(lineKind({ source: main, destination: null, account: null })).toBe('incomplete')
    const e = validateLine(line({ source: main }), 1, 'OTHER')
    expect(Object.keys(e).sort()).toEqual(['debitAccount', 'destinationLocation'])
    expect(validateLine(line({}), 1, 'OTHER')).toHaveProperty('sourceLocation')
  })

  it('refuses all three', () => {
    expect(lineKind({ source: main, destination: van, account: jobCost })).toBe('overfull')
    const e = validateLine(line({ source: main, destination: van, account: jobCost }), 1, 'OTHER')
    expect(Object.keys(e).sort()).toEqual(['debitAccount', 'destinationLocation', 'sourceLocation'])
  })

  it('accepts each valid pair', () => {
    expect(validateLine(line({ source: main, account: jobCost }), 1, 'OTHER')).toEqual({})
    expect(validateLine(line({ source: main, destination: van }), 1, 'OTHER')).toEqual({})
    expect(validateLine(line({ destination: van, account: jobCost, cost: '1.50' }), 1, 'OTHER')).toEqual({})
  })

  it('refuses a transfer to the same location', () => {
    expect(validateLine(line({ source: main, destination: main }), 1, 'OTHER')).toHaveProperty('destinationLocation')
  })
})

describe('other line rules', () => {
  it('needs a positive quantity and a part', () => {
    expect(validateLine(line({ source: main, account: jobCost, quantity: '0' }), 1, 'OTHER')).toHaveProperty('quantity')
    expect(validateLine(line({ source: main, account: jobCost, quantity: '-2' }), 1, 'OTHER')).toHaveProperty('quantity')
    expect(validateLine(line({ source: main, account: jobCost, part: null }), 1, 'OTHER')).toHaveProperty('partNumber')
  })

  it('needs a cost on a return only', () => {
    expect(validateLine(line({ destination: van, account: jobCost }), 1, 'OTHER')).toHaveProperty('cost')
    expect(validateLine(line({ source: main, account: jobCost }), 1, 'OTHER')).not.toHaveProperty('cost')
  })

  it('needs cost code and type on a shipped job requisition', () => {
    const e = validateLine(line({ source: main, account: jobCost }), 4, 'JOB_REQUISITION')
    expect(Object.keys(e).sort()).toEqual(['costCode', 'costType'])
    expect(validateLine(line({ source: main, account: jobCost }), 3, 'JOB_REQUISITION')).toEqual({})
  })

  it('totals from average cost, or the typed cost on a return', () => {
    expect(lineTotal(line({ source: main, account: jobCost }))).toBe(11.16)
    expect(lineTotal(line({ destination: van, account: jobCost, cost: '2.005' }))).toBe(12.03)
  })
})

describe('the allocation', () => {
  it('requires ticket, description and a line, and ignores blank lines', () => {
    const v = validate(emptyHeader(), [emptyLine()])
    expect(v.ok).toBe(false)
    expect(Object.keys(v.header).sort()).toEqual(['description', 'ticketNumber'])
    expect(v.form).toEqual(['Add at least one line.'])
  })

  it('chooses the purpose from the job and the lines unless set', () => {
    const h = emptyHeader()
    expect(resolvePurpose(h, [line({ source: main, account: jobCost })])).toBe('OTHER')
    expect(resolvePurpose({ ...h, job }, [line({ source: main, account: jobCost })])).toBe('JOB_REQUISITION')
    expect(resolvePurpose({ ...h, job }, [line({ source: main, destination: van })])).toBe('LOCATION_TRANSFER')
    expect(resolvePurpose({ ...h, purpose: 'OTHER', job }, [line({ source: main, account: jobCost })])).toBe('OTHER')
  })

  it('builds the request body, skipping blank lines and remembering where each line came from', () => {
    const header = { ...emptyHeader(), ticketNumber: ' T-1 ', description: 'Rough-in', job, status: 4 as const, transactionDate: '2026-11-05' }
    const lines = [emptyLine(), line({ source: main, destination: van, account: null }), line({ destination: van, account: jobCost, cost: '1.50' })]
    const { body, lineIndex } = toInput(header, lines)
    expect(lineIndex).toEqual([1, 2])
    expect(body).toEqual({
      ticketNumber: 'T-1',
      transactionDate: '2026-11-05',
      status: 4,
      description: 'Rough-in',
      purpose: 'JOB_REQUISITION',
      jobNumber: 2401,
      lines: [
        { partNumber: 1001, quantity: '6', sourceLocation: 1, destinationLocation: 3 },
        { partNumber: 1001, quantity: '6', destinationLocation: 3, debitAccount: 5110, cost: '1.50' },
      ],
    })
  })
})
