import { formatDateIso } from '@/utils/dateUtils';
import {
  calculateEstimatedRevenue,
  getPayerRateConfig,
  resolvePayerRate,
  type PayerRateConfig,
} from '@/config/reimbursementRates';
import type {
  CasePageResult,
  CaseSummary,
  CmiCaseRow,
  QueryRegistryKey,
  UsageLite,
  WorklistQueryParams,
} from '@/cmi/caseContract';

export const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
export const APP_IDENTIFIER = 'DRG.Optimizer.React';
export const DEFAULT_WORKLIST_START = '2023-10-01';
export const DEFAULT_WORKLIST_END = '2026-09-30';
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_EXPORT_ROWS = 10_000;
export const REQUEST_TIMEOUT_MS = 20_000;

export interface BmsConnectionConfig {
  apiUrl: string;
  bearerToken?: string;
  databaseType: 'postgresql' | 'mysql' | 'other';
  databaseSupportStatus?: 'supported' | 'unsupported' | 'unknown';
  hospitalCode?: string;
  hospitalName?: string;
  appIdentifier: string;
}

export interface BmsSessionRawResponse {
  MessageCode?: number;
  Message?: string;
  api_url?: string;
  database_type?: string;
  hospital_code?: string;
  hospital_name?: string;
  user_name?: string;
  result?: {
    key_value?: string;
    expired_second?: number;
    user_info?: {
      name?: string;
      hospital_code?: string;
      location?: string;
      bms_url?: string;
      bms_session_code?: string;
      bms_database_name?: string;
      bms_database_type?: string;
    };
  };
  [key: string]: unknown;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const READ_ONLY_SQL = /^\s*(?:WITH|SELECT)\b/i;
const FORBIDDEN_SQL = /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|VACUUM|ANALYZE|COMMENT|SET|RESET|PREPARE|EXECUTE|LOCK|REFRESH)\b/i;

export { READ_ONLY_SQL };

export function assertCmiQueryIsReadOnly(sql: string): void {
  if (!READ_ONLY_SQL.test(sql) || FORBIDDEN_SQL.test(sql)) {
    throw new Error('CMI query rejected because it is not read-only.');
  }
}

function normalizeApiUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) throw new Error('invalid url');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('BMS API URL ไม่ถูกต้อง');
  }
}

const SdxSelectWorklist = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return `    MAX(CASE WHEN diagtype = '2' AND diag_no = ${n} THEN icd10 END) AS sdx${n}`;
}).join(',\n');

const ProcSelectWorklist = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return `    MAX(CASE WHEN priority = ${n} THEN icd9 END) AS proc${n}`;
}).join(',\n');

const SdxSelectDetail = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return `    MAX(CASE WHEN diagtype = '2' AND diag_no = ${n} THEN icd10 END) AS sdx${n}`;
}).join(',\n');

const ProcSelectDetail = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1;
  return `    MAX(CASE WHEN priority = ${n} THEN icd9 END) AS proc${n}`;
}).join(',\n');

const MASKED_PATIENT_FIELDS = `
  CASE
    WHEN p.hn IS NULL OR LENGTH(TRIM(p.hn)) <= 4 THEN '***'
    ELSE LEFT(TRIM(p.hn), 2) || '***' || RIGHT(TRIM(p.hn), 2)
  END AS hn,
  NULLIF(TRIM(CONCAT_WS(' ',
    NULLIF(p.pname, ''),
    CASE WHEN NULLIF(TRIM(p.fname), '') IS NULL THEN NULL ELSE LEFT(TRIM(p.fname), 1) || '***' END,
    CASE WHEN NULLIF(TRIM(p.lname), '') IS NULL THEN NULL ELSE LEFT(TRIM(p.lname), 1) || '***' END
  )), '') AS ptname,
`;

