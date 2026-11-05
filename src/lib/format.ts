const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
const unit = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))

export const fmtMoney = (v: string | number | null | undefined) => {
  const x = n(v)
  return x === null || isNaN(x) ? '' : money.format(x)
}

export const fmtUnitCost = (v: string | number | null | undefined) => {
  const x = n(v)
  return x === null || isNaN(x) ? '' : unit.format(x)
}

export const fmtQty = (v: string | number | null | undefined) => {
  const x = n(v)
  return x === null || isNaN(x) ? '' : quantity.format(x)
}

/** A signed movement, such as +4 or -12. */
export const fmtDelta = (v: string | number | null | undefined) => {
  const x = n(v)
  if (x === null || isNaN(x)) return ''
  return x > 0 ? `+${quantity.format(x)}` : quantity.format(x)
}

export const fmtDate = (iso: string | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
