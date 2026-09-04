/**
 * CMI-Dashboard Domain Contracts for DRG Optimization & Case Registry
 * Reused and expanded from CMI-Dashboard/src/types/cmi.ts and Inpatient Worklist SQL
 */

export interface CmiCaseRow {
  an?: string;
  hn?: string;
  ptname?: string | null;
  sex: string | null;
  age: number | null;
  pttype?: string | null;
  pttypeName?: string | null;
  admdate?: string;
  dchdate?: string;
  los: number | null;
  dchtype: string | null;
  dchstts: string | null;
  firstWard?: string | null;
  firstWardName?: string | null;
  lastWard?: string | null;
  lastWardName?: string | null;
  yearMonth?: string | null;
  yearBe?: number | null;
  monthTh?: string | null;
  fiscalMonth?: number | null;
  drg?: string | null;
  mdc?: string | null;
  rw?: number | null;
  adjrw?: number | null;
  grouperErr?: string | null;
  pdx?: string | null;
  sdx1?: string | null;
  sdx2?: string | null;
  sdx3?: string | null;
  sdx4?: string | null;
  sdx5?: string | null;
  sdx6?: string | null;
  sdx7?: string | null;
  sdx8?: string | null;
  sdx9?: string | null;
  sdx10?: string | null;
  sdx11?: string | null;
  sdx12?: string | null;
  extCause?: string | null;
  proc1?: string | null;
  proc2?: string | null;
  proc3?: string | null;
  proc4?: string | null;
  proc5?: string | null;
  proc6?: string | null;
  proc7?: string | null;
  proc8?: string | null;
  proc9?: string | null;
  proc10?: string | null;
  proc11?: string | null;
  proc12?: string | null;
  income?: number;
  ucMoney?: number;
  paidMoney?: number;
  remainMoney?: number;
  remark?: string;
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

export interface WorklistQueryParams {
  dstart: string; // 'YYYY-MM-DD'
  dend: string;   // 'YYYY-MM-DD'
  ward?: string;
  statusFilter?: 'all' | 'uncoded' | 'coded';
  search?: string;
  limit?: number;
  offset?: number;
}
