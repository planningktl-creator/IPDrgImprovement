import type { CmiCaseRow, UsageLite, WorklistQueryParams } from '@/cmi/caseContract';
import { formatDateIso } from '@/utils/dateUtils';

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

/**
 * Inpatient Case Worklist SQL Query
 * Features 12 Secondary Diagnoses (sdx1..sdx12) and 12 Procedures (proc1..proc12)
 */
export const CASE_WORKLIST_SQL = `WITH params AS (
  SELECT
    DATE :dstart AS dstart,
    DATE :dend   AS dend
),

target_cases AS (
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
  WHERE i.dchdate >= (SELECT dstart FROM params)
    AND i.dchdate < ((SELECT dend FROM params) + INTERVAL '1 day')
  ORDER BY i.an, i.dchdate DESC NULLS LAST, i.regdate DESC NULLS LAST
),

first_ward_per_an AS (
  SELECT
    t.an,
    COALESCE(fm.oward, t.ward) AS first_ward
  FROM target_cases t
  LEFT JOIN LATERAL (
    SELECT bm.oward
    FROM iptbedmove bm
    WHERE bm.an = t.an
    ORDER BY bm.movedate ASC NULLS LAST,
             bm.movetime ASC NULLS LAST,
             bm.oward ASC NULLS LAST
    LIMIT 1
  ) fm ON TRUE
),

diag_per_an AS (
  SELECT
    an,
    MAX(CASE WHEN diagtype = '1' THEN icd10 END) AS pdx,

    MAX(CASE WHEN diagtype = '2' AND diag_no = 1  THEN icd10 END) AS sdx1,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 2  THEN icd10 END) AS sdx2,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 3  THEN icd10 END) AS sdx3,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 4  THEN icd10 END) AS sdx4,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 5  THEN icd10 END) AS sdx5,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 6  THEN icd10 END) AS sdx6,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 7  THEN icd10 END) AS sdx7,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 8  THEN icd10 END) AS sdx8,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 9  THEN icd10 END) AS sdx9,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 10 THEN icd10 END) AS sdx10,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 11 THEN icd10 END) AS sdx11,
    MAX(CASE WHEN diagtype = '2' AND diag_no = 12 THEN icd10 END) AS sdx12,

    MAX(CASE WHEN diagtype = '3' THEN icd10 END) AS ext_cause
  FROM iptdiag
  WHERE an IN (SELECT an FROM target_cases)
  GROUP BY an
),

proc_per_an AS (
  SELECT
    an,
    MAX(CASE WHEN priority = 1  THEN icd9 END) AS proc1,
    MAX(CASE WHEN priority = 2  THEN icd9 END) AS proc2,
    MAX(CASE WHEN priority = 3  THEN icd9 END) AS proc3,
    MAX(CASE WHEN priority = 4  THEN icd9 END) AS proc4,
    MAX(CASE WHEN priority = 5  THEN icd9 END) AS proc5,
    MAX(CASE WHEN priority = 6  THEN icd9 END) AS proc6,
    MAX(CASE WHEN priority = 7  THEN icd9 END) AS proc7,
    MAX(CASE WHEN priority = 8  THEN icd9 END) AS proc8,
    MAX(CASE WHEN priority = 9  THEN icd9 END) AS proc9,
    MAX(CASE WHEN priority = 10 THEN icd9 END) AS proc10,
    MAX(CASE WHEN priority = 11 THEN icd9 END) AS proc11,
    MAX(CASE WHEN priority = 12 THEN icd9 END) AS proc12
  FROM iptoprt
  WHERE an IN (SELECT an FROM target_cases)
  GROUP BY an
),

finance_per_an AS (
  SELECT
    an,
    MAX(income) AS income,
    MAX(uc_money) AS uc_money,
    MAX(paid_money) AS paid_money,
    MAX(remain_money) AS remain_money
  FROM an_stat
  WHERE an IN (SELECT an FROM target_cases)
  GROUP BY an
)

SELECT
  TO_CHAR(t.dchdate, 'YYYY-MM') AS year_month,

  CASE
    WHEN EXTRACT(MONTH FROM t.dchdate)::int >= 10
    THEN EXTRACT(YEAR FROM t.dchdate)::int + 544
    ELSE EXTRACT(YEAR FROM t.dchdate)::int + 543
  END AS year_be,

  CASE EXTRACT(MONTH FROM t.dchdate)::int
    WHEN 1  THEN 'ม.ค.' WHEN 2  THEN 'ก.พ.' WHEN 3  THEN 'มี.ค.'
    WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.' WHEN 6  THEN 'มิ.ย.'
    WHEN 7  THEN 'ก.ค.' WHEN 8  THEN 'ส.ค.' WHEN 9  THEN 'ก.ย.'
    WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
  END AS month_th,

  CASE
    WHEN EXTRACT(MONTH FROM t.dchdate)::int >= 10
    THEN EXTRACT(MONTH FROM t.dchdate)::int - 9
    ELSE EXTRACT(MONTH FROM t.dchdate)::int + 3
  END AS fiscal_month,

  fwa.first_ward,
  fw.name AS first_ward_name,

  t.ward AS last_ward,
  lw.name AS last_ward_name,

  t.an,
  t.hn,
  NULLIF(TRIM(CONCAT_WS(' ', NULLIF(p.pname, ''), NULLIF(p.fname, ''), NULLIF(p.lname, ''))), '') AS ptname,
  p.sex,

  CASE
    WHEN p.birthday IS NOT NULL AND t.regdate IS NOT NULL
    THEN EXTRACT(YEAR FROM AGE(CAST(t.regdate AS date), CAST(p.birthday AS date)))::int
  END AS age,

  t.pttype,
  pt.name AS pttype_name,

  t.regdate AS admdate,
  t.dchdate,
  (CAST(t.dchdate AS date) - CAST(t.regdate AS date)) AS los,
  t.dchtype,
  t.dchstts,

  t.drg,
  t.mdc,
  t.rw,
  t.adjrw,
  t.grouper_err,

  dx.pdx,
  dx.sdx1, dx.sdx2, dx.sdx3, dx.sdx4, dx.sdx5, dx.sdx6,
  dx.sdx7, dx.sdx8, dx.sdx9, dx.sdx10, dx.sdx11, dx.sdx12,
  dx.ext_cause,

  pr.proc1, pr.proc2, pr.proc3, pr.proc4, pr.proc5, pr.proc6,
  pr.proc7, pr.proc8, pr.proc9, pr.proc10, pr.proc11, pr.proc12,

  ROUND(COALESCE(a.income, 0)::numeric, 2) AS income,
  ROUND(COALESCE(a.uc_money, 0)::numeric, 2) AS uc_money,
  ROUND(COALESCE(a.paid_money, 0)::numeric, 2) AS paid_money,
  ROUND(COALESCE(a.remain_money, 0)::numeric, 2) AS remain_money,

  CASE
    WHEN (t.drg IS NULL OR t.drg = '' OR t.drg = '-')
     AND (t.adjrw IS NULL OR t.adjrw = 0)
    THEN 'ยังไม่ลงรหัสโรค'
    ELSE '-'
  END AS remark

FROM target_cases t
LEFT JOIN first_ward_per_an fwa ON fwa.an = t.an
LEFT JOIN ward fw ON fw.ward = fwa.first_ward
LEFT JOIN ward lw ON lw.ward = t.ward
LEFT JOIN patient p ON p.hn = t.hn
LEFT JOIN pttype pt ON pt.pttype = t.pttype
LEFT JOIN diag_per_an dx ON dx.an = t.an
LEFT JOIN proc_per_an pr ON pr.an = t.an
LEFT JOIN finance_per_an a ON a.an = t.an

ORDER BY
  TO_CHAR(t.dchdate, 'YYYY-MM'),
  fwa.first_ward,
  t.dchdate DESC
LIMIT 200;`;

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

