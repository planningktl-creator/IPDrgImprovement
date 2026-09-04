import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDrgPayload,
  calculateDrg,
  DRG_API_BASE,
  DRG_VERSION,
} from '@/drg/grouperClient';

describe('buildDrgPayload', () => {
  it('builds version-6 payload splitting disch 11 -> dischs=1 discht=1', () => {
    const p = buildDrgPayload({
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
    });
    expect(p).toEqual({
      version: '6',
      data: [
        {
          hcode: '10929',
          hn: '',
          an: '1',
          sex: 1,
          age: 60,
          age_day: 0,
          los_day: 5,
          los_hour: 0,
          weight: 0,
          dischs: '1',
          discht: '1',
          pdx: 'J189',
          sdx: ['E119'],
          proc: [],
        },
      ],
    });
  });

  it('rejects sdx > 12', () => {
    expect(() =>
      buildDrgPayload({
        hcode: '10929',
        sex: 1,
        age: 60,
        ageDay: 0,
        weight: 0,
        losDay: 5,
        losHour: 0,
        dcCode: '11',
        pdx: 'J189',
        sdx: Array(13).fill('E119'),
        proc: [],
      }),
    ).toThrow(/SDx เกิน 12/);
  });

  it('validates hcode and pdx formatting', () => {
    expect(() =>
      buildDrgPayload({
        hcode: '123',
        sex: 1,
        age: 60,
        ageDay: 0,
        weight: 0,
        losDay: 5,
        losHour: 0,
        dcCode: '11',
        pdx: 'J189',
        sdx: [],
        proc: [],
      }),
    ).toThrow(/รหัส HCode หรือ PDx ไม่ถูกต้อง/);

    expect(() =>
      buildDrgPayload({
        hcode: '10929',
        sex: 1,
        age: 60,
        ageDay: 0,
        weight: 0,
        losDay: 5,
        losHour: 0,
        dcCode: '11',
        pdx: '',
        sdx: [],
        proc: [],
      }),
    ).toThrow(/รหัส HCode หรือ PDx ไม่ถูกต้อง/);
  });

  it('validates numerical ranges', () => {
    expect(() =>
      buildDrgPayload({
        hcode: '10929',
        sex: 1,
        age: 150,
        ageDay: 0,
        weight: 0,
        losDay: 5,
        losHour: 0,
        dcCode: '11',
        pdx: 'J189',
        sdx: [],
        proc: [],
      }),
    ).toThrow(/ค่าตัวเลขของเคสอยู่นอกช่วงที่รองรับ/);
  });

  it('rejects non-numeric procedure codes', () => {
    expect(() => buildDrgPayload({
      hcode: '10929', sex: 1, age: 60, ageDay: 0, weight: 0, losDay: 5, losHour: 0,
      dcCode: '11', pdx: 'J189', sdx: [], proc: ['ABCD'],
    })).toThrow(/Procedure/);
  });
});

describe('calculateDrg', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls MoPH calculate API directly and parses response', async () => {
    const mockResponse = {
      status: 200,
      data: [
        {
          drg: '04010',
          mdc: '04',
          rw: 1.2345,
          adjrw: 1.3456,
          wtlos: 5.2,
          ot: 0,
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchMock;

    const payload = {
      version: DRG_VERSION,
      data: [
        {
          hcode: '10929',
          hn: '',
          an: '1',
          sex: 1,
          age: 60,
          age_day: 0,
          los_day: 5,
          los_hour: 0,
          weight: 0,
          dischs: '1',
          discht: '1',
          pdx: 'J189',
          sdx: ['E119'],
          proc: [],
        },
      ],
    };

    const res = await calculateDrg(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      `${DRG_API_BASE}/drg/calculate`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(res.data[0].drg).toBe('04010');
    expect(res.data[0].adjrw).toBe(1.3456);
  });

  it('throws when API returns non-200 status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ status: 500 }),
    });

    await expect(calculateDrg({ version: '6', data: [] })).rejects.toThrow(
      /Grouper ไม่ตอบกลับผลลัพธ์/,
    );
  });

  it('throws when DRG field is missing or empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 200, data: [{ drg: '' }] }),
    });

    await expect(calculateDrg({ version: '6', data: [] })).rejects.toThrow(
      /Grouper ไม่ส่งผลลัพธ์ DRG กลับมา/,
    );
  });

  it('rejects invalid JSON and malformed numeric fields instead of creating a result', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 200, data: [{ drg: '04010', rw: 'not-a-number', adjrw: 1.2 }] }),
    });
    await expect(calculateDrg({ version: '6', data: [] })).rejects.toThrow(/ค่า rw ไม่ถูกต้อง/);

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => { throw new Error('bad json'); },
    });
    await expect(calculateDrg({ version: '6', data: [] })).rejects.toThrow(/JSON/);
  });
});