const WORKLIST_BASE_CTES = `WITH params AS (
  SELECT
    CAST(:dstart AS date) AS dstart,
    CAST(:dend AS date) AS dend
),
target_cases AS (
  SELECT DISTINCT ON (i.an)
    i.an, i.hn, i.ward, i.pttype, i.regdate, i.dchdate, i.dchtype, i.dchstts,
    i.drg, i.mdc, i.rw, i.adjrw, i.grouper_err
  FROM ipt i
  WHERE i.dchdate >= (SELECT dstart FROM params)
    AND i.dchdate < ((SELECT dend FROM params) + INTERVAL '1 day')
  ORDER BY i.an, i.dchdate DESC NULLS LAST, i.regdate DESC NULLS LAST
),
pdx_per_an AS (
  SELECT DISTINCT ON (d.an)
    d.an,
    d.icd10 AS pdx
  FROM iptdiag d
  JOIN target_cases t ON t.an = d.an
  WHERE d.diagtype = '1' AND d.icd10 IS NOT NULL
  ORDER BY d.an, d.diag_no ASC NULLS LAST, d.icd10 ASC
),
first_ward_per_an AS (
  SELECT DISTINCT ON (bm.an)
    bm.an,
    bm.oward AS first_ward
  FROM iptbedmove bm
  JOIN target_cases t ON t.an = bm.an
  ORDER BY bm.an, bm.movedate ASC NULLS LAST, bm.movetime ASC NULLS LAST
),
candidate_cases AS (
  SELECT
    t.an, t.hn, t.ward AS last_ward, t.pttype,
    t.regdate AS admdate, t.dchdate,
    CAST(t.dchdate AS date) - CAST(t.regdate AS date) AS los,
    t.dchtype, t.dchstts, t.drg, t.mdc, t.rw, t.adjrw, t.grouper_err,
    TO_CHAR(t.dchdate, 'YYYY-MM') AS year_month,
    CASE WHEN EXTRACT(MONTH FROM t.dchdate)::int >= 10
      THEN EXTRACT(YEAR FROM t.dchdate)::int + 544
      ELSE EXTRACT(YEAR FROM t.dchdate)::int + 543 END AS year_be,
    CASE EXTRACT(MONTH FROM t.dchdate)::int
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.' END AS month_th,
    CASE WHEN EXTRACT(MONTH FROM t.dchdate)::int >= 10
      THEN EXTRACT(MONTH FROM t.dchdate)::int - 9
      ELSE EXTRACT(MONTH FROM t.dchdate)::int + 3 END AS fiscal_month,
    COALESCE(fwa.first_ward, t.ward) AS first_ward,
    fw.name AS first_ward_name,
    lw.name AS last_ward_name,
    p.sex,
    CASE WHEN p.birthday IS NOT NULL AND t.regdate IS NOT NULL
      THEN EXTRACT(YEAR FROM AGE(CAST(t.regdate AS date), CAST(p.birthday AS date)))::int END AS age,
    pt.name AS pttype_name,
    CASE
      WHEN p.hn IS NULL OR LENGTH(TRIM(p.hn)) <= 4 THEN '***'
      ELSE LEFT(TRIM(p.hn), 2) || '***' || RIGHT(TRIM(p.hn), 2)
    END AS masked_hn,
    NULLIF(TRIM(CONCAT_WS(' ',
      NULLIF(p.pname, ''),
      CASE WHEN NULLIF(TRIM(p.fname), '') IS NULL THEN NULL ELSE LEFT(TRIM(p.fname), 1) || '***' END,
      CASE WHEN NULLIF(TRIM(p.lname), '') IS NULL THEN NULL ELSE LEFT(TRIM(p.lname), 1) || '***' END
    )), '') AS ptname,
    pdx.pdx,
    CASE
      WHEN (t.drg IS NULL OR t.drg = '' OR t.drg = '-')
       AND (t.adjrw IS NULL OR t.adjrw = 0)
      THEN 'ยังไม่ลงรหัสโรค' ELSE '-' END AS remark,
    CASE
      WHEN LOWER(CONCAT_WS(' ', t.pttype, pt.name)) LIKE ANY (ARRAY['%บัตรทอง%', '%หลักประกัน%', '%ประกันสุขภาพ%', '%ucs%']) THEN 'ucs'
      WHEN LOWER(CONCAT_WS(' ', t.pttype, pt.name)) LIKE ANY (ARRAY['%ข้าราชการ%', '%เบิกจ่ายตรง%', '%ofc%']) THEN 'ofc'
      WHEN LOWER(CONCAT_WS(' ', t.pttype, pt.name)) LIKE ANY (ARRAY['%ประกันสังคม%', '%sss%']) THEN 'sss'
      ELSE 'other' END AS payer_scheme
  FROM target_cases t
  LEFT JOIN first_ward_per_an fwa ON fwa.an = t.an
  LEFT JOIN ward fw ON fw.ward = COALESCE(fwa.first_ward, t.ward)
  LEFT JOIN ward lw ON lw.ward = t.ward
  LEFT JOIN patient p ON p.hn = t.hn
  LEFT JOIN pttype pt ON pt.pttype = t.pttype
  LEFT JOIN pdx_per_an pdx ON pdx.an = t.an
),
filtered_cases AS (
  SELECT *
  FROM candidate_cases
  WHERE (:ward = '' OR first_ward = :ward OR last_ward = :ward)
    AND (
      :status_filter = 'all'
      OR (:status_filter = 'uncoded' AND (pdx IS NULL OR pdx = '' OR remark = 'ยังไม่ลงรหัสโรค'))
      OR (:status_filter = 'coded' AND pdx IS NOT NULL AND pdx <> '' AND remark <> 'ยังไม่ลงรหัสโรค')
    )
    AND (:scheme = 'all' OR payer_scheme = :scheme)
    AND (
      :search = '' OR LOWER(CONCAT_WS(' ', an, masked_hn, ptname, pdx, first_ward_name, last_ward_name)) LIKE LOWER('%' || :search || '%')
    )
)
`;

export const CASE_WORKLIST_SQL = `${WORKLIST_BASE_CTES},
paged_cases AS (
  SELECT *
  FROM filtered_cases
  WHERE (
    NULLIF(:cursor_date, '') IS NULL
    OR dchdate < CAST(NULLIF(:cursor_date, '') AS timestamp)
    OR (dchdate = CAST(NULLIF(:cursor_date, '') AS timestamp) AND an > :cursor_an)
  )
  ORDER BY dchdate DESC NULLS LAST, an ASC
  LIMIT (:page_limit + 1)
),
diag_per_page AS (
  SELECT
    an,
${SdxSelectWorklist},
    MAX(CASE WHEN diagtype = '3' THEN icd10 END) AS ext_cause
  FROM iptdiag
  WHERE an IN (SELECT an FROM paged_cases)
  GROUP BY an
),
proc_per_page AS (
  SELECT
    an,
${ProcSelectWorklist}
  FROM iptoprt
  WHERE an IN (SELECT an FROM paged_cases)
  GROUP BY an
),
finance_per_page AS (
  SELECT
    an,
    MAX(income) AS income,
    MAX(uc_money) AS uc_money,
    MAX(paid_money) AS paid_money,
    MAX(remain_money) AS remain_money
  FROM an_stat
  WHERE an IN (SELECT an FROM paged_cases)
  GROUP BY an
)
SELECT
  p.year_month, p.year_be, p.month_th, p.fiscal_month,
  p.first_ward, p.first_ward_name,
  p.last_ward, p.last_ward_name,
  p.an, p.masked_hn AS hn, p.ptname, p.sex, p.age,
  p.pttype, p.pttype_name,
  p.admdate, p.dchdate, p.los,
  p.dchtype, p.dchstts, p.drg, p.mdc, p.rw, p.adjrw, p.grouper_err,
  p.pdx,
  dx.sdx1, dx.sdx2, dx.sdx3, dx.sdx4, dx.sdx5, dx.sdx6,
  dx.sdx7, dx.sdx8, dx.sdx9, dx.sdx10, dx.sdx11, dx.sdx12,
  dx.ext_cause,
  pr.proc1, pr.proc2, pr.proc3, pr.proc4, pr.proc5, pr.proc6,
  pr.proc7, pr.proc8, pr.proc9, pr.proc10, pr.proc11, pr.proc12,
  ROUND(COALESCE(f.income, 0)::numeric, 2) AS income,
  ROUND(COALESCE(f.uc_money, 0)::numeric, 2) AS uc_money,
  ROUND(COALESCE(f.paid_money, 0)::numeric, 2) AS paid_money,
  ROUND(COALESCE(f.remain_money, 0)::numeric, 2) AS remain_money,
  p.remark,
  p.payer_scheme
FROM paged_cases p
LEFT JOIN diag_per_page dx ON dx.an = p.an
LEFT JOIN proc_per_page pr ON pr.an = p.an
LEFT JOIN finance_per_page f ON f.an = p.an
ORDER BY p.dchdate DESC NULLS LAST, p.an ASC;`;

