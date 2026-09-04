import type { CmiCaseRow, PayerScheme } from '@/cmi/caseContract';

export interface PayerRateConfig {
  scheme: Exclude<PayerScheme, 'other'>;
  label: string;
  baseRate: number;
  effectiveFrom: string;
  effectiveTo?: string;
  matchTokens: string[];
}

export interface ResolvedPayerRate {
  scheme: PayerRateConfig['scheme'];
  label: string;
  baseRate: number;
  source: 'runtime-config';
}

function readRuntimeRates(): PayerRateConfig[] {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.VITE_REIMBURSEMENT_RATES_JSON?.trim();

  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const rates = parsed.filter((item): item is PayerRateConfig => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Partial<PayerRateConfig>;
      return (
        (value.scheme === 'ucs' || value.scheme === 'ofc' || value.scheme === 'sss') &&
        typeof value.label === 'string' &&
        Number.isFinite(value.baseRate) &&
        Number(value.baseRate) >= 0 &&
        typeof value.effectiveFrom === 'string' &&
        Array.isArray(value.matchTokens)
      );
    });
    return validatePayerRateConfig(rates).length === 0 ? rates : [];
  } catch {
    return [];
  }
}

export function getPayerRateConfig(mode: 'runtime' | 'demo' = 'runtime'): PayerRateConfig[] {
  const runtimeRates = readRuntimeRates();
  return mode === 'runtime' || mode === 'demo' ? runtimeRates : [];
}

function isDateInRange(date: string | undefined, rate: PayerRateConfig): boolean {
  if (!date) return true;
  const dischargeDate = date.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/i)?.[1];
  if (!dischargeDate) return false;
  if (dischargeDate < rate.effectiveFrom) return false;
  if (rate.effectiveTo && dischargeDate > rate.effectiveTo) return false;
  return true;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolvePayerRate(
  row: Pick<CmiCaseRow, 'pttype' | 'pttypeName' | 'dchdate'>,
  rates: PayerRateConfig[] = getPayerRateConfig(),
): ResolvedPayerRate | null {
  const searchText = `${row.pttype ?? ''} ${row.pttypeName ?? ''}`.toLowerCase();
  const matched = rates.find(
    (rate) =>
      isDateInRange(row.dchdate, rate) &&
      rate.matchTokens.some((token) => searchText.includes(token.toLowerCase())),
  );

  return matched
    ? {
        scheme: matched.scheme,
        label: matched.label,
        baseRate: matched.baseRate,
        source: 'runtime-config',
      }
    : null;
}

export function validatePayerRateConfig(rates: PayerRateConfig[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  rates.forEach((rate, index) => {
    if (!rate.effectiveFrom || !isIsoDate(rate.effectiveFrom)) {
      errors.push(`รายการที่ ${index + 1}: effectiveFrom ไม่ใช่วันที่ ISO`);
    }
    if (rate.effectiveTo && !isIsoDate(rate.effectiveTo)) {
      errors.push(`รายการที่ ${index + 1}: effectiveTo ไม่ใช่วันที่ ISO`);
    } else if (rate.effectiveTo && rate.effectiveTo < rate.effectiveFrom) {
      errors.push(`รายการที่ ${index + 1}: effectiveTo ก่อน effectiveFrom`);
    }
    if (typeof rate.label !== 'string' || !rate.label.trim()) errors.push(`รายการที่ ${index + 1}: label ห้ามว่าง`);
    if (!Array.isArray(rate.matchTokens) || rate.matchTokens.length === 0 || rate.matchTokens.some((token) => typeof token !== 'string' || !token.trim())) {
      errors.push(`รายการที่ ${index + 1}: matchTokens ไม่ถูกต้อง`);
    }
    if (!Number.isFinite(rate.baseRate) || rate.baseRate < 0) {
      errors.push(`รายการที่ ${index + 1}: baseRate ไม่ถูกต้อง`);
    }

    const key = `${rate.scheme}:${rate.effectiveFrom}:${rate.effectiveTo ?? ''}`;
    if (seen.has(key)) errors.push(`รายการที่ ${index + 1}: rate ซ้ำกัน`);
    seen.add(key);
  });

  for (let i = 0; i < rates.length; i += 1) {
    for (let j = i + 1; j < rates.length; j += 1) {
      const left = rates[i];
      const right = rates[j];
      if (left.scheme !== right.scheme) continue;
      const leftEnd = left.effectiveTo ?? '9999-12-31';
      const rightEnd = right.effectiveTo ?? '9999-12-31';
      if (left.effectiveFrom <= rightEnd && right.effectiveFrom <= leftEnd) {
        errors.push(`ช่วงเวลา rate ของ ${left.scheme.toUpperCase()} ทับซ้อนกัน`);
      }
    }
  }

  return [...new Set(errors)];
}

export function calculateEstimatedRevenue(adjrw: number | null | undefined, rate: ResolvedPayerRate | null): number | null {
  if (rate === null || !Number.isFinite(adjrw)) return null;
  return Math.round((adjrw ?? 0) * rate.baseRate);
}
