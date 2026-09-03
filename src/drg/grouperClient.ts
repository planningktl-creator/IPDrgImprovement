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

export function buildDrgPayload(v: DrgCaseInput): DrgCalculationRequest {
  if (!v || !Array.isArray(v.sdx) || !Array.isArray(v.proc)) {
    throw new Error('ข้อมูลเคสไม่ครบ');
  }

  const hcode = String(v.hcode || '').trim();
  const pdx = String(v.pdx || '').trim().toUpperCase();

  if (!/^\d{5}$/.test(hcode) || !/^[A-Z0-9]+$/.test(pdx)) {
    throw new Error('รหัส HCode หรือ PDx ไม่ถูกต้อง');
  }

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

  const dc = /^\d{2}$/.test(String(v.dcCode || '')) ? String(v.dcCode) : '11';

  return {
    version: DRG_VERSION,
    data: [
      {
        hcode,
        hn: '',
        an: '1',
        sex: v.sex,
        age: v.age,
        age_day: v.ageDay,
        los_day: v.losDay,
        los_hour: v.losHour,
        weight: v.weight,
        dischs: dc.charAt(0),
        discht: dc.charAt(1) || '1',
        pdx,
        sdx: [...v.sdx],
        proc: [...v.proc],
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
    signal,
  });

  const json = (await res.json()) as DrgCalculationResponse;
  if (!json || Number(json?.status) !== 200) {
    throw new Error(
      `Grouper ไม่ตอบกลับผลลัพธ์ (status ${json?.status ?? res.status})`,
    );
  }

  const r = Array.isArray(json.data) ? json.data[0] : null;
  if (!r || r.drg == null || String(r.drg).trim() === '') {
    throw new Error('Grouper ไม่ส่งผลลัพธ์ DRG กลับมา');
  }

  return json;
}
