import type { DrgCaseInput } from '@/drg/grouperClient';
import type { CmiCaseRow } from './caseContract';
import { MAX_PROC, MAX_SDX } from '@/drg/grouperContract';

export const cleanCode = (s: string | null | undefined): string =>
  (s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function normalizeCode(value: string | null | undefined, label: 'PDx' | 'SDx' | 'Procedure'): string {
  const raw = (value ?? '').trim().toUpperCase();
  if (!raw) return '';
  const normalized = cleanCode(raw);
  const allowed = label === 'Procedure' ? /^\d{3,8}$/ : /^[A-Z0-9]{3,8}$/;
  if (!/^[A-Z0-9.]+$/.test(raw) || !allowed.test(normalized)) {
    throw new Error(`${label} มีรูปแบบรหัสไม่ถูกต้อง`);
  }
  return normalized;
}

export interface CmiAdapterOptions {
  hcode: string;
  dcCodeFallback?: string;
  weightFallback?: number;
  ageDayFallback?: number;
  losHourFallback?: number;
  baseRate?: number;
}

/**
 * Convert a CMI-Dashboard / Worklist CaseDetail row into a DrgCaseInput for the MOPH Grouper.
 * Supports up to 12 secondary diagnoses (sdx1..sdx12) and 30 procedures (proc1..proc30).
 */
export function cmiCaseToDrgInput(
  row: CmiCaseRow,
  opts: CmiAdapterOptions,
): DrgCaseInput {
  const pdx = normalizeCode(row.pdx, 'PDx');
  if (!pdx) {
    throw new Error('เคสนี้ยังไม่ลง PDx — ต้องมี PDx ก่อนเรียก Grouper');
  }

  const rawSdx = (row.sdx ?? [
    row.sdx1,
    row.sdx2,
    row.sdx3,
    row.sdx4,
    row.sdx5,
    row.sdx6,
    row.sdx7,
    row.sdx8,
    row.sdx9,
    row.sdx10,
    row.sdx11,
    row.sdx12,
  ])
    .map((code) => normalizeCode(code, 'SDx'))
    .filter((c) => Boolean(c) && c !== pdx);
  const sdx = [...new Set(rawSdx)];
  if (sdx.length > MAX_SDX) throw new Error(`SDx เกิน ${MAX_SDX} รายการ`);

  const rawProc = (row.proc ?? Array.from({ length: MAX_PROC }, (_, index) => row[`proc${index + 1}` as keyof CmiCaseRow]))
    .map((code) => normalizeCode(code as string | null | undefined, 'Procedure'))
    .filter(Boolean);
  const proc = [...new Set(rawProc)];
  if (proc.length > MAX_PROC) throw new Error(`Procedure เกิน ${MAX_PROC} รายการ`);

  const sexText = (row.sex || '').trim().toLowerCase();
  const sex: 1 | 2 = ['หญิง', 'female', 'f', '2'].includes(sexText)
    ? 2
    : ['ชาย', 'male', 'm', '1'].includes(sexText)
      ? 1
      : (() => { throw new Error('เพศของเคสไม่ครบหรือไม่อยู่ในรูปแบบที่รองรับ'); })();
  if (!Number.isInteger(row.los) || (row.los as number) < 0) throw new Error('วันนอนของเคสไม่ครบหรือไม่ถูกต้อง');
  const losDay = row.los as number;

  const dchTypeChar = (row.dchtype || '').trim().charAt(0) || '1';
  const dchSttsChar = (row.dchstts || '').trim().charAt(0) || '1';
  const dcCombined = `${dchTypeChar}${dchSttsChar}`;
  const dcCode = /^\d{2}$/.test(dcCombined)
    ? dcCombined
    : (opts.dcCodeFallback ?? '11');

  if (!Number.isInteger(row.age) || (row.age as number) < 0) throw new Error('อายุของเคสไม่ครบหรือไม่ถูกต้อง');
  const age = row.age as number;

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
