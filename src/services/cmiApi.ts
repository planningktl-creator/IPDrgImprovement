import type { CmiCaseRow, UsageLite } from '@/cmi/caseContract';

export const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
export const APP_IDENTIFIER = 'DRG.Optimizer.React';

export interface BmsConnectionConfig {
  apiUrl: string;
  databaseType: 'postgresql' | 'mysql' | 'other';
  databaseSupportStatus?: 'supported' | 'unsupported' | 'unknown';
  appIdentifier: string;
}

export interface BmsSessionRawResponse {
  api_url?: string;
  database_type?: string;
  hospital_code?: string;
  hospital_name?: string;
  user_name?: string;
  [key: string]: unknown;
}

export const READ_ONLY_SQL = /^\s*(?:WITH|SELECT)\b/i;
export const WRITE_SQL = /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;

export function assertCmiQueryIsReadOnly(sql: string): void {
  if (!READ_ONLY_SQL.test(sql) || WRITE_SQL.test(sql)) {
    throw new Error('CMI query rejected because it is not read-only.');
  }
}

export const CASE_DETAIL_SQL = `WITH target_case AS (
  SELECT DISTINCT ON (i.an)
    i.an,
    i.hn,
    i.ward,
    i.pttype,
    i.regdate,
    i.dchdate,
    i.dchtype,
    i.dchstts,
    i.drg,
    i.mdc,
    i.rw,
    i.adjrw,
    i.grouper_err
  FROM ipt i
  WHERE i.an = :an
),
first_ward_per_an AS (
  SELECT DISTINCT ON (bm.an)
    bm.an,
    bm.oward AS first_ward
  FROM iptbedmove bm
  JOIN target_case c ON c.an = bm.an
  ORDER BY bm.an, bm.movedate ASC, bm.movetime ASC
),
pdx_per_an AS (
  SELECT DISTINCT ON (d.an)
    d.an,
    d.icd10 AS pdx
  FROM iptdiag d
  JOIN target_case c ON c.an = d.an
  WHERE d.diagtype = '1'
  ORDER BY d.an, d.ipt_diag_id ASC
),
diagnosis_per_an AS (
  SELECT
    d.an,
    MAX(CASE WHEN d.diagtype = '2' AND d.priority = 1 THEN d.icd10 END) AS sdx1,
    MAX(CASE WHEN d.diagtype = '2' AND d.priority = 2 THEN d.icd10 END) AS sdx2,
    MAX(CASE WHEN d.diagtype = '2' AND d.priority = 3 THEN d.icd10 END) AS sdx3,
    MAX(CASE WHEN d.diagtype = '2' AND d.priority = 4 THEN d.icd10 END) AS sdx4,
    MAX(CASE WHEN d.diagtype = '5' THEN d.icd10 END) AS ext_cause
  FROM iptdiag d
  JOIN target_case c ON c.an = d.an
  GROUP BY d.an
),
procedure_per_an AS (
  SELECT
    o.an,
    MAX(CASE WHEN o.priority = 1 THEN o.icd9 END) AS proc1,
    MAX(CASE WHEN o.priority = 2 THEN o.icd9 END) AS proc2,
    MAX(CASE WHEN o.priority = 3 THEN o.icd9 END) AS proc3
  FROM iptoprt o
  JOIN target_case c ON c.an = o.an
  GROUP BY o.an
)
SELECT
  i.an,
  i.hn,
  p.pname || p.fname || ' ' || p.lname AS ptname,
  p.sex,
  DATE_PART('year', AGE(i.regdate::date, p.birthday))::int AS age,
  i.regdate AS admdate,
  i.dchdate,
  i.dchdate - i.regdate AS los,
  i.dchtype,
  i.dchstts,
  i.drg,
  i.mdc,
  i.rw,
  i.adjrw,
  i.grouper_err,
  pdx.pdx,
  d.sdx1,
  d.sdx2,
  d.sdx3,
  d.sdx4,
  d.ext_cause,
  o.proc1,
  o.proc2,
  o.proc3
FROM target_case i
LEFT JOIN patient p ON i.hn = p.hn
LEFT JOIN pdx_per_an pdx ON i.an = pdx.an
LEFT JOIN diagnosis_per_an d ON i.an = d.an
LEFT JOIN procedure_per_an o ON i.an = o.an;`;

