// What each dropdown reads, and how a record is shown in it.

import type {
  CostCode,
  CostType,
  InventoryLocation,
  Job,
  JobPhase,
  LedgerAccount,
  LedgerSubaccount,
  Part,
} from '../api/types'
import type { Lookup } from './paging'

export const parts: Lookup<Part> = {
  entity: 'parts',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'partCode', 'partName', 'partUnit', 'averageCost'],
  matchFields: ['partName', 'partCode'],
  orderBy: ['recordNumber'],
  toOption: (p) => ({
    key: String(p.recordNumber),
    number: String(p.recordNumber),
    name: p.partName ?? '',
    detail: [p.partCode, p.partUnit].filter(Boolean).join(' · '),
    item: p,
  }),
}

export const locations: Lookup<InventoryLocation> = {
  entity: 'inventory-locations',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'locationName'],
  matchFields: ['locationName'],
  orderBy: ['recordNumber'],
  toOption: (l) => ({ key: String(l.recordNumber), number: String(l.recordNumber), name: l.locationName ?? '', item: l }),
}

export const jobs: Lookup<Job> = {
  entity: 'jobs',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'jobName', 'shortName'],
  matchFields: ['jobName', 'shortName'],
  orderBy: ['recordNumber'],
  toOption: (j) => ({ key: String(j.recordNumber), number: String(j.recordNumber), name: j.jobName || j.shortName || '', item: j }),
}

/** Phases are rows of a job, so the dropdown is scoped to the chosen job. */
export const phases: Lookup<JobPhase> = {
  entity: 'job-phases',
  numberField: 'phaseNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'phaseNumber', 'phaseName'],
  matchFields: ['phaseName'],
  orderBy: ['phaseNumber'],
  toOption: (p) => ({ key: `${p.recordNumber}/${p.phaseNumber}`, number: String(p.phaseNumber ?? ''), name: p.phaseName ?? '', item: p }),
}

export const accounts: Lookup<LedgerAccount> = {
  entity: 'ledger-accounts',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'longName', 'shortName', 'subsidiaryType'],
  matchFields: ['longName', 'shortName'],
  orderBy: ['recordNumber'],
  toOption: (a) => ({ key: String(a.recordNumber), number: String(a.recordNumber), name: a.longName || a.shortName || '', item: a }),
}

/** Subaccounts partition one account, so the dropdown is scoped to the line's account. */
export const subaccounts: Lookup<LedgerSubaccount> = {
  entity: 'ledger-subaccounts',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'longName', 'shortName', 'controlAccount'],
  matchFields: ['longName', 'shortName'],
  orderBy: ['recordNumber'],
  toOption: (s) => ({
    key: `${s.controlAccount}/${s.recordNumber}`,
    number: String(s.recordNumber),
    name: s.longName || s.shortName || '',
    item: s,
  }),
}

export const costCodes: Lookup<CostCode> = {
  entity: 'cost-codes',
  numberField: 'recordNumber',
  numberKind: 'decimal',
  select: ['id', 'recordNumber', 'codeName'],
  matchFields: ['codeName'],
  orderBy: ['recordNumber'],
  toOption: (c) => ({ key: String(c.recordNumber), number: String(c.recordNumber), name: c.codeName ?? '', item: c }),
}

export const costTypes: Lookup<CostType> = {
  entity: 'cost-types',
  numberField: 'recordNumber',
  numberKind: 'integer',
  select: ['id', 'recordNumber', 'costTypeName'],
  matchFields: ['costTypeName'],
  orderBy: ['recordNumber'],
  toOption: (c) => ({ key: String(c.recordNumber), number: String(c.recordNumber), name: c.costTypeName ?? '', item: c }),
}
