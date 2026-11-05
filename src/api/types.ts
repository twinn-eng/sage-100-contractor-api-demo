// Short names for the generated API types.

import type { components } from './schema'

type S = components['schemas']

export type Part = S['Part']
export type InventoryLocation = S['InventoryLocation']
export type InventoryQuantity = S['InventoryQuantity']
export type Job = S['Job']
export type JobPhase = S['JobPhase']
export type LedgerAccount = S['LedgerAccount']
export type LedgerSubaccount = S['LedgerSubaccount']
export type CostCode = S['CostCode']
export type CostType = S['CostType']
export type InventoryAllocation = S['InventoryAllocation']
export type InventoryAllocationInput = S['InventoryAllocationInput']
export type InventoryAllocationLineInput = S['InventoryAllocationLineInput']
export type InventoryAllocationWriteResult = S['InventoryAllocationWriteResult']
export type AllocationPurpose = S['AllocationPurpose']
export type AllocationStatus = S['InventoryAllocationStatus']
export type FilterNode = S['FilterNode']
export type QueryRequest = S['QueryRequestBase'] & { children?: string[] }
export type PageResponse = S['PageResponse']
export type MatchRequest = S['MatchRequest']
export type Problem = S['Problem']
export type ErrorCode = S['ErrorCode']
export type RequestStatus = S['RequestStatus']

export interface QueryResponse<T> {
  asOf: string
  page: PageResponse
  data: T[]
}

export interface MatchResponse<T> {
  asOf: string
  data: (T & { distance: number })[]
}