export const CASE_COUNT_SQL = `${WORKLIST_BASE_CTES}
SELECT COUNT(*)::int AS total_count
FROM filtered_cases;`;

export const WORKLIST_SUMMARY_SQL = `${WORKLIST_BASE_CTES},
finance_summary AS (
  SELECT
    an,
    MAX(income) AS income
  FROM an_stat
  WHERE an IN (SELECT an FROM filtered_cases)
  GROUP BY an
)
SELECT
  COUNT(*)::int AS total_count,
  COUNT(*) FILTER (WHERE pdx IS NULL OR pdx = '' OR remark = 'ยังไม่ลงรหัสโรค')::int AS uncoded_count,
  COUNT(*) FILTER (WHERE pdx IS NOT NULL AND pdx <> '' AND remark <> 'ยังไม่ลงรหัสโรค')::int AS coded_count,
  COALESCE(SUM(COALESCE(f.adjrw, 0)), 0)::numeric AS total_adjrw,
  COALESCE(SUM(COALESCE(fin.income, 0)), 0)::numeric AS total_income
FROM filtered_cases f
LEFT JOIN finance_summary fin ON fin.an = f.an;`;

export const CASE_DETAIL_SQL = `WITH target_case AS (
  SELECT DISTINCT ON (i.an)
    i.an, i.hn, i.ward, i.pttype, i.regdate, i.dchdate, i.dchtype, i.dchstts,
    i.drg, i.mdc, i.rw, i.adjrw, i.grouper_err
  FROM ipt i
  WHERE i.an = :an
  ORDER BY i.an, i.dchdate DESC NULLS LAST, i.regdate DESC NULLS LAST
),
pdx_per_an AS (
  SELECT
    an,
    MAX(CASE WHEN diagtype = '1' THEN icd10 END) AS pdx
  FROM iptdiag
  WHERE an IN (SELECT an FROM target_case)
  GROUP BY an
),
diagnosis_per_an AS (
  SELECT
    an,
${SdxSelectDetail},
    MAX(CASE WHEN diagtype = '3' THEN icd10 END) AS ext_cause
  FROM iptdiag
  WHERE an IN (SELECT an FROM target_case)
  GROUP BY an
),
procedure_per_an AS (
  SELECT
    an,
${ProcSelectDetail}
  FROM iptoprt
  WHERE an IN (SELECT an FROM target_case)
  GROUP BY an
)
SELECT
  i.an,
${MASKED_PATIENT_FIELDS}
  p.sex,
  CASE WHEN p.birthday IS NOT NULL AND i.regdate IS NOT NULL
    THEN EXTRACT(YEAR FROM AGE(CAST(i.regdate AS date), CAST(p.birthday AS date)))::int END AS age,
  i.regdate AS admdate, i.dchdate,
  CAST(i.dchdate AS date) - CAST(i.regdate AS date) AS los,
  i.dchtype, i.dchstts, i.drg, i.mdc, i.rw, i.adjrw, i.grouper_err,
  pdx.pdx, d.sdx1, d.sdx2, d.sdx3, d.sdx4, d.sdx5, d.sdx6,
  d.sdx7, d.sdx8, d.sdx9, d.sdx10, d.sdx11, d.sdx12, d.ext_cause,
  o.proc1, o.proc2, o.proc3, o.proc4, o.proc5, o.proc6, o.proc7,
  o.proc8, o.proc9, o.proc10, o.proc11, o.proc12, o.proc13, o.proc14,
  o.proc15, o.proc16, o.proc17, o.proc18, o.proc19, o.proc20, o.proc21,
  o.proc22, o.proc23, o.proc24, o.proc25, o.proc26, o.proc27, o.proc28,
  o.proc29, o.proc30,
  i.pttype, pt.name AS pttype_name,
  fwa.first_ward, fw.name AS first_ward_name,
  i.ward AS last_ward, lw.name AS last_ward_name
FROM target_case i
LEFT JOIN patient p ON i.hn = p.hn
LEFT JOIN LATERAL (
  SELECT bm.oward AS first_ward
  FROM iptbedmove bm
  WHERE bm.an = i.an
  ORDER BY bm.movedate ASC NULLS LAST, bm.movetime ASC NULLS LAST, bm.oward ASC NULLS LAST
  LIMIT 1
) fwa ON TRUE
LEFT JOIN ward fw ON fw.ward = fwa.first_ward
LEFT JOIN ward lw ON lw.ward = i.ward
LEFT JOIN pttype pt ON pt.pttype = i.pttype
LEFT JOIN pdx_per_an pdx ON i.an = pdx.an
LEFT JOIN diagnosis_per_an d ON i.an = d.an
LEFT JOIN procedure_per_an o ON i.an = o.an;`;

export const USAGE_SQL = `SELECT
  o.hos_guid, o.an, o.rxdate, o.rxtime, o.icode, o.income AS income_code,
  o.qty, o.unitprice, o.sum_price,
  COALESCE(s.name, d.name, nd.name, o.icode) AS item_name,
  inc.name AS income_name, o.need_order_reason,
  n.presc_reason, n.presc_reason_2, n.presc_reason_3, n.presc_reason_4, n.presc_reason_5
FROM opitemrece o
LEFT JOIN s_drugitems s ON o.icode = s.icode
LEFT JOIN drugitems d ON o.icode = d.icode
LEFT JOIN nondrugitems nd ON o.icode = nd.icode
LEFT JOIN income inc ON o.income = inc.income
LEFT JOIN ovst_presc_ned n ON o.vn = n.vn AND o.hos_guid = n.opi_guid
WHERE o.an = :an
ORDER BY o.rxdate DESC, o.rxtime DESC, o.hos_guid
LIMIT :page_limit;`;

export const WORKLIST_CTES = WORKLIST_BASE_CTES;