// Built-in Demo Fixtures for testing and demonstration when BMS is offline
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

function getRelativeDate(daysAgoCount: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgoCount);
  return formatDateIso(d);
}

export const DEMO_WORKLIST_CASES: CmiCaseRow[] = [
  {
    an: '1001',
    hn: '0054321',
    ptname: 'นาย ประ*** ม***',
    sex: 'ชาย',
    age: 68,
    firstWard: '01',
    firstWardName: 'หอผู้ป่วยอายุรกรรมชาย',
    lastWard: '01',
    lastWardName: 'หอผู้ป่วยอายุรกรรมชาย',
    admdate: getRelativeDate(7),
    dchdate: getRelativeDate(1),
    los: 6,
    dchtype: '1',
    dchstts: '1',
    drg: '04010',
    mdc: '04',
    rw: 0.985,
    adjrw: 1.052,
    pdx: 'J189',
    sdx1: 'I10',
    sdx2: null,
    sdx3: null,
    sdx4: null,
    proc1: '9914',
    proc2: null,
    proc3: null,
    income: 18500,
    remainMoney: 0,
    remark: '-',
  },
  {
    an: '1002',
    hn: '0067890',
    ptname: 'นาง สม*** ท***',
    sex: 'หญิง',
    age: 54,
    firstWard: '02',
    firstWardName: 'หอผู้ป่วยอายุรกรรมหญิง',
    lastWard: '02',
    lastWardName: 'หอผู้ป่วยอายุรกรรมหญิง',
    admdate: getRelativeDate(5),
    dchdate: getRelativeDate(2),
    los: 3,
    dchtype: '1',
    dchstts: '1',
    drg: null,
    mdc: null,
    rw: null,
    adjrw: 0,
    pdx: null,
    sdx1: null,
    sdx2: null,
    sdx3: null,
    sdx4: null,
    proc1: null,
    proc2: null,
    proc3: null,
    income: 8200,
    remainMoney: 0,
    remark: 'ยังไม่ลงรหัสโรค',
  },
  {
    an: '1003',
    hn: '0071234',
    ptname: 'นาย วร*** ส***',
    sex: 'ชาย',
    age: 62,
    firstWard: '03',
    firstWardName: 'หอผู้ป่วยศัลยกรรม',
    lastWard: '03',
    lastWardName: 'หอผู้ป่วยศัลยกรรม',
    admdate: getRelativeDate(10),
    dchdate: getRelativeDate(3),
    los: 7,
    dchtype: '1',
    dchstts: '1',
    drg: '18010',
    mdc: '18',
    rw: 2.45,
    adjrw: 2.85,
    pdx: 'A419',
    sdx1: 'E119',
    sdx2: 'N183',
    sdx3: 'I10',
    sdx4: null,
    proc1: '9914',
    proc2: null,
    proc3: null,
    income: 42100,
    remainMoney: 0,
    remark: '-',
  },
  {
    an: '1004',
    hn: '0089912',
    ptname: 'ด.ช. ปั*** ค***',
    sex: 'ชาย',
    age: 8,
    firstWard: '05',
    firstWardName: 'หอผู้ป่วยกุมารเวชกรรม',
    lastWard: '05',
    lastWardName: 'หอผู้ป่วยกุมารเวชกรรม',
    admdate: getRelativeDate(3),
    dchdate: getRelativeDate(1),
    los: 2,
    dchtype: '1',
    dchstts: '1',
    drg: '03050',
    mdc: '03',
    rw: 0.51,
    adjrw: 0.54,
    pdx: 'J069',
    sdx1: null,
    sdx2: null,
    sdx3: null,
    sdx4: null,
    proc1: null,
    proc2: null,
    proc3: null,
    income: 4500,
    remainMoney: 0,
    remark: '-',
  },
  {
    an: '1005',
    hn: '0091122',
    ptname: 'น.ส. กา*** ร***',
    sex: 'หญิง',
    age: 39,
    firstWard: '04',
    firstWardName: 'หอผู้ป่วยสูติ-นรีเวชกรรม',
    lastWard: '04',
    lastWardName: 'หอผู้ป่วยสูติ-นรีเวชกรรม',
    admdate: getRelativeDate(4),
    dchdate: getRelativeDate(2),
    los: 2,
    dchtype: '1',
    dchstts: '1',
    drg: null,
    mdc: null,
    rw: null,
    adjrw: 0,
    pdx: null,
    sdx1: null,
    sdx2: null,
    sdx3: null,
    sdx4: null,
    proc1: null,
    proc2: null,
    proc3: null,
    income: 6900,
    remainMoney: 0,
    remark: 'ยังไม่ลงรหัสโรค',
  },
  {
    an: '1006',
    hn: '0034455',
    ptname: 'นาย บุญ*** ช***',
    sex: 'ชาย',
    age: 72,
    firstWard: '01',
    firstWardName: 'หอผู้ป่วยอายุรกรรมชาย',
    lastWard: '01',
    lastWardName: 'หอผู้ป่วยอายุรกรรมชาย',
    admdate: getRelativeDate(9),
    dchdate: getRelativeDate(3),
    los: 6,
    dchtype: '1',
    dchstts: '1',
    drg: '05011',
    mdc: '05',
    rw: 2.85,
    adjrw: 3.12,
    pdx: 'I210',
    sdx1: 'I10',
    sdx2: 'E119',
    sdx3: 'N183',
    sdx4: 'E780',
    sdx5: 'J449',
    proc1: '3606',
    proc2: '8856',
    proc3: '9914',
    income: 88500,
    remainMoney: 0,
    remark: '-',
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
    const foundDemo = DEMO_WORKLIST_CASES.find((c) => c.an === cleanAn);
    if (foundDemo) {
      return { ...foundDemo };
    }
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

  return mapRawRowToCmiCaseRow(row, cleanAn);
}

export async function fetchCaseWorklist(
  params: WorklistQueryParams,
  config?: BmsConnectionConfig,
  opts: { signal?: AbortSignal; useDemoFallback?: boolean } = {},
): Promise<CmiCaseRow[]> {
  if (opts.useDemoFallback || !config || !config.apiUrl) {
    let list = [...DEMO_WORKLIST_CASES];
    if (params.statusFilter === 'uncoded') {
      list = list.filter((c) => c.remark === 'ยังไม่ลงรหัสโรค' || !c.pdx);
    } else if (params.statusFilter === 'coded') {
      list = list.filter((c) => c.remark !== 'ยังไม่ลงรหัสโรค' && Boolean(c.pdx));
    }
    if (params.ward) {
      list = list.filter((c) => c.firstWard === params.ward || c.lastWard === params.ward);
    }
    if (params.search) {
      const q = params.search.trim().toLowerCase();
      list = list.filter((c) =>
        (c.an && c.an.toLowerCase().includes(q)) ||
        (c.hn && c.hn.toLowerCase().includes(q)) ||
        (c.ptname && c.ptname.toLowerCase().includes(q)) ||
        (c.pdx && c.pdx.toLowerCase().includes(q)) ||
        (c.firstWardName && c.firstWardName.toLowerCase().includes(q)),
      );
    }
    return list;
  }

  const queryParams: Record<string, { value: string | number; value_type: string }> = {
    dstart: { value: params.dstart, value_type: 'date' },
    dend: { value: params.dend, value_type: 'date' },
  };

  const response = await executeSqlViaApi(
    CASE_WORKLIST_SQL,
    config,
    queryParams,
    opts.signal,
  );

  const rows = response.result || [];
  return rows.map((r) => mapRawRowToCmiCaseRow(r));
}

function mapRawRowToCmiCaseRow(row: Record<string, unknown>, fallbackAn = ''): CmiCaseRow {
  return {
    an: String(row.an ?? fallbackAn),
    hn: String(row.hn ?? ''),
    ptname: row.ptname ? String(row.ptname) : null,
    sex: row.sex ? String(row.sex) : null,
    age: typeof row.age === 'number' ? row.age : Number(row.age) || null,
    pttype: row.pttype ? String(row.pttype) : null,
    pttypeName: row.pttype_name ? String(row.pttype_name) : null,
    firstWard: row.first_ward ? String(row.first_ward) : null,
    firstWardName: row.first_ward_name ? String(row.first_ward_name) : null,
    lastWard: row.last_ward ? String(row.last_ward) : null,
    lastWardName: row.last_ward_name ? String(row.last_ward_name) : null,
    yearMonth: row.year_month ? String(row.year_month) : null,
    yearBe: typeof row.year_be === 'number' ? row.year_be : Number(row.year_be) || null,
    monthTh: row.month_th ? String(row.month_th) : null,
    fiscalMonth: typeof row.fiscal_month === 'number' ? row.fiscal_month : Number(row.fiscal_month) || null,
    admdate: row.admdate ? String(row.admdate) : undefined,
    dchdate: row.dchdate ? String(row.dchdate) : undefined,
    los: typeof row.los === 'number' ? row.los : Number(row.los) || 1,
    dchtype: row.dchtype ? String(row.dchtype) : '1',
    dchstts: row.dchstts ? String(row.dchstts) : '1',
    drg: row.drg ? String(row.drg) : null,
    mdc: row.mdc ? String(row.mdc) : null,
    rw: typeof row.rw === 'number' ? row.rw : Number(row.rw) || null,
    adjrw: typeof row.adjrw === 'number' ? row.adjrw : Number(row.adjrw) || null,
    grouperErr: row.grouper_err ? String(row.grouper_err) : null,
    pdx: row.pdx ? String(row.pdx) : null,
    sdx1: row.sdx1 ? String(row.sdx1) : null,
    sdx2: row.sdx2 ? String(row.sdx2) : null,
    sdx3: row.sdx3 ? String(row.sdx3) : null,
    sdx4: row.sdx4 ? String(row.sdx4) : null,
    sdx5: row.sdx5 ? String(row.sdx5) : null,
    sdx6: row.sdx6 ? String(row.sdx6) : null,
    sdx7: row.sdx7 ? String(row.sdx7) : null,
    sdx8: row.sdx8 ? String(row.sdx8) : null,
    sdx9: row.sdx9 ? String(row.sdx9) : null,
    sdx10: row.sdx10 ? String(row.sdx10) : null,
    sdx11: row.sdx11 ? String(row.sdx11) : null,
    sdx12: row.sdx12 ? String(row.sdx12) : null,
    extCause: row.ext_cause ? String(row.ext_cause) : null,
    proc1: row.proc1 ? String(row.proc1) : null,
    proc2: row.proc2 ? String(row.proc2) : null,
    proc3: row.proc3 ? String(row.proc3) : null,
    proc4: row.proc4 ? String(row.proc4) : null,
    proc5: row.proc5 ? String(row.proc5) : null,
    proc6: row.proc6 ? String(row.proc6) : null,
    proc7: row.proc7 ? String(row.proc7) : null,
    proc8: row.proc8 ? String(row.proc8) : null,
    proc9: row.proc9 ? String(row.proc9) : null,
    proc10: row.proc10 ? String(row.proc10) : null,
    proc11: row.proc11 ? String(row.proc11) : null,
    proc12: row.proc12 ? String(row.proc12) : null,
    income: typeof row.income === 'number' ? row.income : Number(row.income) || 0,
    ucMoney: typeof row.uc_money === 'number' ? row.uc_money : Number(row.uc_money) || 0,
    paidMoney: typeof row.paid_money === 'number' ? row.paid_money : Number(row.paid_money) || 0,
    remainMoney: typeof row.remain_money === 'number' ? row.remain_money : Number(row.remain_money) || 0,
    remark: row.remark ? String(row.remark) : '-',
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
