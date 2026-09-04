/**
 * Dynamic Date Utilities for Thai Hospital Inpatient System & DRG Grouper
 * Avoids hardcoded date ranges and supports dynamic Thai Fiscal Year calculations.
 */

/**
 * Format a Date object to 'YYYY-MM-DD' in local timezone.
 */
export function formatDateIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate the Thai Buddhist Era fiscal year (e.g. Oct 2025 - Sep 2026 = 2569).
 */
export function getThaiFiscalYear(refDate: Date = new Date()): number {
  const year = refDate.getFullYear();
  const month = refDate.getMonth() + 1; // 1-12
  // If month is October (10), November (11), December (12), it belongs to next fiscal year
  const fyCe = month >= 10 ? year + 1 : year;
  return fyCe + 543;
}

export interface DateRangeResult {
  dstart: string;
  dend: string;
  label?: string;
}

/**
 * Get dynamic range for current Thai fiscal year (from Oct 1 to today).
 */
export function getCurrentFiscalYearRange(refDate: Date = new Date()): DateRangeResult {
  const year = refDate.getFullYear();
  const month = refDate.getMonth() + 1;
  const startYear = month >= 10 ? year : year - 1;
  const dstart = `${startYear}-10-01`;
  const dend = formatDateIso(refDate);
  const fyBe = getThaiFiscalYear(refDate);

  return {
    dstart,
    dend,
    label: `ปีงบประมาณ ${fyBe} (ถึงปัจจุบัน)`,
  };
}

/**
 * Get full range for current Thai fiscal year (from Oct 1 to Sep 30 of fiscal year).
 */
export function getFullFiscalYearRange(refDate: Date = new Date()): DateRangeResult {
  const year = refDate.getFullYear();
  const month = refDate.getMonth() + 1;
  const startYear = month >= 10 ? year : year - 1;
  const endYear = startYear + 1;
  const dstart = `${startYear}-10-01`;
  const dend = `${endYear}-09-30`;
  const fyBe = getThaiFiscalYear(refDate);

  return {
    dstart,
    dend,
    label: `ปีงบประมาณ ${fyBe} (เต็มปี)`,
  };
}

/**
 * Get dynamic range for current calendar month (from 1st of month to today).
 */
export function getCurrentMonthRange(refDate: Date = new Date()): DateRangeResult {
  const year = refDate.getFullYear();
  const month = String(refDate.getMonth() + 1).padStart(2, '0');
  const dstart = `${year}-${month}-01`;
  const dend = formatDateIso(refDate);

  return {
    dstart,
    dend,
    label: 'เดือนปัจจุบัน',
  };
}

/**
 * Get dynamic range for the past N days up to today.
 */
export function getLastDaysRange(days: number, refDate: Date = new Date()): DateRangeResult {
  const end = new Date(refDate);
  const start = new Date(refDate);
  start.setDate(start.getDate() - days);

  return {
    dstart: formatDateIso(start),
    dend: formatDateIso(end),
    label: `${days} วันล่าสุด`,
  };
}

/**
 * Get dynamic range for previous Thai fiscal year (full 12 months: Oct 1 - Sep 30).
 */
export function getPreviousFiscalYearRange(refDate: Date = new Date()): DateRangeResult {
  const currentFyRange = getCurrentFiscalYearRange(refDate);
  const currentStartYear = Number(currentFyRange.dstart.slice(0, 4));
  const prevStartYear = currentStartYear - 1;
  const dstart = `${prevStartYear}-10-01`;
  const dend = `${currentStartYear}-09-30`;
  const fyBe = getThaiFiscalYear(refDate) - 1;

  return {
    dstart,
    dend,
    label: `ปีงบประมาณ ${fyBe}`,
  };
}