export const USAGE_PAGE_SQL = USAGE_SQL;
export const CASE_EXPORT_SQL = `${WORKLIST_BASE_CTES},
diag_per_export AS (
  SELECT
    an,
${SdxSelectWorklist},
    MAX(CASE WHEN diagtype = '3' THEN icd10 END) AS ext_cause
  FROM iptdiag
  WHERE an IN (SELECT an FROM filtered_cases)
  GROUP BY an
),
proc_per_export AS (
  SELECT
    an,
${ProcSelectWorklist}
  FROM iptoprt
  WHERE an IN (SELECT an FROM filtered_cases)
  GROUP BY an
),
finance_per_export AS (
  SELECT
    an,
    MAX(income) AS income,
    MAX(uc_money) AS uc_money,
    MAX(paid_money) AS paid_money,
    MAX(remain_money) AS remain_money
  FROM an_stat
  WHERE an IN (SELECT an FROM filtered_cases)
  GROUP BY an
)
SELECT
  p.year_month, p.year_be, p.month_th, p.fiscal_month,
  p.first_ward, p.first_ward_name,
  p.last_ward, p.last_ward_name,
  p.an, p.masked_hn AS hn, p.ptname, p.sex, p.age,
  p.pttype, p.pttype_name,
  p.admdate, p.dchdate, p.los,
  p.dchtype, p.dchstts, p.drg, p.mdc, p.rw, p.adjrw, p.grouper_err,
  p.pdx,
  dx.sdx1, dx.sdx2, dx.sdx3, dx.sdx4, dx.sdx5, dx.sdx6,
  dx.sdx7, dx.sdx8, dx.sdx9, dx.sdx10, dx.sdx11, dx.sdx12,
  dx.ext_cause,
  pr.proc1, pr.proc2, pr.proc3, pr.proc4, pr.proc5, pr.proc6,
  pr.proc7, pr.proc8, pr.proc9, pr.proc10, pr.proc11, pr.proc12,
  ROUND(COALESCE(f.income, 0)::numeric, 2) AS income,
  ROUND(COALESCE(f.uc_money, 0)::numeric, 2) AS uc_money,
  ROUND(COALESCE(f.paid_money, 0)::numeric, 2) AS paid_money,
  ROUND(COALESCE(f.remain_money, 0)::numeric, 2) AS remain_money,
  p.remark,
  p.payer_scheme
FROM filtered_cases p
LEFT JOIN diag_per_export dx ON dx.an = p.an
LEFT JOIN proc_per_export pr ON pr.an = p.an
LEFT JOIN finance_per_export f ON f.an = p.an
ORDER BY p.dchdate DESC NULLS LAST, p.an ASC
LIMIT :export_limit;`;

export const QUERY_REGISTRY: Readonly<Record<QueryRegistryKey, string>> = Object.freeze({
  casePage: CASE_WORKLIST_SQL,
  caseCount: CASE_COUNT_SQL,
  worklistSummary: WORKLIST_SUMMARY_SQL,
  caseDetail: CASE_DETAIL_SQL,
  usagePage: USAGE_PAGE_SQL,
  caseExport: CASE_EXPORT_SQL,
});

export function getCmiQuery(query: QueryRegistryKey): string {
  return QUERY_REGISTRY[query];
}

function isRegisteredQuery(sql: string): boolean {
  return Object.values(QUERY_REGISTRY).includes(sql);
}

function createRequestSignal(parent?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
  }
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function safeRows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') throw new Error('BMS ตอบกลับข้อมูลไม่ถูกต้อง');
  const response = payload as { result?: unknown; data?: unknown; record_count?: unknown; MessageCode?: unknown; Message?: unknown };
  const messageCode = Number(response.MessageCode);
  if (Number.isFinite(messageCode) && messageCode >= 400) {
    const rawMsg = typeof response.Message === 'string' ? response.Message.trim() : '';
    if (messageCode === 401 || messageCode === 403) {
      throw new Error(`BMS Session หมดอายุหรือไม่ได้รับอนุญาต (HTTP ${messageCode})`);
    }
    throw new Error(rawMsg ? `BMS SQL execution failed (${messageCode}): ${rawMsg}` : `BMS SQL execution failed (${messageCode})`);
  }
  const rows = response.data !== undefined ? response.data : response.result;
  if (rows === undefined && Number(response.record_count) === 0) return [];
  if (!Array.isArray(rows) || !rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    throw new Error('BMS ตอบกลับ result ไม่ใช่รายการข้อมูล');
  }
  return rows as Record<string, unknown>[];
}

export function isBmsSessionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /BMS Session (?:หมดอายุ|ไม่ได้รับอนุญาต)|BMS SQL execution failed \(HTTP (?:401|403)\)/i.test(message);
}

