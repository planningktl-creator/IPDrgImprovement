import type { DrgCaseInput } from '@/drg/grouperClient';
import type { CmiCaseRow } from './caseContract';

export const cleanCode = (s: string | null | undefined): string =>
  (s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface CmiAdapterOptions {
  hcode: string;
  dcCodeFallback?: string;
  weightFallback?: number;
  ageDayFallback?: number;
  losHourFallback?: number;
  baseRate?: number;
}

/**
 * Convert a CMI-Dashboard CaseDetail row into a DrgCaseInput for the MOPH Grouper.
 */
export function cmiCaseToDrgInput(
  row: CmiCaseRow,
  opts: CmiAdapterOptions,
): DrgCaseInput {
  const pdx = cleanCode(row.pdx);
  if (!pdx) {
    throw new Error('เคสนี้ยังไม่ลง PDx — ต้องมี PDx ก่อนเรียก Grouper');
  }

  const rawSdx = [row.sdx1, row.sdx2, row.sdx3, row.sdx4]
    .map(cleanCode)
    .filter((c) => Boolean(c) && c !== pdx);
  const sdx = [...new Set(rawSdx)];

  const rawProc = [row.proc1, row.proc2, row.proc3]
    .map(cleanCode)
    .filter(Boolean);
  const proc = [...new Set(rawProc)];

  const sex: 1 | 2 = /หญิง|2|F/i.test(row.sex || '') ? 2 : 1;
  const losDay =
    Number.isInteger(row.los) && (row.los as number) >= 0
      ? (row.los as number)
      : 1;

  const dchTypeChar = (row.dchtype || '').trim().charAt(0) || '1';
  const dchSttsChar = (row.dchstts || '').trim().charAt(0) || '1';
  const dcCombined = `${dchTypeChar}${dchSttsChar}`;
  const dcCode = /^\d{2}$/.test(dcCombined)
    ? dcCombined
    : (opts.dcCodeFallback ?? '11');

  const age =
    Number.isInteger(row.age) && (row.age as number) >= 0
      ? (row.age as number)
      : 0;

  return {
    hcode: opts.hcode,
    sex,
    age,
    ageDay: opts.ageDayFallback ?? 0,
    weight: opts.weightFallback ?? 0,
    losDay,
    losHour: opts.losHourFallback ?? 0,
    dcCode,
    pdx,
    sdx,
    proc,
    baseRate: opts.baseRate,
  };
}