export const USAGE_SQL = `SELECT
  o.hos_guid,
  o.an,
  o.rxdate,
  o.rxtime,
  o.icode,
  o.income AS income_code,
  o.qty,
  o.unitprice,
  o.sum_price,
  COALESCE(s.name, d.name, nd.name, o.icode) AS item_name,
  inc.name AS income_name,
  o.need_order_reason,
  n.presc_reason,
  n.presc_reason_2,
  n.presc_reason_3,
  n.presc_reason_4,
  n.presc_reason_5
FROM opitemrece o
LEFT JOIN s_drugitems s ON o.icode = s.icode
LEFT JOIN drugitems d ON o.icode = d.icode
LEFT JOIN nondrugitems nd ON o.icode = nd.icode
LEFT JOIN income inc ON o.income = inc.income
LEFT JOIN ovst_presc_ned n ON o.vn = n.vn AND o.hos_guid = n.opi_guid
WHERE o.an = :an
ORDER BY o.rxdate DESC, o.rxtime DESC, o.hos_guid
LIMIT 300;`;

export async function retrieveBmsSession(sessionId: string): Promise<BmsSessionRawResponse> {
  const trimmed = sessionId.trim();
  if (!trimmed) throw new Error('Session ID is required');

  const url = `${PASTE_JSON_URL}?Action=GET&code=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to retrieve BMS session (${res.status})`);
  }
  return (await res.json()) as BmsSessionRawResponse;
}

export function extractConnectionConfig(session: BmsSessionRawResponse): BmsConnectionConfig {
  const apiUrl = String(session.api_url || '').replace(/\/+$/, '');
  const dbType = String(session.database_type || '').toLowerCase();
  const databaseType = dbType.includes('postgre') ? 'postgresql' : dbType.includes('mysql') ? 'mysql' : 'other';

  return {
    apiUrl,
    databaseType,
    databaseSupportStatus: databaseType === 'postgresql' ? 'supported' : 'unsupported',
    appIdentifier: APP_IDENTIFIER,
  };
}

export async function executeSqlViaApi(
  sql: string,
  config: BmsConnectionConfig,
  params: Record<string, { value: string | number; value_type: string }> = {},
  signal?: AbortSignal,
): Promise<{ result?: Record<string, unknown>[] }> {
  assertCmiQueryIsReadOnly(sql);

  const url = `${config.apiUrl}/api/sql`;
  const body = {
    sql,
    app: config.appIdentifier,
    params,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`BMS SQL execution failed (HTTP ${res.status})`);
  }

  return (await res.json()) as { result?: Record<string, unknown>[] };
}

// Built-in Demo Fixture for testing and demonstration when BMS is offline
export const DEMO_CASE_DETAIL: CmiCaseRow = {
  an: '1001',
  hn: '0054321',
  ptname: 'นาย ประ*** ม***',
  sex: 'ชาย',
  age: 68,
  los: 6,
  dchtype: '1',
  dchstts: '1',
  drg: '04010',
  mdc: '04',
  rw: 0.985,
  adjrw: 1.052,
  pdx: 'J189', // Pneumonia
  sdx1: 'I10',  // Hypertension
  sdx2: null,
  sdx3: null,
  sdx4: null,
  extCause: null,
  proc1: '9914', // Injection/infusion
  proc2: null,
  proc3: null,
};

export const DEMO_USAGE_ITEMS: UsageLite[] = [
  {
    hosGuid: 'GUID-1001-A',
    an: '1001',
    icode: '1500010',
    itemName: 'Meropenem 1g injection',
    needOrderReason: 'Severe sepsis A41.9 confirmed by blood culture',
    prescReason: 'A419',
    prescReason2: null,
    prescReason3: null,
    prescReason4: null,
    prescReason5: null,
  },
  {
    hosGuid: 'GUID-1001-B',
    an: '1001',
    icode: '1500020',
    itemName: 'Insulin Mixtard 30 HM 100u',
    needOrderReason: null,
    prescReason: 'E11.9 Type 2 diabetes mellitus',
    prescReason2: null,
    prescReason3: null,
    prescReason4: null,
    prescReason5: null,
  },
  {
    hosGuid: 'GUID-1001-C',
    an: '1001',
    icode: '1500030',
    itemName: 'Sodium Bicarbonate 8.4% 50ml',
    needOrderReason: 'Metabolic acidosis with CKD stage 4 N18.4',
    prescReason: 'N184',
    prescReason2: null,
    prescReason3: null,
    prescReason4: null,
    prescReason5: null,
  },
];