export async function executeSqlViaApi(
  sql: string,
  config: BmsConnectionConfig,
  params: Record<string, { value: string | number; value_type: string }> = {},
  signal?: AbortSignal,
): Promise<{ result?: Record<string, unknown>[] }> {
  assertCmiQueryIsReadOnly(sql);
  if (!isRegisteredQuery(sql)) throw new Error('CMI query rejected because it is not in the approved query registry.');
  if (config.databaseType !== 'postgresql' || config.databaseSupportStatus === 'unsupported' || config.databaseSupportStatus === 'unknown' || !config.apiUrl) throw new Error('BMS Session ต้องเป็น PostgreSQL และมี API URL ที่ใช้งานได้');
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;
  const res = await fetch(`${apiUrl}/api/sql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sql, app: config.appIdentifier, params }),
    signal: createRequestSignal(signal),
  });
  if (!res.ok) throw new Error(`BMS SQL execution failed (HTTP ${res.status})`);
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error('BMS SQL ตอบกลับ JSON ไม่ถูกต้อง');
  }
  return { result: safeRows(payload) };
}

export async function executeCmiQuery(
  query: QueryRegistryKey,
  config: BmsConnectionConfig,
  params: Record<string, { value: string | number; value_type: string }> = {},
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const response = await executeSqlViaApi(getCmiQuery(query), config, params, signal);
  return response.result ?? [];
}

export function extractConnectionConfig(session: BmsSessionRawResponse): BmsConnectionConfig {
  const userInfo = session.result?.user_info;
  const rawApiUrl = String(userInfo?.bms_url || session.api_url || '').trim().replace(/\/+$/, '');
  let apiUrl: string;
  try {
    apiUrl = normalizeApiUrl(rawApiUrl);
  } catch {
    apiUrl = '';
  }
  const dbType = String(userInfo?.bms_database_type || session.database_type || '').toLowerCase();
  const databaseType = dbType.includes('postgre') ? 'postgresql' : dbType.includes('mysql') ? 'mysql' : 'other';
  const bearerToken = String(userInfo?.bms_session_code || session.result?.key_value || '').trim() || undefined;
  const hospitalCode = String(userInfo?.hospital_code || session.hospital_code || '').trim();
  const validHospitalCode = /^\d{5}$/.test(hospitalCode) ? hospitalCode : undefined;
  return {
    apiUrl,
    bearerToken,
    databaseType,
    databaseSupportStatus: databaseType === 'postgresql' && apiUrl && validHospitalCode ? 'supported' : 'unsupported',
    hospitalCode: validHospitalCode,
    hospitalName: session.hospital_name ? String(session.hospital_name) : userInfo?.location ? String(userInfo.location) : undefined,
    appIdentifier: APP_IDENTIFIER,
  };
}

export async function retrieveBmsSession(sessionId: string, signal?: AbortSignal): Promise<BmsSessionRawResponse> {
  const trimmed = sessionId.trim();
  if (!trimmed) throw new Error('Session ID is required');
  const url = `${PASTE_JSON_URL}?Action=GET&code=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, { signal: createRequestSignal(signal) });
  if (!res.ok) throw new Error(`Failed to retrieve BMS session (HTTP ${res.status})`);
  const json: unknown = await res.json();
  if (!json || typeof json !== 'object') throw new Error('BMS Session ตอบกลับข้อมูลไม่ถูกต้อง');
  const session = json as BmsSessionRawResponse;
  const messageCode = Number(session.MessageCode);
  if (Number.isFinite(messageCode) && messageCode >= 400) {
    throw new Error('BMS Session หมดอายุหรือไม่ถูกต้อง');
  }
  return session;
}

export const BMS_SESSION_STORAGE_KEY = 'bms-session-id';
export const COOKIE_EXPIRY_DAYS = 7;

function readCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${BMS_SESSION_STORAGE_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]).trim() : '';
}

export function getStoredBmsSessionId(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlSid = params.get('bms-session-id')?.trim() || params.get('sessionId')?.trim();
    if (urlSid) return urlSid;
  }
  const cookieSid = readCookie();
  if (cookieSid) return cookieSid;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_BMS_SESSION_ID || env?.BMS_SESSION_ID || '').trim();
}

export function persistBmsSessionId(sessionId: string): void {
  const clean = sessionId.trim();
  if (!clean || typeof document === 'undefined') return;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + COOKIE_EXPIRY_DAYS);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${BMS_SESSION_STORAGE_KEY}=${encodeURIComponent(clean)}; expires=${expiry.toUTCString()}; path=/; SameSite=Lax${secure}`;
}

export function removeStoredBmsSessionId(): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${BMS_SESSION_STORAGE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax${secure}`;
}

export const DEMO_CASE_DETAIL: CmiCaseRow = {
  an: '1001', hn: '00***21', ptname: 'นาย ป*** ม***', sex: 'ชาย', age: 68,
  firstWard: '01', firstWardName: 'อายุรกรรมชาย', lastWard: '01', lastWardName: 'อายุรกรรมชาย',
  admdate: '2026-08-01', dchdate: '2026-08-07', los: 6, dchtype: '1', dchstts: '1',
  pttype: '1', pttypeName: 'บัตรทอง', drg: '04010', mdc: '04', rw: 0.985, adjrw: 1.052,
  pdx: 'J189', sdx1: 'I10', proc1: '9914', income: 18500, remainMoney: 0, remark: '-',
};

export const DEMO_USAGE_ITEMS: UsageLite[] = [
  { hosGuid: 'GUID-1001-A', an: '1001', icode: '1500010', itemName: 'Meropenem 1g injection', needOrderReason: 'Severe sepsis A41.9 confirmed by blood culture', prescReason: 'A419', prescReason2: null, prescReason3: null, prescReason4: null, prescReason5: null },
  { hosGuid: 'GUID-1001-B', an: '1001', icode: '1500020', itemName: 'Insulin Mixtard 30 HM 100u', needOrderReason: null, prescReason: 'E11.9 Type 2 diabetes mellitus', prescReason2: null, prescReason3: null, prescReason4: null, prescReason5: null },
  { hosGuid: 'GUID-1001-C', an: '1001', icode: '1500030', itemName: 'Sodium Bicarbonate 8.4%', needOrderReason: 'Metabolic acidosis with CKD stage 4 N18.4', prescReason: 'N184', prescReason2: null, prescReason3: null, prescReason4: null, prescReason5: null },
];

const dateAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDateIso(date);
};

export const DEMO_WORKLIST_CASES: CmiCaseRow[] = [
  { ...DEMO_CASE_DETAIL, admdate: dateAgo(7), dchdate: dateAgo(1) },
  { an: '1002', hn: '00***90', ptname: 'นาง ส*** ท***', sex: 'หญิง', age: 54, firstWard: '02', firstWardName: 'อายุรกรรมหญิง', lastWard: '02', lastWardName: 'อายุรกรรมหญิง', admdate: dateAgo(5), dchdate: dateAgo(2), los: 3, dchtype: '1', dchstts: '1', pttype: '1', pttypeName: 'บัตรทอง', drg: null, mdc: null, rw: null, adjrw: 0, pdx: null, sdx1: null, proc1: null, income: 8200, remainMoney: 0, remark: 'ยังไม่ลงรหัสโรค' },
  { an: '1003', hn: '00***34', ptname: 'นาย ว*** ส***', sex: 'ชาย', age: 62, firstWard: '03', firstWardName: 'ศัลยกรรม', lastWard: '03', lastWardName: 'ศัลยกรรม', admdate: dateAgo(10), dchdate: dateAgo(3), los: 7, dchtype: '1', dchstts: '1', pttype: '2', pttypeName: 'ข้าราชการ', drg: '18010', mdc: '18', rw: 2.45, adjrw: 2.85, pdx: 'A419', sdx1: 'E119', sdx2: 'N183', sdx3: 'I10', proc1: '9914', income: 42100, remainMoney: 0, remark: '-' },
];

