import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertCmiQueryIsReadOnly,
  CASE_DETAIL_SQL,
  USAGE_SQL,
  CASE_WORKLIST_SQL,
  fetchCaseDetail,
  fetchUsageItems,
  fetchCaseWorklist,
  fetchCasePage,
  exportCaseWorklist,
  MAX_EXPORT_ROWS,
  executeSqlViaApi,
  QUERY_REGISTRY,
  CASE_COUNT_SQL,
  validateWorklistQuery,
  retrieveBmsSession,
  extractConnectionConfig,
  isBmsSessionFailure,
} from '@/services/cmiApi';

describe('cmiApi read-only guards', () => {
  it('allows read-only SELECT and WITH statements', () => {
    expect(() => assertCmiQueryIsReadOnly(CASE_DETAIL_SQL)).not.toThrow();
    expect(() => assertCmiQueryIsReadOnly(USAGE_SQL)).not.toThrow();
    expect(() => assertCmiQueryIsReadOnly(CASE_WORKLIST_SQL)).not.toThrow();
    expect(() => assertCmiQueryIsReadOnly('SELECT * FROM ipt WHERE an = :an')).not.toThrow();
  });

  it('rejects any SQL statement containing write operations', () => {
    for (const sql of [
      'INSERT INTO iptdiag VALUES (1)',
      'UPDATE ipt SET pdx = "A419"',
      'DELETE FROM ipt WHERE an = :an',
      'MERGE INTO ipt USING x ON true WHEN MATCHED THEN UPDATE SET pdx = "A419"',
      'CREATE TABLE x (id int)',
      'ALTER TABLE ipt ADD COLUMN x int',
      'DROP TABLE patient',
      'TRUNCATE ipt',
      'CALL refresh_cmi()',
      'DO $$ BEGIN NULL; END $$',
      'COPY ipt TO STDOUT',
    ]) {
      expect(() => assertCmiQueryIsReadOnly(sql)).toThrow(/read-only/);
    }
  });

  it('rejects a read-only SQL string unless it is in the approved registry', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const config = { apiUrl: 'https://bms.test', databaseType: 'postgresql' as const, databaseSupportStatus: 'supported' as const, appIdentifier: 'test' };
    await expect(executeSqlViaApi('SELECT * FROM patient', config)).rejects.toThrow(/approved query registry/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Object.keys(QUERY_REGISTRY)).toEqual(['casePage', 'caseCount', 'worklistSummary', 'caseDetail', 'usagePage', 'caseExport']);
    expect(QUERY_REGISTRY.caseCount).toBe(CASE_COUNT_SQL);
  });

  it('validates date range, deterministic pagination and page size', () => {
    expect(validateWorklistQuery({ dstart: '2023-10-01', dend: '2026-09-30', pageSize: 1000 }).pageSize).toBe(100);
    expect(() => validateWorklistQuery({ dstart: '2026-01-01', dend: '2025-01-01' })).toThrow(/วันที่เริ่มต้น/);
    expect(() => validateWorklistQuery({ dstart: '2023-10-01', dend: '2026-09-30', pageSize: Number.NaN })).toThrow(/จำนวนรายการ/);
    expect(() => validateWorklistQuery({ dstart: '2023-10-01', dend: '2026-09-30', sort: 'an' })).toThrow(/เรียงลำดับ/);
  });

  it('preserves the timestamp in the keyset cursor returned by PostgreSQL', async () => {
    const rows = [
      { an: '1001', dchdate: '2026-08-07T14:30:00.000Z', pdx: 'J189', sex: 'ชาย', age: 60, los: 1 },
      { an: '1002', dchdate: '2026-08-06T14:30:00.000Z', pdx: 'I10', sex: 'หญิง', age: 55, los: 2 },
    ];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { sql: string };
      if (body.sql.includes('total_adjrw')) return { ok: true, status: 200, json: async () => ({ data: [{ total_count: 2, uncoded_count: 0, coded_count: 2, total_adjrw: 2, total_income: 2 }] }) };
      if (body.sql.includes('COUNT(*)::int AS total_count')) return { ok: true, status: 200, json: async () => ({ data: [{ total_count: 2 }] }) };
      return { ok: true, status: 200, json: async () => ({ data: rows }) };
    });
    globalThis.fetch = fetchMock;
    const config = { apiUrl: 'https://bms.test', databaseType: 'postgresql' as const, databaseSupportStatus: 'supported' as const, appIdentifier: 'test' };
    const result = await fetchCasePage({ dstart: '2023-10-01', dend: '2026-09-30', pageSize: 1 }, config);
    expect(result.nextCursor).toBeTruthy();

    await fetchCasePage({ dstart: '2023-10-01', dend: '2026-09-30', pageSize: 1, cursor: result.nextCursor ?? undefined }, config);
    const cursorValues = fetchMock.mock.calls.slice(3).map((call) => {
      const request = call[1] as RequestInit;
      return (JSON.parse(String(request.body)) as { params?: { cursor_date?: { value?: string } } }).params?.cursor_date?.value;
    });
    expect(cursorValues).toContain('2026-08-07 14:30:00.000');
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

  it('extracts the nested CMI-Dashboard session contract and bearer token', () => {
    const config = extractConnectionConfig({
      MessageCode: 200,
      result: {
        key_value: 'jwt-token',
        user_info: {
          bms_url: 'https://bms.example.test/',
          bms_session_code: 'session-token',
          bms_database_type: 'PostgreSQL',
          hospital_code: '10929',
          location: 'Kantharalak Hospital',
        },
      },
    });
    expect(config).toMatchObject({ apiUrl: 'https://bms.example.test', bearerToken: 'session-token', databaseType: 'postgresql', hospitalCode: '10929' });
  });

  it('marks a session unsupported when its hospital code is missing or malformed', () => {
    const config = extractConnectionConfig({ api_url: 'https://bms.example.test', database_type: 'PostgreSQL', hospital_code: '123' });
    expect(config.databaseSupportStatus).toBe('unsupported');
    expect(config.hospitalCode).toBeUndefined();
  });

  it('accepts the live SQL response data envelope and masks PII at the mapper boundary', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ an: '1001', hn: '0054321', ptname: 'นาย สมชาย ใจดี', pdx: 'J189', age: '68', los: '6', dchdate: '2026-08-07' }] }) });
    const result = await fetchCasePage({ dstart: '2023-10-01', dend: '2026-09-30' }, { apiUrl: 'https://bms.test', databaseType: 'postgresql', databaseSupportStatus: 'supported', appIdentifier: 'test' });
    expect(result.items[0]).toMatchObject({ hn: '00***21', ptname: 'นาย ส*** ใ***', pdx: 'J189' });
  });

  it('caps export results at 10,000 rows and reports truncation', async () => {
    const rows = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, index) => ({
      an: String(index + 1), hn: '0012345', ptname: 'นาย ทดสอบ', sex: 'ชาย', age: 60, los: 1, pdx: 'J189',
    }));
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) });
    const result = await exportCaseWorklist(
      { dstart: '2023-10-01', dend: '2026-09-30' },
      { apiUrl: 'https://bms.test', databaseType: 'postgresql', databaseSupportStatus: 'supported', appIdentifier: 'test' },
    );
    expect(result.rows).toHaveLength(MAX_EXPORT_ROWS);
    expect(result.truncated).toBe(true);
  });
});

