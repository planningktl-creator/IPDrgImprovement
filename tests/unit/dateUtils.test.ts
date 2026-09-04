import { describe, it, expect } from 'vitest';
import {
  formatDateIso,
  getCurrentFiscalYearRange,
  getCurrentMonthRange,
  getLastDaysRange,
  getThaiFiscalYear,
} from '@/utils/dateUtils';

describe('dateUtils', () => {
  it('formats Date to YYYY-MM-DD in local time', () => {
    const d = new Date(2026, 8, 4); // September 4, 2026
    expect(formatDateIso(d)).toBe('2026-09-04');
  });

  it('calculates Thai fiscal year accurately', () => {
    // September 2026 is in FY 2026 (BE 2569)
    expect(getThaiFiscalYear(new Date(2026, 8, 4))).toBe(2569);
    // October 2026 is in FY 2027 (BE 2570)
    expect(getThaiFiscalYear(new Date(2026, 9, 1))).toBe(2570);
  });

  it('calculates current fiscal year range without hardcoding', () => {
    const range = getCurrentFiscalYearRange(new Date(2026, 8, 4));
    expect(range.dstart).toBe('2025-10-01');
    expect(range.dend).toBe('2026-09-04');
  });

  it('calculates current month range without hardcoding', () => {
    const range = getCurrentMonthRange(new Date(2026, 8, 4));
    expect(range.dstart).toBe('2026-09-01');
    expect(range.dend).toBe('2026-09-04');
  });

  it('calculates last 30 days range', () => {
    const range = getLastDaysRange(30, new Date(2026, 8, 4));
    expect(range.dend).toBe('2026-09-04');
    expect(new Date(range.dstart).getTime()).toBeLessThan(new Date(range.dend).getTime());
  });
});