function maskHn(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('*')) return raw;
  if (raw.length <= 4) return '***';
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

function maskName(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.includes('*')) return raw;
  return raw.split(/\s+/).map((part) => {
    if (/^(นาย|นาง|นางสาว|นส|น\.ส\.|ด\.ช\.|ด\.ญ\.)$/.test(part)) return part;
    return `${Array.from(part)[0] ?? '*'}***`;
  }).join(' ');
}

const numericOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const flatSdx = (row: CmiCaseRow): string[] => row.sdx ?? Array.from({ length: 12 }, (_, i) => row[`sdx${i + 1}` as keyof CmiCaseRow]).map((value) => value ? String(value) : '').filter(Boolean);
const flatProc = (row: CmiCaseRow): string[] => row.proc ?? Array.from({ length: 30 }, (_, i) => row[`proc${i + 1}` as keyof CmiCaseRow]).map((value) => value ? String(value) : '').filter(Boolean);

function mapRawRowToCmiCaseRow(row: Record<string, unknown>, fallbackAn = ''): CmiCaseRow {
  const result: CmiCaseRow = {
    an: String(row.an ?? fallbackAn), hn: maskHn(row.hn), ptname: maskName(row.ptname),
    sex: row.sex ? String(row.sex) : null, age: numericOrNull(row.age),
    pttype: row.pttype ? String(row.pttype) : null, pttypeName: row.pttype_name ? String(row.pttype_name) : null,
    firstWard: row.first_ward ? String(row.first_ward) : null, firstWardName: row.first_ward_name ? String(row.first_ward_name) : null,
    lastWard: row.last_ward ? String(row.last_ward) : null, lastWardName: row.last_ward_name ? String(row.last_ward_name) : null,
    yearMonth: row.year_month ? String(row.year_month) : null, yearBe: numericOrNull(row.year_be), monthTh: row.month_th ? String(row.month_th) : null,
    fiscalMonth: numericOrNull(row.fiscal_month), admdate: row.admdate ? String(row.admdate) : undefined, dchdate: row.dchdate ? String(row.dchdate) : undefined,
    los: numericOrNull(row.los), dchtype: row.dchtype ? String(row.dchtype) : null, dchstts: row.dchstts ? String(row.dchstts) : null,
    drg: row.drg ? String(row.drg) : null, mdc: row.mdc ? String(row.mdc) : null, rw: numericOrNull(row.rw), adjrw: numericOrNull(row.adjrw),
    grouperErr: row.grouper_err ? String(row.grouper_err) : null, pdx: row.pdx ? String(row.pdx) : null, extCause: row.ext_cause ? String(row.ext_cause) : null,
    income: numericOrNull(row.income) ?? 0, ucMoney: numericOrNull(row.uc_money) ?? 0, paidMoney: numericOrNull(row.paid_money) ?? 0, remainMoney: numericOrNull(row.remain_money) ?? 0,
    remark: row.remark ? String(row.remark) : '-',
  };
  for (let i = 1; i <= 12; i += 1) Object.assign(result, { [`sdx${i}`]: row[`sdx${i}`] ? String(row[`sdx${i}`]) : null });
  for (let i = 1; i <= 30; i += 1) Object.assign(result, { [`proc${i}`]: row[`proc${i}`] ? String(row[`proc${i}`]) : null });
  result.sdx = flatSdx(result);
  result.proc = flatProc(result);
  return result;
}

function normalizeDateParam(value: string | undefined, fallback: string): string {
  const candidate = value || fallback;
  if (!DATE_PATTERN.test(candidate)) throw new Error('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  const date = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) throw new Error('วันที่ไม่ถูกต้อง');
  return candidate;
}

export function validateWorklistQuery(params: WorklistQueryParams): Required<Pick<WorklistQueryParams, 'dstart' | 'dend' | 'pageSize' | 'sort' | 'direction'>> & WorklistQueryParams {
  const dstart = normalizeDateParam(params.dstart, DEFAULT_WORKLIST_START);
  const dend = normalizeDateParam(params.dend, DEFAULT_WORKLIST_END);
  if (dstart > dend) throw new Error('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด');
  const requestedPageSize = params.pageSize ?? params.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(requestedPageSize) || requestedPageSize <= 0) throw new Error('จำนวนรายการต่อหน้าไม่ถูกต้อง');
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requestedPageSize)));
  const sort = params.sort ?? 'dchdate';
  const direction = params.direction ?? 'desc';
  if (sort !== 'dchdate' || direction !== 'desc') throw new Error('รองรับการเรียงลำดับตามวันจำหน่ายจากใหม่ไปเก่าเท่านั้น');
  const search = (params.search ?? '').trim().slice(0, 80);
  const ward = (params.ward ?? '').trim().slice(0, 32);
  const scheme = params.scheme ?? 'all';
  const statusFilter = params.statusFilter ?? 'all';
  if (!['all', 'uncoded', 'coded'].includes(statusFilter)) throw new Error('สถานะการลงรหัสไม่ถูกต้อง');
  if (!['all', 'ucs', 'ofc', 'sss', 'other'].includes(scheme)) throw new Error('สิทธิการรักษาไม่ถูกต้อง');
  return { ...params, dstart, dend, ward, pageSize, sort, direction, search, scheme, statusFilter };
}

function normalizeCursorDate(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  const match = text.match(CURSOR_TIMESTAMP_PATTERN);
  if (!match || !DATE_PATTERN.test(match[1])) return null;
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) return null;
  if (!match[2]) return match[1];

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[6] && match[6] !== 'Z') {
    const offset = match[6].match(/^[+-](\d{2}):?(\d{2})$/);
    if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) return null;
  }

  const fraction = match[5] ? `.${match[5]}` : '';
  return `${match[1]} ${match[2]}:${match[3]}:${String(second).padStart(2, '0')}${fraction}`;
}

