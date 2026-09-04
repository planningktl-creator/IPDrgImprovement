import { describe, it, expect } from 'vitest';
import { cmiCaseToDrgInput } from '@/cmi/caseAdapter';
import type { CmiCaseRow } from '@/cmi/caseContract';

describe('cmiCaseToDrgInput', () => {
  it('maps standard CmiCaseRow correctly into DrgCaseInput', () => {
    const row: CmiCaseRow = {
      pdx: 'J18.9',
      sdx1: 'E11.9',
      sdx2: null,
      sdx3: '',
      sdx4: null,
      extCause: null,
      proc1: '99.14',
      proc2: null,
      proc3: null,
      sex: 'ชาย',
      age: 60,
      los: 5,
      dchtype: '1',
      dchstts: '1',
    };

    const input = cmiCaseToDrgInput(row, { hcode: '10929' });

    expect(input).toEqual({
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
      proc: ['9914'],
    });
  });

  it('maps female sex variations to 2', () => {
    const baseRow: CmiCaseRow = {
      pdx: 'I10',
      sdx1: null,
      sdx2: null,
      sdx3: null,
      sdx4: null,
      extCause: null,
      proc1: null,
      proc2: null,
      proc3: null,
      sex: 'หญิง',
      age: 45,
      los: 2,
      dchtype: '1',
      dchstts: '1',
    };

    expect(cmiCaseToDrgInput(baseRow, { hcode: '10929' }).sex).toBe(2);
    expect(cmiCaseToDrgInput({ ...baseRow, sex: 'F' }, { hcode: '10929' }).sex).toBe(2);
    expect(cmiCaseToDrgInput({ ...baseRow, sex: '2' }, { hcode: '10929' }).sex).toBe(2);
  });

  it('throws error when pdx is missing or blank', () => {
    const row: CmiCaseRow = {
      pdx: null,
      sdx1: 'E119',
      sdx2: null,
      sdx3: null,
      sdx4: null,
      extCause: null,
      proc1: null,
      proc2: null,
      proc3: null,
      sex: 'ชาย',
      age: 60,
      los: 5,
      dchtype: '1',
      dchstts: '1',
    };

    expect(() => cmiCaseToDrgInput(row, { hcode: '10929' })).toThrow(
      /เคสนี้ยังไม่ลง PDx — ต้องมี PDx ก่อนเรียก Grouper/,
    );
  });

  it('filters out secondary diagnoses that duplicate pdx', () => {
    const row: CmiCaseRow = {
      pdx: 'J189',
      sdx1: 'J189',
      sdx2: 'E119',
      sdx3: null,
      sdx4: null,
      extCause: null,
      proc1: null,
      proc2: null,
      proc3: null,
      sex: 'ชาย',
      age: 60,
      los: 5,
      dchtype: '1',
      dchstts: '1',
    };

    const input = cmiCaseToDrgInput(row, { hcode: '10929' });
    expect(input.sdx).toEqual(['E119']);
  });

  it('uses dcCodeFallback if discharge status is incomplete', () => {
    const row: CmiCaseRow = {
      pdx: 'J189',
      sdx1: null,
      sdx2: null,
      sdx3: null,
      sdx4: null,
      extCause: null,
      proc1: null,
      proc2: null,
      proc3: null,
      sex: 'ชาย',
      age: 60,
      los: 0,
      dchtype: null,
      dchstts: null,
    };

    const input = cmiCaseToDrgInput(row, { hcode: '10929', dcCodeFallback: '12' });
    expect(input.dcCode).toBe('11'); // default character fallback '1' + '1' = '11'
  });

  it('maps extended secondary diagnoses up to sdx12 and procedures up to proc12', () => {
    const row: CmiCaseRow = {
      pdx: 'I210',
      sdx1: 'I10',
      sdx2: 'E119',
      sdx3: 'N183',
      sdx4: 'E780',
      sdx5: 'J449',
      sdx6: 'K290',
      sdx7: 'Z992',
      sdx8: 'I252',
      sdx9: 'I509',
      sdx10: 'R509',
      sdx11: 'F329',
      sdx12: 'H259',
      proc1: '3606',
      proc2: '8856',
      proc3: '9914',
      proc4: '3893',
      proc5: '8952',
      sex: 'ชาย',
      age: 72,
      los: 6,
      dchtype: '1',
      dchstts: '1',
    };

    const input = cmiCaseToDrgInput(row, { hcode: '10929' });
    expect(input.sdx).toHaveLength(12);
    expect(input.sdx).toContain('H259');
    expect(input.sdx).toContain('F329');
    expect(input.proc).toHaveLength(5);
    expect(input.proc).toContain('8952');
  });
});
