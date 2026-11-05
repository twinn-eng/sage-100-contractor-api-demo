import { describe, expect, it } from 'vitest'
import { ApiError, codeFromType } from '../api/client'
import { bannerFor, fieldErrorsFor } from './errors'

const insufficient = new ApiError(
  422,
  {
    type: 'https://twinn.engineering/errors/insufficient-inventory',
    title: 'Not enough inventory',
    status: 422,
    detail: 'part 1001 at location 1: 60 requested, 34 available',
    errors: [{ field: 'lines[0].quantity', code: 'INSUFFICIENT_INVENTORY' }],
  },
  'INSUFFICIENT_INVENTORY',
)

describe('error mapping', () => {
  it('reads the code from the header, or from the problem type', () => {
    expect(insufficient.code).toBe('INSUFFICIENT_INVENTORY')
    expect(codeFromType('https://twinn.engineering/errors/period-closed')).toBe('PERIOD_CLOSED')
    expect(new ApiError(422, { type: 'https://twinn.engineering/errors/period-closed', title: 'x', status: 422 }).code).toBe('PERIOD_CLOSED')
  })

  it('turns a known code into a banner that keeps the API detail', () => {
    const b = bannerFor(insufficient)
    expect(b).toMatchObject({ tone: 'error', title: 'Not enough stock at the source location', code: 'INSUFFICIENT_INVENTORY' })
    expect(b.detail).toContain('34 available')
    expect(b.retrySameKey).toBe(false)
  })

  it('binds field errors to the form row each sent line came from', () => {
    const { lines, header } = fieldErrorsFor(insufficient, [2])
    expect(lines.get(2)).toEqual({ quantity: 'More than is available at the source.' })
    expect(header).toEqual({})
    const required = new ApiError(400, { type: 'about:blank', title: 'x', status: 400, errors: [{ field: 'description', code: 'FIELD_REQUIRED' }] })
    expect(fieldErrorsFor(required, []).header).toEqual({ description: 'Required.' })
  })

  it('treats a timeout or a dropped connection as retry with the same key', () => {
    const timeout = new ApiError(504, { type: 'https://twinn.engineering/errors/upstream-timeout', title: 'x', status: 504 })
    expect(bannerFor(timeout).retrySameKey).toBe(true)
    expect(bannerFor(new TypeError('Failed to fetch')).retrySameKey).toBe(true)
  })
})