export async function fetchCaseDetail(
  an: string,
  config?: BmsConnectionConfig,
  opts: { signal?: AbortSignal; useDemoFallback?: boolean } = {},
): Promise<CmiCaseRow> {
  const cleanAn = an.trim();
  if (!cleanAn) throw new Error('กรุณาระบุ AN ที่ต้องการตรวจสอบ');

  if (opts.useDemoFallback || !config || !config.apiUrl) {
    if (cleanAn === '1001' || opts.useDemoFallback) {
      return { ...DEMO_CASE_DETAIL, an: cleanAn };
    }
  }

  if (!config?.apiUrl) {
    throw new Error('ยังไม่ได้เชื่อมต่อ BMS Session กรุณาระบุ session ID หรือใช้โหมดทดสอบ');
  }

  const response = await executeSqlViaApi(
    CASE_DETAIL_SQL,
    config,
    { an: { value: cleanAn, value_type: 'string' } },
    opts.signal,
  );

  const row = response.result?.[0];
  if (!row) {
    throw new Error(`ไม่พบข้อมูลเคส AN ${cleanAn} ในระบบ`);
  }

  return {
    an: String(row.an ?? cleanAn),
    hn: String(row.hn ?? ''),
    ptname: row.ptname ? String(row.ptname) : null,
    sex: row.sex ? String(row.sex) : null,
    age: typeof row.age === 'number' ? row.age : Number(row.age) || null,
    los: typeof row.los === 'number' ? row.los : Number(row.los) || 1,
    dchtype: row.dchtype ? String(row.dchtype) : '1',
    dchstts: row.dchstts ? String(row.dchstts) : '1',
    drg: row.drg ? String(row.drg) : null,
    mdc: row.mdc ? String(row.mdc) : null,
    rw: typeof row.rw === 'number' ? row.rw : Number(row.rw) || null,
    adjrw: typeof row.adjrw === 'number' ? row.adjrw : Number(row.adjrw) || null,
    pdx: row.pdx ? String(row.pdx) : null,
    sdx1: row.sdx1 ? String(row.sdx1) : null,
    sdx2: row.sdx2 ? String(row.sdx2) : null,
    sdx3: row.sdx3 ? String(row.sdx3) : null,
    sdx4: row.sdx4 ? String(row.sdx4) : null,
    extCause: row.ext_cause ? String(row.ext_cause) : null,
    proc1: row.proc1 ? String(row.proc1) : null,
    proc2: row.proc2 ? String(row.proc2) : null,
    proc3: row.proc3 ? String(row.proc3) : null,
  };
}

export async function fetchUsageItems(
  an: string,
  config?: BmsConnectionConfig,
  opts: { signal?: AbortSignal; useDemoFallback?: boolean } = {},
): Promise<UsageLite[]> {
  const cleanAn = an.trim();
  if (!cleanAn) return [];

  if (opts.useDemoFallback || !config || !config.apiUrl) {
    if (cleanAn === '1001' || opts.useDemoFallback) {
      return DEMO_USAGE_ITEMS.map((item) => ({ ...item, an: cleanAn }));
    }
  }

  if (!config?.apiUrl) return [];

  const response = await executeSqlViaApi(
    USAGE_SQL,
    config,
    { an: { value: cleanAn, value_type: 'string' } },
    opts.signal,
  );

  const rows = response.result || [];
  return rows.map((r) => ({
    hosGuid: r.hos_guid ? String(r.hos_guid) : null,
    an: cleanAn,
    icode: r.icode ? String(r.icode) : null,
    itemName: r.item_name ? String(r.item_name) : null,
    needOrderReason: r.need_order_reason ? String(r.need_order_reason) : null,
    prescReason: r.presc_reason ? String(r.presc_reason) : null,
    prescReason2: r.presc_reason_2 ? String(r.presc_reason_2) : null,
    prescReason3: r.presc_reason_3 ? String(r.presc_reason_3) : null,
    prescReason4: r.presc_reason_4 ? String(r.presc_reason_4) : null,
    prescReason5: r.presc_reason_5 ? String(r.presc_reason_5) : null,
  }));
}