describe('Session Persistence Utilities', () => {
  it('persists and retrieves session ID from a cookie and clears on remove', async () => {
    const { persistBmsSessionId, getStoredBmsSessionId, removeStoredBmsSessionId } = await import('@/services/cmiApi');

    persistBmsSessionId('test-session-persist-456');
    expect(getStoredBmsSessionId()).toBe('test-session-persist-456');

    removeStoredBmsSessionId();
    expect(getStoredBmsSessionId()).toBe('');
  });
});

describe('SQL Query Parameter Compatibility and 409 Error Handling', () => {
  it('ensures CASE_WORKLIST_SQL uses CAST(:dstart AS date) and does not contain DATE :', () => {
    expect(CASE_WORKLIST_SQL).toContain('CAST(:dstart AS date)');
    expect(CASE_WORKLIST_SQL).toContain('CAST(:dend AS date)');
    expect(CASE_WORKLIST_SQL).not.toMatch(/DATE\s+:[a-zA-Z0-9_]+/i);
  });

  it('uses NULLIF for cursor_date to prevent timestamp syntax error on empty cursor', () => {
    expect(CASE_WORKLIST_SQL).toContain("NULLIF(:cursor_date, '') IS NULL");
    expect(CASE_WORKLIST_SQL).toContain("CAST(NULLIF(:cursor_date, '') AS timestamp)");
  });

  it('ensures CASE_DETAIL_SQL binds :an in target_case and uses subqueries for dependent CTEs', () => {
    expect(CASE_DETAIL_SQL).toContain('WHERE i.an = :an');
    expect(CASE_DETAIL_SQL).toContain('WHERE an IN (SELECT an FROM target_case)');
    const countAn = (CASE_DETAIL_SQL.match(/:an\b/g) || []).length;
    expect(countAn).toBe(1);
  });

  it('preserves database error message on 409 and does not trigger isBmsSessionFailure', async () => {
    const config = { apiUrl: 'https://bms.test', databaseType: 'postgresql' as const, databaseSupportStatus: 'supported' as const, appIdentifier: 'test' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {},
        MessageCode: 409,
        Message: 'Database error: syntax error at or near "$1"',
      }),
    });

    let caughtError: unknown;
    try {
      await executeSqlViaApi(CASE_WORKLIST_SQL, config);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain('Database error: syntax error at or near "$1"');
    expect((caughtError as Error).message).toContain('409');
    // 409 is a database query syntax/conflict error, not an auth session expiration
    expect(isBmsSessionFailure(caughtError)).toBe(false);
  });

  it('identifies 401 and 403 as session failures in isBmsSessionFailure', async () => {
    const config = { apiUrl: 'https://bms.test', databaseType: 'postgresql' as const, databaseSupportStatus: 'supported' as const, appIdentifier: 'test' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {},
        MessageCode: 401,
        Message: 'Session expired',
      }),
    });

    let caughtError: unknown;
    try {
      await executeSqlViaApi(CASE_WORKLIST_SQL, config);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(isBmsSessionFailure(caughtError)).toBe(true);
  });
});

