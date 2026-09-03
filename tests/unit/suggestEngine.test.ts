import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suggestHigherDrg } from '@/suggest/suggestEngine';
import type { DrgCaseInput } from '@/drg/grouperClient';
import * as grouperClient from '@/drg/grouperClient';

describe('suggestHigherDrg', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseCase: DrgCaseInput = {
    hcode: '10929',
    sex: 1,
    age: 60,
    ageDay: 0,
    weight: 0,
    losDay: 5,
    losHour: 0,
    dcCode: '11',
    pdx: 'J189',
    sdx: ['E119'],
    proc: [],
  };

  it('calculates baseline and ranks suggestions by descending positive delta AdjRW', async () => {
    // Mock calculateDrg to return different AdjRW based on payload
    vi.spyOn(grouperClient, 'calculateDrg').mockImplementation(async (payload: unknown) => {
      const p = payload as { data: Array<{ pdx: string; sdx: string[] }> };
      const item = p.data[0];

      // Baseline: pdx=J189, sdx=[E119]
      if (item.pdx === 'J189' && item.sdx.length === 1 && item.sdx[0] === 'E119') {
        return {
          status: 200,
          data: [{ drg: '04010', adjrw: 1.0, rw: 0.9, mdc: '04' }],
        };
      }

      // Add SDx I10 -> adjrw 1.5 (delta +0.5)
      if (item.pdx === 'J189' && item.sdx.includes('I10')) {
        return {
          status: 200,
          data: [{ drg: '04011', adjrw: 1.5, rw: 1.4, mdc: '04' }],
        };
      }

      // Swap PDx A419 -> adjrw 2.5 (delta +1.5)
      if (item.pdx === 'A419') {
        return {
          status: 200,
          data: [{ drg: '18010', adjrw: 2.5, rw: 2.2, mdc: '18' }],
        };
      }

      // Candidate with lower or equal AdjRW
      return {
        status: 200,
        data: [{ drg: '04010', adjrw: 0.8, rw: 0.7, mdc: '04' }],
      };
    });

    const result = await suggestHigherDrg(baseCase, ['A419', 'I10', 'K290']);

    expect(result.baseline.drg).toBe('04010');
    expect(result.baseline.adjrw).toBe(1.0);

    // Suggestions should only contain positive deltas, sorted descending
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(result.suggestions[0].pdx).toBe('A419');
    expect(result.suggestions[0].delta).toBe(1.5);
    expect(result.suggestions[0].adjrw).toBe(2.5);

    expect(result.suggestions[1].pdx).toBe('J189');
    expect(result.suggestions[1].delta).toBe(0.5);
    expect(result.suggestions[1].adjrw).toBe(1.5);
  });

  it('keeps SDx count <= 12 even when swapping or adding codes', async () => {
    const fullCase: DrgCaseInput = {
      ...baseCase,
      sdx: [
        'E119', 'I10', 'N183', 'K290', 'J449', 'M109',
        'F329', 'H259', 'E780', 'R05', 'R509', 'Z992',
      ], // 12 items
    };

    let maxSdxSeen = 0;
    vi.spyOn(grouperClient, 'calculateDrg').mockImplementation(async (payload: unknown) => {
      const p = payload as { data: Array<{ pdx: string; sdx: string[] }> };
      maxSdxSeen = Math.max(maxSdxSeen, p.data[0].sdx.length);
      return {
        status: 200,
        data: [{ drg: '04010', adjrw: 1.0, rw: 0.9 }],
      };
    });

    await suggestHigherDrg(fullCase, ['A419']);
    expect(maxSdxSeen).toBeLessThanOrEqual(12);
  });

  it('handles individual grouper failures gracefully without aborting remaining calculations', async () => {
    let callCount = 0;
    vi.spyOn(grouperClient, 'calculateDrg').mockImplementation(async (payload: unknown) => {
      callCount++;
      const p = payload as { data: Array<{ pdx: string }> };
      if (p.data[0].pdx === 'FAIL') {
        throw new Error('Grouper calculation error');
      }
      return {
        status: 200,
        data: [{ drg: '04010', adjrw: callCount === 1 ? 1.0 : 1.8 }],
      };
    });

    const result = await suggestHigherDrg(baseCase, ['FAIL', 'A419']);
    expect(result.suggestions.some((s) => s.pdx === 'A419' || s.sdx.includes('A419'))).toBe(true);
  });
});