function cursorEncode(date: string | undefined, an: string | undefined): string | null {
  const normalizedDate = normalizeCursorDate(date);
  if (!normalizedDate || !an) return null;
  return btoa(unescape(encodeURIComponent(JSON.stringify({ date: normalizedDate, an }))));
}

function cursorDecode(cursor: string | undefined): { date: string; an: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(cursor)))) as { date?: unknown; an?: unknown };
    const date = normalizeCursorDate(typeof parsed.date === 'string' ? parsed.date : undefined);
    if (
      !date ||
      typeof parsed.an !== 'string' ||
      !/^[A-Za-z0-9-]{1,32}$/.test(parsed.an)
    ) throw new Error('bad cursor');
    return { date, an: parsed.an };
  } catch {
    throw new Error('cursor ไม่ถูกต้องหรือหมดอายุ');
  }
}

function queryParamsForWorklist(params: ReturnType<typeof validateWorklistQuery>, rates: PayerRateConfig[]): Record<string, { value: string | number; value_type: string }> {
  const cursor = cursorDecode(params.cursor);
  const rangeRate = params.scheme && params.scheme !== 'all'
    ? rates.find((rate) => rate.scheme === params.scheme && rate.effectiveFrom <= params.dstart && (!rate.effectiveTo || rate.effectiveTo >= params.dend))
    : undefined;
  return {
    dstart: { value: params.dstart, value_type: 'date' }, dend: { value: params.dend, value_type: 'date' },
    ward: { value: params.ward === 'all' ? '' : (params.ward ?? ''), value_type: 'string' },
    status_filter: { value: params.statusFilter ?? 'all', value_type: 'string' }, scheme: { value: params.scheme ?? 'all', value_type: 'string' },
    search: { value: params.search ?? '', value_type: 'string' }, cursor_date: { value: cursor?.date ?? '', value_type: 'string' }, cursor_an: { value: cursor?.an ?? '', value_type: 'string' },
    page_limit: { value: params.pageSize, value_type: 'integer' }, export_limit: { value: MAX_EXPORT_ROWS + 1, value_type: 'integer' }, revenue_rate: { value: rangeRate?.baseRate ?? 0, value_type: 'numeric' },
  };
}

function summarizeCases(cases: CmiCaseRow[], rates: PayerRateConfig[]): CaseSummary {
  const total = cases.length;
  const uncoded = cases.filter((item) => !item.pdx || item.remark === 'ยังไม่ลงรหัสโรค').length;
  const totalAdjrw = cases.reduce((sum, item) => sum + (item.adjrw ?? 0), 0);
  const totalIncome = cases.reduce((sum, item) => sum + (item.income ?? 0), 0);
  const matchingRates = cases.map((item) => resolvePayerRate(item, rates)).filter(Boolean);
  const singleRate = matchingRates.length > 0 && matchingRates.every((item) => item?.baseRate === matchingRates[0]?.baseRate) ? matchingRates[0] : null;
  return { total, uncoded, coded: total - uncoded, totalAdjrw, averageCmi: total > 0 ? totalAdjrw / total : 0, totalIncome, estimatedRevenue: calculateEstimatedRevenue(totalAdjrw, singleRate), revenueRateLabel: singleRate ? `${singleRate.label} · ${singleRate.baseRate.toLocaleString()} บาท/AdjRW` : null };
}

export async function fetchCasePage(input: WorklistQueryParams, config?: BmsConnectionConfig, opts: { signal?: AbortSignal; useDemoFallback?: boolean; rates?: PayerRateConfig[] } = {}): Promise<CasePageResult> {
  const params = validateWorklistQuery(input);
  const rates = opts.rates ?? getPayerRateConfig(opts.useDemoFallback ? 'demo' : 'runtime');

  if (opts.useDemoFallback) {
    let items = DEMO_WORKLIST_CASES.filter((item) => {
      const dateOk = (!item.dchdate || item.dchdate >= params.dstart) && (!item.dchdate || item.dchdate <= params.dend);
      const wardOk = !params.ward || params.ward === 'all' || item.firstWard === params.ward || item.lastWard === params.ward;
      const uncoded = !item.pdx || item.remark === 'ยังไม่ลงรหัสโรค';
      const statusOk = params.statusFilter === 'all' || (params.statusFilter === 'uncoded' ? uncoded : !uncoded);
      const schemeText = `${item.pttype ?? ''} ${item.pttypeName ?? ''}`.toLowerCase();
      const schemeOk = params.scheme === 'all' || (params.scheme === 'other' ? !['บัตรทอง', 'หลักประกัน', 'ข้าราชการ', 'ประกันสังคม', 'ucs', 'ofc', 'sss'].some((token) => schemeText.includes(token)) : resolvePayerRate(item, rates)?.scheme === params.scheme);
      const searchText = `${item.an} ${item.hn} ${item.ptname} ${item.pdx} ${item.firstWardName}`.toLowerCase();
      return dateOk && wardOk && statusOk && schemeOk && (!params.search || searchText.includes(params.search.toLowerCase()));
    });
    const totalCount = items.length;
    const summary = summarizeCases(items, rates);
    const cursor = cursorDecode(params.cursor);
    if (cursor) {
      items = items.filter((item) => {
        const itemDate = normalizeCursorDate(item.dchdate) ?? '';
        return itemDate < cursor.date || (itemDate === cursor.date && (item.an ?? '') > cursor.an);
      });
    }
    items = items.sort((a, b) => `${b.dchdate ?? ''}:${a.an ?? ''}`.localeCompare(`${a.dchdate ?? ''}:${b.an ?? ''}`));
    const pageItems = items.slice(0, params.pageSize);
    const last = pageItems.at(-1);
    return { items: pageItems, nextCursor: items.length > params.pageSize ? cursorEncode(last?.dchdate, last?.an) : null, hasMore: items.length > params.pageSize, count: totalCount, totalCount, summary, fetchedAt: new Date().toISOString() };
  }

  if (!config?.apiUrl) return { items: [], nextCursor: null, hasMore: false, count: 0, totalCount: 0, summary: summarizeCases([], rates), fetchedAt: new Date().toISOString() };

  const apiParams = queryParamsForWorklist(params, rates);
  // Execute sequentially to prevent HTTP 409 concurrency lock on BMS API gateway
  const pageRows = await executeCmiQuery('casePage', config, apiParams, opts.signal);
  const countRows = await executeCmiQuery('caseCount', config, apiParams, opts.signal).catch(() => []);
  const summaryRows = await executeCmiQuery('worklistSummary', config, apiParams, opts.signal).catch(() => []);
  const rows = pageRows.map((row) => mapRawRowToCmiCaseRow(row));
  const hasMore = rows.length > params.pageSize;
  const items = hasMore ? rows.slice(0, params.pageSize) : rows;
  const last = items.at(-1);
  const summaryRow = summaryRows[0] ?? {};
  const totalAdjrw = numericOrNull(summaryRow.total_adjrw) ?? 0;
  const total = numericOrNull(summaryRow.total_count) ?? numericOrNull(countRows[0]?.total_count) ?? 0;
  const uncoded = numericOrNull(summaryRow.uncoded_count) ?? 0;
  const rate = params.scheme && params.scheme !== 'all' ? rates.find((item) => item.scheme === params.scheme && item.effectiveFrom <= params.dstart && (!item.effectiveTo || item.effectiveTo >= params.dend)) : null;
  const summary: CaseSummary = { total, uncoded, coded: Math.max(0, total - uncoded), totalAdjrw, averageCmi: total > 0 ? totalAdjrw / total : 0, totalIncome: numericOrNull(summaryRow.total_income) ?? 0, estimatedRevenue: calculateEstimatedRevenue(totalAdjrw, rate ? { scheme: rate.scheme, label: rate.label, baseRate: rate.baseRate, source: 'runtime-config' } : null), revenueRateLabel: rate ? `${rate.label} · ${rate.baseRate.toLocaleString()} บาท/AdjRW` : null };
  return { items, nextCursor: hasMore ? cursorEncode(last?.dchdate, last?.an) : null, hasMore, count: total, totalCount: total, summary, fetchedAt: new Date().toISOString() };
}

