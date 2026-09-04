import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getCachedCaseDetail,
  setCachedCaseDetail,
  getCachedUsageItems,
  setCachedUsageItems,
  getCachedWorklistPage,
  setCachedWorklistPage,
  invalidateCaseCache,
  clearCmiCache,
  getCmiCacheStats,
  CASE_DETAIL_TTL_MS,
  USAGE_ITEMS_TTL_MS,
  WORKLIST_PAGE_TTL_MS,
  MAX_CASE_DETAIL_ENTRIES,
} from '@/services/cmiCache';
import type { CmiCaseRow, UsageLite, CasePageResult } from '@/cmi/caseContract';

const mockCase: CmiCaseRow = {
  an: '690012345',
  hn: '00***99',
  ptname: 'นาย ท*** ส***',
  pdx: 'J189',
  sex: 'ชาย',
  age: 60,
  los: 3,
  dchtype: '1',
  dchstts: '1',
  income: 15000,
};

const mockUsage: UsageLite[] = [
  {
    hosGuid: 'GUID-1',
    an: '690012345',
    icode: '1001',
    itemName: 'Meropenem',
    needOrderReason: 'Sepsis A419',
    prescReason: 'A419',
    prescReason2: null,
    prescReason3: null,
    prescReason4: null,
    prescReason5: null,
    incomeName: 'ยา',
    sumPrice: 1200,
    qty: 1,
    unitPrice: 1200,
  },
];

const mockPageResult: CasePageResult = {
  items: [mockCase],
  nextCursor: null,
  hasMore: false,
  count: 1,
  totalCount: 1,
  summary: {
    total: 1,
    uncoded: 0,
    coded: 1,
    totalAdjrw: 1.25,
    averageCmi: 1.25,
    totalIncome: 15000,
    estimatedRevenue: 10000,
    revenueRateLabel: 'UCS',
  },
  fetchedAt: '2026-09-04T12:00:00Z',
};

describe('cmiCache (Zero-Leak In-Memory Query Cache)', () => {
  beforeEach(() => {
    clearCmiCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    clearCmiCache();
    vi.useRealTimers();
  });

  it('stores and retrieves case detail within TTL', () => {
    expect(getCachedCaseDetail('690012345', 'scope-1')).toBeNull();

    setCachedCaseDetail('690012345', 'scope-1', mockCase);
    const cached = getCachedCaseDetail('690012345', 'scope-1');

    expect(cached).toEqual(mockCase);
    expect(getCmiCacheStats().caseDetails).toBe(1);
  });

  it('enforces scope isolation (zero cross-tenant or cross-session leakage)', () => {
    setCachedCaseDetail('690012345', 'hosp-10929:session-abc', mockCase);

    // Same AN under a different session or hospital must NOT get the cached data
    expect(getCachedCaseDetail('690012345', 'hosp-10929:session-xyz')).toBeNull();
    expect(getCachedCaseDetail('690012345', 'demo')).toBeNull();
    expect(getCachedCaseDetail('690012345', 'hosp-99999:session-abc')).toBeNull();

    // Querying under the matching scope succeeds
    expect(getCachedCaseDetail('690012345', 'hosp-10929:session-abc')).toEqual(mockCase);
  });

  it('expires case detail entries after TTL', () => {
    vi.useFakeTimers();
    setCachedCaseDetail('690012345', 'scope-1', mockCase);

    expect(getCachedCaseDetail('690012345', 'scope-1')).not.toBeNull();

    // Advance past TTL (5 minutes)
    vi.advanceTimersByTime(CASE_DETAIL_TTL_MS + 1000);

    expect(getCachedCaseDetail('690012345', 'scope-1')).toBeNull();
  });

  it('stores and retrieves usage items with page size and scope', () => {
    setCachedUsageItems('690012345', 'scope-1', 300, mockUsage);

    expect(getCachedUsageItems('690012345', 'scope-1', 300)).toEqual(mockUsage);
    // Different page size must not collide
    expect(getCachedUsageItems('690012345', 'scope-1', 100)).toBeNull();
  });

  it('expires usage items entries after TTL', () => {
    vi.useFakeTimers();
    setCachedUsageItems('690012345', 'scope-1', 300, mockUsage);

    expect(getCachedUsageItems('690012345', 'scope-1', 300)).not.toBeNull();

    vi.advanceTimersByTime(USAGE_ITEMS_TTL_MS + 1000);
    expect(getCachedUsageItems('690012345', 'scope-1', 300)).toBeNull();
  });

  it('stores and retrieves worklist pages with TTL', () => {
    vi.useFakeTimers();
    const queryKey = JSON.stringify({ dstart: '2026-08-01', dend: '2026-08-31' });

    setCachedWorklistPage(queryKey, 'scope-1', mockPageResult);
    expect(getCachedWorklistPage(queryKey, 'scope-1')).toEqual(mockPageResult);

    vi.advanceTimersByTime(WORKLIST_PAGE_TTL_MS + 1000);
    expect(getCachedWorklistPage(queryKey, 'scope-1')).toBeNull();
  });

  it('invalidates case cache by AN across scopes or by specific scope', () => {
    setCachedCaseDetail('690012345', 'scope-A', mockCase);
    setCachedCaseDetail('690012345', 'scope-B', mockCase);
    setCachedCaseDetail('700099999', 'scope-A', { ...mockCase, an: '700099999' });

    invalidateCaseCache('690012345', 'scope-A');
    expect(getCachedCaseDetail('690012345', 'scope-A')).toBeNull();
    // scope-B still present
    expect(getCachedCaseDetail('690012345', 'scope-B')).not.toBeNull();
    // other AN untouched
    expect(getCachedCaseDetail('700099999', 'scope-A')).not.toBeNull();

    // Invalidate without scope removes from all scopes
    invalidateCaseCache('690012345');
    expect(getCachedCaseDetail('690012345', 'scope-B')).toBeNull();
  });

  it('clearCmiCache wipes everything from memory immediately', () => {
    setCachedCaseDetail('1001', 'scope-1', mockCase);
    setCachedUsageItems('1001', 'scope-1', 300, mockUsage);
    setCachedWorklistPage('query-1', 'scope-1', mockPageResult);

    expect(getCmiCacheStats()).toEqual({ caseDetails: 1, usageItems: 1, worklistPages: 1 });

    clearCmiCache();

    expect(getCmiCacheStats()).toEqual({ caseDetails: 0, usageItems: 0, worklistPages: 0 });
    expect(getCachedCaseDetail('1001', 'scope-1')).toBeNull();
    expect(getCachedUsageItems('1001', 'scope-1', 300)).toBeNull();
    expect(getCachedWorklistPage('query-1', 'scope-1')).toBeNull();
  });

  it('evicts oldest entries when capacity limit is reached (LRU)', () => {
    for (let i = 0; i < MAX_CASE_DETAIL_ENTRIES + 10; i++) {
      setCachedCaseDetail(`an-${i}`, 'scope-1', { ...mockCase, an: `an-${i}` });
    }

    expect(getCmiCacheStats().caseDetails).toBeLessThanOrEqual(MAX_CASE_DETAIL_ENTRIES);
    // Oldest entry (an-0) should have been evicted
    expect(getCachedCaseDetail('an-0', 'scope-1')).toBeNull();
    // Most recent entry should exist
    expect(getCachedCaseDetail(`an-${MAX_CASE_DETAIL_ENTRIES + 9}`, 'scope-1')).not.toBeNull();
  });
});
