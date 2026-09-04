// Port 1:1 จาก DRGSeeker web/assets/app.js :: buildPayload + validateCaseInput ranges
import {
  DRG_API_BASE,
  DRG_VERSION,
  MAX_SDX,
  MAX_PROC,
  DEFAULT_HCODE,
  type DrgCalculationResponse,
  type DrgCalculationRequest,
} from './grouperContract';

export { DRG_API_BASE, DRG_VERSION, MAX_SDX, MAX_PROC, DEFAULT_HCODE };

export interface DrgCaseInput {
  hcode: string;
  sex: 1 | 2;
  age: number;
  ageDay: number;
  weight: number;
  losDay: number;
  losHour: number;
  dcCode: string;
  pdx: string;
  sdx: string[];
  proc: string[];
  baseRate?: number;
}

export const DRG_REQUEST_TIMEOUT_MS = 20_000;

function createRequestSignal(parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Grouper request timed out', 'TimeoutError')), DRG_REQUEST_TIMEOUT_MS);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
  }
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\./g, '');
}

function validateCodeList(codes: string[], label: string, procedure = false): string[] {
  const normalized = codes.map(normalizeCode);
  const pattern = procedure ? /^\d{3,8}$/ : /^[A-Z0-9]{3,8}$/;
  if (normalized.some((code) => !pattern.test(code))) {
    throw new Error(`${label} มีรูปแบบรหัสไม่ถูกต้อง`);
  }
  return normalized;
}

export function buildDrgPayload(v: DrgCaseInput): DrgCalculationRequest {
  if (!v || !Array.isArray(v.sdx) || !Array.isArray(v.proc)) {
    throw new Error('ข้อมูลเคสไม่ครบ');
  }

  const hcode = String(v.hcode || '').trim();
  const pdx = normalizeCode(String(v.pdx || ''));

  if (!/^\d{5}$/.test(hcode) || !/^[A-Z0-9]{3,8}$/.test(pdx)) {
    throw new Error('รหัส HCode หรือ PDx ไม่ถูกต้อง');
  }

  if (v.sex !== 1 && v.sex !== 2) throw new Error('เพศของเคสไม่ถูกต้อง');

  const numbersToCheck = [v.age, v.ageDay, v.losDay, v.losHour, v.weight];
  if (v.baseRate !== undefined) {
    numbersToCheck.push(v.baseRate);
  }

  if (!numbersToCheck.every(Number.isFinite)) {
    throw new Error('ค่าตัวเลขของเคสไม่ถูกต้อง');
  }

  if (
    !Number.isInteger(v.age) ||
    v.age < 0 ||
    v.age > 120 ||
    !Number.isInteger(v.ageDay) ||
    v.ageDay < 0 ||
    v.ageDay > 364 ||
    !Number.isInteger(v.losDay) ||
    v.losDay < 0 ||
    v.losDay > 9999 ||
    !Number.isInteger(v.losHour) ||
    v.losHour < 0 ||
    v.losHour > 23 ||
    v.weight < 0 ||
    v.weight > 300 ||
    (v.baseRate !== undefined && (v.baseRate < 0 || v.baseRate > 1e7))
  ) {
    throw new Error('ค่าตัวเลขของเคสอยู่นอกช่วงที่รองรับ');
  }

  if (v.sdx.length > MAX_SDX) {
    throw new Error(`SDx เกิน ${MAX_SDX} รายการ`);
  }

  if (v.proc.length > MAX_PROC) {
    throw new Error(`Proc เกิน ${MAX_PROC} รายการ`);
  }

  const sdx = validateCodeList(v.sdx, 'SDx');
  const proc = validateCodeList(v.proc, 'Procedure', true);

  const dc = /^\d{2}$/.test(String(v.dcCode || '')) ? String(v.dcCode) : '11';

  return {
    version: DRG_VERSION,
    data: [
      {
        hcode,
        hn: '',
        an: '1',
        sex: v.sex === 2 ? 2 : 1,
        age: v.age,
        age_day: v.ageDay,
        los_day: v.losDay,
        los_hour: v.losHour,
        weight: v.weight,
        dischs: dc.charAt(0),
        discht: dc.charAt(1) || '1',
        pdx,
        sdx,
        proc,
      },
    ],
  };
}

export async function calculateDrg(
  payload: unknown,
  signal?: AbortSignal,
): Promise<DrgCalculationResponse> {
  // ยิงตรงเท่านั้น — ห้ามผ่าน CORS proxy (กติกาความปลอดภัยเดียวกับ DRGSeeker)
  const res = await fetch(`${DRG_API_BASE}/drg/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: createRequestSignal(signal),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Grouper ไม่ตอบกลับ JSON ที่อ่านได้ (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const status = json && typeof json === 'object' && 'status' in json ? String((json as { status?: unknown }).status) : String(res.status);
    throw new Error(`Grouper ไม่ตอบกลับผลลัพธ์ (status ${status})`);
  }

  if (!json || typeof json !== 'object') {
    throw new Error(`Grouper ไม่ตอบกลับผลลัพธ์ (status ${res.status})`);
  }

  const response = json as Partial<DrgCalculationResponse>;
  if (Number(response.status) !== 200) {
    throw new Error(
      `Grouper ไม่ตอบกลับผลลัพธ์ (status ${response.status ?? res.status})`,
    );
  }

  if (!Array.isArray(response.data)) {
    throw new Error('Grouper ตอบกลับ data ไม่ใช่รายการ');
  }

  const r = response.data[0];
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.drg == null || String(r.drg).trim() === '') {
    throw new Error('Grouper ไม่ส่งผลลัพธ์ DRG กลับมา');
  }
  for (const field of ['rw', 'adjrw'] as const) {
    const value = r[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Grouper ส่งค่า ${field} ไม่ถูกต้อง`);
    }
  }
  for (const field of ['wtlos', 'ot'] as const) {
    const value = r[field];
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`Grouper ส่งค่า ${field} ไม่ถูกต้อง`);
    }
  }

  return response as DrgCalculationResponse;
}
