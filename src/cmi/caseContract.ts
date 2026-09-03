/**
 * CMI-Dashboard Domain Contracts for DRG Optimization
 * Reused from CMI-Dashboard/src/types/cmi.ts
 */

export interface CmiCaseRow {
  an?: string;
  hn?: string;
  ptname?: string | null;
  sex: string | null;
  age: number | null;
  los: number | null;
  dchtype: string | null;
  dchstts: string | null;
  drg?: string | null;
  mdc?: string | null;
  rw?: number | null;
  adjrw?: number | null;
  grouperErr?: string | null;
  pdx: string | null;
  sdx1: string | null;
  sdx2: string | null;
  sdx3: string | null;
  sdx4: string | null;
  extCause: string | null;
  proc1: string | null;
  proc2: string | null;
  proc3: string | null;
  admdate?: string;
  dchdate?: string;
  income?: number;
  ucMoney?: number;
  paidMoney?: number;
  remainMoney?: number;
}

export interface UsageLite {
  hosGuid: string | null;
  an?: string;
  icode: string | null;
  itemName: string | null;
  needOrderReason: string | null;
  prescReason: string | null;
  prescReason2: string | null;
  prescReason3: string | null;
  prescReason4: string | null;
  prescReason5: string | null;
  incomeName?: string | null;
  sumPrice?: number | null;
  qty?: number | null;
  unitPrice?: number | null;
}
