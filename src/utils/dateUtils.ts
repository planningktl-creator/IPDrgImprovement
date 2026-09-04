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
  const currentFy = getThaiFiscalYear(refDate);
  return getFiscalYearRange(currentFy - 1, true, refDate);
}

export interface FiscalMonthInfo {
  fiscalMonth: number; // 1 to 12
  calendarMonth: number; // 1 to 12 (10=Oct, 11=Nov, 12=Dec, 1=Jan, ..., 9=Sep)
  name: string; // 'ต.ค.', 'พ.ย.', etc.
  fullName: string;
  quarter: number; // 1 to 4
}

export const THAI_FISCAL_MONTHS: FiscalMonthInfo[] = [
  { fiscalMonth: 1, calendarMonth: 10, name: 'ต.ค.', fullName: 'ตุลาคม', quarter: 1 },
  { fiscalMonth: 2, calendarMonth: 11, name: 'พ.ย.', fullName: 'พฤศจิกายน', quarter: 1 },
  { fiscalMonth: 3, calendarMonth: 12, name: 'ธ.ค.', fullName: 'ธันวาคม', quarter: 1 },
  { fiscalMonth: 4, calendarMonth: 1, name: 'ม.ค.', fullName: 'มกราคม', quarter: 2 },
  { fiscalMonth: 5, calendarMonth: 2, name: 'ก.พ.', fullName: 'กุมภาพันธ์', quarter: 2 },
  { fiscalMonth: 6, calendarMonth: 3, name: 'มี.ค.', fullName: 'มีนาคม', quarter: 2 },
  { fiscalMonth: 7, calendarMonth: 4, name: 'เม.ย.', fullName: 'เมษายน', quarter: 3 },
  { fiscalMonth: 8, calendarMonth: 5, name: 'พ.ค.', fullName: 'พฤษภาคม', quarter: 3 },
  { fiscalMonth: 9, calendarMonth: 6, name: 'มิ.ย.', fullName: 'มิถุนายน', quarter: 3 },
  { fiscalMonth: 10, calendarMonth: 7, name: 'ก.ค.', fullName: 'กรกฎาคม', quarter: 4 },
  { fiscalMonth: 11, calendarMonth: 8, name: 'ส.ค.', fullName: 'สิงหาคม', quarter: 4 },
  { fiscalMonth: 12, calendarMonth: 9, name: 'ก.ย.', fullName: 'กันยายน', quarter: 4 },
];

/**
 * Get date range for a specific Thai Fiscal Year (e.g. 2568, 2569).
 */
export function getFiscalYearRange(
  yearBe: number,
  fullYear: boolean = true,
  refDate: Date = new Date(),
): DateRangeResult {
  const startCe = yearBe - 544;
  const endCe = yearBe - 543;
  const dstart = `${startCe}-10-01`;

  const isCurrentFy = yearBe === getThaiFiscalYear(refDate);
  if (!fullYear && isCurrentFy) {
    return {
      dstart,
      dend: formatDateIso(refDate),
      label: `ปีงบประมาณ ${yearBe} (ถึงปัจจุบัน)`,
    };
  }

  return {
    dstart,
    dend: `${endCe}-09-30`,
    label: `ปีงบประมาณ ${yearBe} (เต็มปี)`,
  };
}

/**
 * Get list of recent Thai fiscal years for selection dropdowns.
 */
export function getRecentFiscalYears(count: number = 5, refDate: Date = new Date()): number[] {
  const currentFy = getThaiFiscalYear(refDate);
  const years: number[] = [];
  for (let i = 0; i < count; i++) {
    years.push(currentFy - i);
  }
  return years;
}

/**
 * Get date range for a specific month in a Thai fiscal year (fiscalMonth 1 = Oct ... 12 = Sep).
 */
export function getFiscalMonthRange(yearBe: number, fiscalMonth: number): DateRangeResult {
  const mInfo = THAI_FISCAL_MONTHS.find((m) => m.fiscalMonth === fiscalMonth);
  if (!mInfo) {
    throw new Error(`Invalid fiscal month: ${fiscalMonth}. Must be 1 to 12.`);
  }

  const isLastQuarterOfPrevYear = mInfo.calendarMonth >= 10;
  const yearCe = isLastQuarterOfPrevYear ? yearBe - 544 : yearBe - 543;
  const monthStr = String(mInfo.calendarMonth).padStart(2, '0');
  const dstart = `${yearCe}-${monthStr}-01`;

  // Calculate last day of month
  const lastDay = new Date(yearCe, mInfo.calendarMonth, 0).getDate();
  const dend = `${yearCe}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  return {
    dstart,
    dend,
    label: `${mInfo.fullName} ${yearBe}`,
  };
}