export async function fetchCaseWorklist(params: WorklistQueryParams, config?: BmsConnectionConfig, opts: { signal?: AbortSignal; useDemoFallback?: boolean; rates?: PayerRateConfig[] } = {}): Promise<CmiCaseRow[]> {
  return (await fetchCasePage(params, config, opts)).items;
}

export async function fetchCaseDetail(an: string, config?: BmsConnectionConfig, opts: { signal?: AbortSignal; useDemoFallback?: boolean } = {}): Promise<CmiCaseRow> {
  const cleanAn = an.trim();
  if (!/^[A-Za-z0-9-]{1,32}$/.test(cleanAn)) throw new Error('กรุณาระบุ AN ที่ถูกต้อง');
  if (opts.useDemoFallback) return { ...(DEMO_WORKLIST_CASES.find((item) => item.an === cleanAn) ?? DEMO_CASE_DETAIL), an: cleanAn };
  if (!config?.apiUrl) throw new Error('ยังไม่ได้เชื่อมต่อ BMS Session กรุณาระบุ BMS Session ID เพื่อเชื่อมต่อฐานข้อมูล HOSxP/HIS จริง');
  const rows = await executeCmiQuery('caseDetail', config, { an: { value: cleanAn, value_type: 'string' } }, opts.signal);
  if (!rows[0]) throw new Error(`ไม่พบข้อมูลเคส AN ${cleanAn} ในระบบ`);
  return mapRawRowToCmiCaseRow(rows[0], cleanAn);
}

export async function fetchUsageItems(an: string, config?: BmsConnectionConfig, opts: { signal?: AbortSignal; useDemoFallback?: boolean; pageSize?: number } = {}): Promise<UsageLite[]> {
  const cleanAn = an.trim();
  if (!cleanAn) return [];
  if (!/^[A-Za-z0-9-]{1,32}$/.test(cleanAn)) throw new Error('กรุณาระบุ AN ที่ถูกต้อง');
  if (opts.useDemoFallback) return DEMO_USAGE_ITEMS.map((item) => ({ ...item, an: cleanAn }));
  if (!config?.apiUrl) return [];
  const rows = await executeCmiQuery('usagePage', config, { an: { value: cleanAn, value_type: 'string' }, page_limit: { value: Math.min(300, Math.max(1, opts.pageSize ?? 300)), value_type: 'integer' } }, opts.signal);
  return rows.map((row) => ({ hosGuid: row.hos_guid ? String(row.hos_guid) : null, an: cleanAn, icode: row.icode ? String(row.icode) : null, itemName: row.item_name ? String(row.item_name) : null, needOrderReason: row.need_order_reason ? String(row.need_order_reason) : null, prescReason: row.presc_reason ? String(row.presc_reason) : null, prescReason2: row.presc_reason_2 ? String(row.presc_reason_2) : null, prescReason3: row.presc_reason_3 ? String(row.presc_reason_3) : null, prescReason4: row.presc_reason_4 ? String(row.presc_reason_4) : null, prescReason5: row.presc_reason_5 ? String(row.presc_reason_5) : null, incomeName: row.income_name ? String(row.income_name) : null, sumPrice: numericOrNull(row.sum_price), qty: numericOrNull(row.qty), unitPrice: numericOrNull(row.unitprice) }));
}

export async function exportCaseWorklist(input: WorklistQueryParams, config: BmsConnectionConfig, format: 'csv' | 'xlsx' = 'csv', opts: { signal?: AbortSignal; rates?: PayerRateConfig[] } = {}): Promise<{ rows: CmiCaseRow[]; truncated: boolean; format: 'csv' | 'xlsx' }> {
  const params = validateWorklistQuery({ ...input, pageSize: MAX_EXPORT_ROWS });
  const rates = opts.rates ?? getPayerRateConfig();
  const rows = await executeCmiQuery('caseExport', config, queryParamsForWorklist(params, rates), opts.signal);
  return { rows: rows.slice(0, MAX_EXPORT_ROWS).map((row) => mapRawRowToCmiCaseRow(row)), truncated: rows.length > MAX_EXPORT_ROWS, format };
}

export function getRowSdx(row: CmiCaseRow): string[] { return flatSdx(row); }
export function getRowProcedures(row: CmiCaseRow): string[] { return flatProc(row); }
