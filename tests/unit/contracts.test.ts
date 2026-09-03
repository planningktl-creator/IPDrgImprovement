import { describe, it, expect } from 'vitest';
import {
  DRG_API_BASE,
  DRG_VERSION,
  MAX_SDX,
  DEFAULT_HCODE,
} from '@/drg/grouperContract';
import type { CmiCaseRow, UsageLite } from '@/cmi/caseContract';

describe('Contracts', () => {
  it('locks Grouper API contracts to official MoPH specifications', () => {
    expect(DRG_API_BASE).toBe('https://had-api.moph.go.th/cmi');
    expect(DRG_VERSION).toBe('6');
    expect(MAX_SDX).toBe(12);
    expect(DEFAULT_HCODE).toBe('10929');
  });

  it('declares expected CMI case row and usage lite shapes', () => {
    const mockCase: CmiCaseRow = {
      pdx: 'J189',
      sdx1: 'E119',
      sdx2: null,
      sdx3: null,
      sdx4: null,
      extCause: null,
      proc1: '9914',
      proc2: null,
      proc3: null,
      sex: 'ชาย',
      age: 60,
      los: 5,
      dchtype: '1',
      dchstts: '1',
    };
    expect(mockCase.pdx).toBe('J189');

    const mockUsage: UsageLite = {
      hosGuid: 'GUID-1',
      itemName: 'Insulin 100u',
      needOrderReason: null,
      prescReason: 'E119',
      prescReason2: null,
      prescReason3: null,
      prescReason4: null,
      prescReason5: null,
      icode: '1001',
    };
    expect(mockUsage.prescReason).toBe('E119');
  });
});
