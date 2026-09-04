import { describe, it, expect } from 'vitest';
import {
  formatDateIso,
  getCurrentFiscalYearRange,
  getCurrentMonthRange,
  getLastDaysRange,
  getThaiFiscalYear,
  getFiscalYearRange,
  getRecentFiscalYears,
  getFiscalMonthRange,
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

  it('calculates specific fiscal year range for any year (e.g. 2568, 2569)', () => {
    const fy2568 = getFiscalYearRange(2568, true);
    expect(fy2568.dstart).toBe('2024-10-01');
    expect(fy2568.dend).toBe('2025-09-30');

    const fy2569Full = getFiscalYearRange(2569, true);
    expect(fy2569Full.dstart).toBe('2025-10-01');
    expect(fy2569Full.dend).toBe('2026-09-30');
  });

  it('generates recent fiscal years list in descending order', () => {
    const years = getRecentFiscalYears(4, new Date(2026, 8, 4));
    expect(years).toEqual([2569, 2568, 2567, 2566]);
  });

  it('calculates fiscal month range properly across year boundary', () => {
    // Month 1 of FY 2569 is October 2025
    const oct = getFiscalMonthRange(2569, 1);
    expect(oct.dstart).toBe('2025-10-01');
    expect(oct.dend).toBe('2025-10-31');

    // Month 4 of FY 2569 is January 2026
    const jan = getFiscalMonthRange(2569, 4);
    expect(jan.dstart).toBe('2026-01-01');
    expect(jan.dend).toBe('2026-01-31');

    // Month 12 of FY 2569 is September 2026
    const sep = getFiscalMonthRange(2569, 12);
    expect(sep.dstart).toBe('2026-09-01');
    expect(sep.dend).toBe('2026-09-30');
  });

  it('calculates last 30 days range correctly', () => {
    const range = getLastDaysRange(30, new Date(2026, 8, 4));
    expect(range.dend).toBe('2026-09-04');
    expect(new Date(range.dstart).getTime()).toBeLessThan(new Date(range.dend).getTime());
  });
});
