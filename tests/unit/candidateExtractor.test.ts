import { describe, it, expect } from 'vitest';
import { extractCandidates, type DxCandidate } from '@/suggest/candidateExtractor';
import type { UsageLite } from '@/cmi/caseContract';

describe('extractCandidates', () => {
  it('extracts ICD-10 candidates from prescReason and records evidence with hosGuid', () => {
    const items: UsageLite[] = [
      {
        hosGuid: 'GUID-101',
        itemName: 'Insulin Mixtard 30 HM 100 IU/ml',
        needOrderReason: null,
        prescReason: 'E11.9 Type 2 DM without complications',
        prescReason2: null,
        prescReason3: null,
        prescReason4: null,
        prescReason5: null,
        icode: '1500001',
      },
    ];

    const candidates = extractCandidates(items);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].code).toBe('E119');
    expect(candidates[0].source).toBe('presc_reason');
    expect(candidates[0].evidence[0]).toContain('E11.9');
    expect(candidates[0].evidence[0]).toContain('GUID-101');
  });

  it('extracts candidates across multiple prescReason fields and needOrderReason', () => {
    const items: UsageLite[] = [
      {
        hosGuid: 'GUID-201',
        itemName: 'Meropenem 1g inj',
        needOrderReason: 'Severe sepsis A419 confirmed by blood culture',
        prescReason: 'J18.9 Severe pneumonia',
        prescReason2: 'N18.3 Chronic kidney disease stage 3',
        prescReason3: null,
        prescReason4: null,
        prescReason5: null,
        icode: '1500002',
      },
    ];

    const candidates = extractCandidates(items);
    const codes = candidates.map((c: DxCandidate) => c.code);

    expect(codes).toContain('A419');
    expect(codes).toContain('J189');
    expect(codes).toContain('N183');

    const a419 = candidates.find((c: DxCandidate) => c.code === 'A419');
    expect(a419?.source).toBe('need_order_reason');
  });

  it('deduplicates multiple mentions of the same code and accumulates evidence', () => {
    const items: UsageLite[] = [
      {
        hosGuid: 'GUID-301',
        itemName: 'Metformin 500mg',
        needOrderReason: null,
        prescReason: 'E11.9',
        prescReason2: null,
        prescReason3: null,
        prescReason4: null,
        prescReason5: null,
        icode: '1500003',
      },
      {
        hosGuid: 'GUID-302',
        itemName: 'Glipizide 5mg',
        needOrderReason: null,
        prescReason: 'E11.9',
        prescReason2: null,
        prescReason3: null,
        prescReason4: null,
        prescReason5: null,
        icode: '1500004',
      },
    ];

    const candidates = extractCandidates(items);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].code).toBe('E119');
    expect(candidates[0].evidence).toHaveLength(2);
  });

  it('ignores items without valid ICD-10 patterns', () => {
    const items: UsageLite[] = [
      {
        hosGuid: 'GUID-401',
        itemName: 'Paracetamol 500mg',
        needOrderReason: null,
        prescReason: 'Pain relief',
        prescReason2: null,
        prescReason3: null,
        prescReason4: null,
        prescReason5: null,
        icode: '1500005',
      },
    ];

    const candidates = extractCandidates(items);
    expect(candidates).toHaveLength(0);
  });
});
