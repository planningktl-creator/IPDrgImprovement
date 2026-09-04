import { describe, expect, it } from 'vitest';
import { calculateEstimatedRevenue, resolvePayerRate, validatePayerRateConfig, type PayerRateConfig } from '@/config/reimbursementRates';

const rates: PayerRateConfig[] = [
  { scheme: 'ucs', label: 'UCS', baseRate: 8350, effectiveFrom: '2026-01-01', effectiveTo: '2026-09-30', matchTokens: ['ucs', 'บัตรทอง'] },
  { scheme: 'ofc', label: 'OFC', baseRate: 7500, effectiveFrom: '2026-01-01', matchTokens: ['ofc', 'ข้าราชการ'] },
];

describe('reimbursement rate configuration', () => {
  it('resolves payer and effective date without a silent UCS fallback', () => {
    expect(resolvePayerRate({ pttypeName: 'บัตรทอง', dchdate: '2026-05-12' }, rates)?.baseRate).toBe(8350);
    expect(resolvePayerRate({ pttypeName: 'บัตรทอง', dchdate: '2025-12-31' }, rates)).toBeNull();
    expect(resolvePayerRate({ pttypeName: 'ประกันสังคม', dchdate: '2026-05-12' }, rates)).toBeNull();
    expect(resolvePayerRate({ pttypeName: 'บัตรทอง', dchdate: '2026-09-30T23:59:59.000Z' }, rates)?.baseRate).toBe(8350);
  });

  it('rejects duplicate and overlapping effective periods', () => {
    const errors = validatePayerRateConfig([
      ...rates,
      { ...rates[0], effectiveFrom: '2026-06-01' },
      { ...rates[1] },
    ]);
    expect(errors.some((error) => /ทับซ้อน/.test(error))).toBe(true);
    expect(errors.some((error) => /ซ้ำ/.test(error))).toBe(true);
  });

  it('rejects malformed end dates and empty matching tokens', () => {
    const errors = validatePayerRateConfig([{ ...rates[0], effectiveTo: 'not-a-date', matchTokens: [''] }]);
    expect(errors.some((error) => /effectiveTo/.test(error))).toBe(true);
    expect(errors.some((error) => /matchTokens/.test(error))).toBe(true);
  });

  it('calculates only when a resolved rate exists', () => {
    expect(calculateEstimatedRevenue(1.2345, { scheme: 'ucs', label: 'UCS', baseRate: 8350, source: 'runtime-config' })).toBe(10308);
    expect(calculateEstimatedRevenue(1.2345, null)).toBeNull();
  });
});
