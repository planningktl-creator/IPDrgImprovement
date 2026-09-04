import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertCmiQueryIsReadOnly,
  CASE_DETAIL_SQL,
  USAGE_SQL,
  CASE_WORKLIST_SQL,
  fetchCaseDetail,
  fetchUsageItems,
  fetchCaseWorklist,
  retrieveBmsSession,
  extractConnectionConfig,
} from '@/services/cmiApi';

describe('cmiApi read-only guards', () => {
  it('allows read-only SELECT and WITH statements', () => {
    expect(() => assertCmiQueryIsReadOnly(CASE_DETAIL_SQL)).not.toThrow();
    expect(() => assertCmiQueryIsReadOnly(USAGE_SQL)).not.toThrow();
    expect(() => assertCmiQueryIsReadOnly(CASE_WORKLIST_SQL)).not.toThrow();
    expect(() => assertCmiQueryIsReadOnly('SELECT * FROM ipt WHERE an = :an')).not.toThrow();
  });

  it('rejects any SQL statement containing write operations', () => {
    expect(() => assertCmiQueryIsReadOnly('DELETE FROM ipt WHERE an = :an')).toThrow(
      /read-only/,
    );
    expect(() => assertCmiQueryIsReadOnly('UPDATE ipt SET pdx = "A419"')).toThrow(
      /read-only/,
    );
    expect(() => assertCmiQueryIsReadOnly('INSERT INTO iptdiag VALUES (1)')).toThrow(
      /read-only/,
    );
    expect(() => assertCmiQueryIsReadOnly('DROP TABLE patient')).toThrow(
      /read-only/,
    );
  });
});

describe('fetchCaseDetail and fetchUsageItems', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns mock case detail when in demo/offline mode', async () => {
    const detail = await fetchCaseDetail('1001', undefined, { useDemoFallback: true });
    expect(detail).toBeDefined();
    expect(detail.an).toBe('1001');
    expect(detail.pdx).toBe('J189');
    expect(detail.sex).toBe('ชาย');
  });

  it('returns mock usage items when in demo/offline mode', async () => {
    const items = await fetchUsageItems('1001', undefined, { useDemoFallback: true });
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.prescReason?.includes('E11') || i.needOrderReason?.includes('A41'))).toBe(true);
  });

  it('returns mock worklist cases when in demo/offline mode', async () => {
    const cases = await fetchCaseWorklist(
      { dstart: '2023-10-01', dend: '2026-09-30' },
      undefined,
      { useDemoFallback: true },
    );
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c) => c.an === '1001')).toBe(true);
    expect(cases.some((c) => c.remark === 'ยังไม่ลงรหัสโรค')).toBe(true);
  });

  it('queries BMS API when connection config is supplied', async () => {
    const mockApiResponse = {
      result: [
        {
          an: '67000123',
          hn: '0012345',
          ptname: 'นาย ส*** ม***',
          sex: '1',
          age: 65,
          los: 4,
          dchtype: '1',
          dchstts: '1',
          drg: '04010',
          adjrw: 1.12,
          pdx: 'J189',
          sdx1: 'E119',
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    });

    const config = {
      apiUrl: 'https://bms.test.hospital.org',
      databaseType: 'postgresql' as const,
      databaseSupportStatus: 'supported' as const,
      appIdentifier: 'DRG.Optimizer',
    };

    const detail = await fetchCaseDetail('67000123', config);
    expect(detail.an).toBe('67000123');
    expect(detail.pdx).toBe('J189');
    expect(detail.ptname).toBe('นาย ส*** ม***');
  });
});

describe('retrieveBmsSession', () => {
  it('fetches session payload from PASTE_JSON_URL', async () => {
    const mockSessionPayload = {
      api_url: 'http://192.168.1.100:45011',
      database_type: 'postgresql',
      hospital_code: '10929',
      hospital_name: 'โรงพยาบาลกันทรลักษ์',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSessionPayload,
    });

    const session = await retrieveBmsSession('test-session-123');
    expect(session.hospital_code).toBe('10929');

    const config = extractConnectionConfig(session);
    expect(config.apiUrl).toBe('http://192.168.1.100:45011');
    expect(config.databaseType).toBe('postgresql');
  });
});

describe('Session Persistence Utilities', () => {
  it('persists and retrieves session ID from localStorage and clears on remove', async () => {
    const { persistBmsSessionId, getStoredBmsSessionId, removeStoredBmsSessionId } = await import('@/services/cmiApi');

    persistBmsSessionId('test-session-persist-456');
    expect(getStoredBmsSessionId()).toBe('test-session-persist-456');

    removeStoredBmsSessionId();
    expect(getStoredBmsSessionId()).toBe('');
  });
});
