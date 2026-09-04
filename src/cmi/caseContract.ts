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
  /** Normalized diagnosis list used by the optimizer and audit layer. */
  sdx?: string[];
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
  proc13?: string | null;
  proc14?: string | null;
  proc15?: string | null;
  proc16?: string | null;
  proc17?: string | null;
  proc18?: string | null;
  proc19?: string | null;
  proc20?: string | null;
  proc21?: string | null;
  proc22?: string | null;
  proc23?: string | null;
  proc24?: string | null;
  proc25?: string | null;
  proc26?: string | null;
  proc27?: string | null;
  proc28?: string | null;
  proc29?: string | null;
  proc30?: string | null;
  /** Normalized procedure list used by the optimizer and audit layer. */
  proc?: string[];
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
  scheme?: PayerScheme | 'all';
  search?: string;
  pageSize?: number;
  cursor?: string;
  sort?: 'dchdate' | 'adjrw' | 'an';
  direction?: 'asc' | 'desc';
  /** Backward-compatible aliases accepted at the service boundary. */
  limit?: number;
  offset?: number;
}

export type PayerScheme = 'ucs' | 'ofc' | 'sss' | 'other';

export interface CaseCursor {
  sortValue: string | number | null;
  an: string;
}

export interface CasePageResult {
  items: CmiCaseRow[];
  nextCursor: string | null;
  hasMore: boolean;
  count: number | null;
  /** Backward-compatible alias used by the original UI. */
  totalCount: number | null;
  summary: CaseSummary;
  fetchedAt: string;
}

export interface CaseSummary {
  total: number;
  uncoded: number;
  coded: number;
  totalAdjrw: number;
  averageCmi: number;
  totalIncome: number;
  estimatedRevenue: number | null;
  revenueRateLabel: string | null;
}

export type QueryRegistryKey =
  | 'casePage'
  | 'caseCount'
  | 'worklistSummary'
  | 'caseDetail'
  | 'usagePage'
  | 'caseExport';
