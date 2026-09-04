import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Filter, LoaderCircle, Search, ShieldAlert, Sparkles, X } from 'lucide-react';
import { THAI_FISCAL_MONTHS, getFiscalMonthRange, getFiscalYearRange, getRecentFiscalYears, getThaiFiscalYear } from '@/utils/dateUtils';
import { auditClinicalCase } from '@/audit/clinicalAuditEngine';
import { getPayerRateConfig } from '@/config/reimbursementRates';
import { downloadCasesCsv, downloadCasesXlsx } from '@/utils/exportUtils';
import { fetchCasePage, exportCaseWorklist, isBmsSessionFailure, DEFAULT_WORKLIST_END, DEFAULT_WORKLIST_START, DEFAULT_PAGE_SIZE, type BmsConnectionConfig } from '@/services/cmiApi';
import type { CasePageResult, CmiCaseRow, PayerScheme, WorklistQueryParams } from '@/cmi/caseContract';
import type { SessionStatus } from '@/session/useBmsSession';

export interface WorklistPageProps {
  onSelectCaseForOptimization: (an: string) => void;
  connectionConfig: BmsConnectionConfig | null;
  sessionStatus: SessionStatus;
  onConnectSession?: (sid: string) => Promise<void>;
  onSessionError?: () => void;
}

interface WorklistState {
  data: CasePageResult;
  loading: boolean;
  error: string | null;
}

const emptyData = (): CasePageResult => ({
  items: [], nextCursor: null, hasMore: false, count: 0, totalCount: 0,
  summary: { total: 0, uncoded: 0, coded: 0, totalAdjrw: 0, averageCmi: 0, totalIncome: 0, estimatedRevenue: null, revenueRateLabel: null },
  fetchedAt: '',
});

type WorklistAction =
  | { type: 'loading' }
  | { type: 'success'; data: CasePageResult }
  | { type: 'error'; message: string }
  | { type: 'clear' };

function worklistReducer(state: WorklistState, action: WorklistAction): WorklistState {
  switch (action.type) {
    case 'loading': return { ...state, loading: true, error: null };
    case 'success': return { data: action.data, loading: false, error: null };
    case 'error': return { ...state, loading: false, error: action.message };
    case 'clear': return { data: emptyData(), loading: false, error: null };
    default: return state;
  }
}

function isUncoded(row: CmiCaseRow): boolean {
  return !row.pdx || row.remark === 'ยังไม่ลงรหัสโรค';
}

function formatDate(value?: string): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

function statusText(status: SessionStatus): string {
  if (status === 'connected') return 'พร้อมใช้งาน';
  if (status === 'loading') return 'กำลังเชื่อมต่อ';
  if (status === 'unsupported') return 'ฐานข้อมูลไม่รองรับ';
  if (status === 'error') return 'เชื่อมต่อไม่สำเร็จ';
  return 'ยังไม่เชื่อมต่อ';
}

function ConnectionGate({ status, onConnect }: { status: SessionStatus; onConnect?: (sid: string) => Promise<void> }) {
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onConnect || !sessionId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConnect(sessionId.trim());
      setSessionId('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถเชื่อมต่อ BMS Session ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="connection-card" aria-labelledby="connection-title">
      <div className="connection-icon"><DatabaseIcon /></div>
      <div className="connection-copy">
        <span className="eyebrow">{status === 'unsupported' ? 'SESSION NOT SUPPORTED' : 'HIS CONNECTION'}</span>
        <h2 id="connection-title">{status === 'unsupported' ? 'Session นี้ยังใช้งานกับระบบนี้ไม่ได้' : 'พร้อมเชื่อมต่อทะเบียนเคสจริง'}</h2>
        <p>{status === 'unsupported' ? 'IPTImprove ต้องใช้ BMS Session ที่เชื่อมต่อ PostgreSQL พร้อม API URL ของโรงพยาบาล' : 'ใส่ BMS Session ID เพื่ออ่านข้อมูลจาก HOSxP แบบ read-only ระบบจะไม่ส่งข้อมูลกลับไปแก้ไข HIS'}</p>
      </div>
      {onConnect && (
        <form className="connection-form" onSubmit={submit}>
          <label htmlFor="bms-session-id">BMS Session ID</label>
          <div className="input-with-action">
            <input id="bms-session-id" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="ระบุ BMS Session ID" autoComplete="off" />
            <button className="button button-primary" type="submit" disabled={busy || !sessionId.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : 'เชื่อมต่อ'}</button>
          </div>
          {(error || status === 'error') && <span className="field-error" role="alert">{error || 'ตรวจสอบ Session ID และลองใหม่อีกครั้ง'}</span>}
        </form>
      )}
    </section>
  );
}

function DatabaseIcon() {
  return <span aria-hidden="true"><ShieldAlert size={20} /></span>;
}

function KpiCard({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: 'neutral' | 'danger' | 'success' | 'accent' | 'warning' }) {
  return <article className={`kpi-card kpi-${tone}`}><span className="kpi-label">{label}</span><strong className="kpi-value">{value}</strong>{detail && <span className="kpi-detail">{detail}</span>}</article>;
}

function CaseSignal({ row }: { row: CmiCaseRow }) {
  const audit = auditClinicalCase({
    an: row.an ?? '', age: row.age, sex: row.sex, los: row.los ?? 0, pdx: row.pdx,
    sdx: row.sdx ?? [row.sdx1, row.sdx2, row.sdx3, row.sdx4, row.sdx5, row.sdx6, row.sdx7, row.sdx8, row.sdx9, row.sdx10, row.sdx11, row.sdx12].filter(Boolean) as string[],
    proc: row.proc ?? [row.proc1, row.proc2, row.proc3, row.proc4, row.proc5, row.proc6, row.proc7, row.proc8, row.proc9, row.proc10, row.proc11, row.proc12].filter(Boolean) as string[],
    rw: row.rw, adjrw: row.adjrw, pttype: row.pttype, pttypeName: row.pttypeName, dchdate: row.dchdate,
    reimbursementRates: getPayerRateConfig('runtime'),
  });
  const tone = audit.grade === 'A' ? 'good' : audit.grade === 'B' ? 'notice' : 'risk';
  return <div className={`signal-badge signal-${tone}`}><span>เกรด {audit.grade}</span><small>{audit.issues.length ? `${audit.issues.length} ประเด็น` : 'ผ่านเบื้องต้น'}</small></div>;
}

function CodeChips({ row }: { row: CmiCaseRow }) {
  const sdx = row.sdx ?? [row.sdx1, row.sdx2, row.sdx3, row.sdx4, row.sdx5, row.sdx6, row.sdx7, row.sdx8, row.sdx9, row.sdx10, row.sdx11, row.sdx12].filter(Boolean) as string[];
  return <div className="code-stack"><span className="code-pill code-pdx">{row.pdx || 'ยังไม่มี PDx'}</span>{sdx.length > 0 && <span className="code-more">+{sdx.length} SDx</span>}</div>;
}

function CaseCard({ row, onOpen }: { row: CmiCaseRow; onOpen: (an: string) => void }) {
  const uncoded = isUncoded(row);
  return <article className={`case-card ${uncoded ? 'case-uncoded' : ''}`}>
    <div className="case-card-signal" aria-hidden="true" />
    <div className="case-card-head"><div><span className="case-label">AN</span><strong>{row.an}</strong><span className="muted">HN {row.hn || '—'}</span></div><CaseSignal row={row} /></div>
    <div className="case-card-grid"><div><span className="field-label">ผู้ป่วย</span><strong>{row.ptname || 'ไม่ระบุชื่อ'}</strong><span className="muted">{row.sex || '—'} · {row.age ?? '—'} ปี</span></div><div><span className="field-label">วันจำหน่าย</span><strong>{formatDate(row.dchdate)}</strong><span className="muted">LOS {row.los ?? '—'} วัน</span></div><div><span className="field-label">DRG / AdjRW</span><strong>{row.drg || 'ยังไม่จัดกลุ่ม'}</strong><span className="muted">{row.adjrw != null ? Number(row.adjrw).toFixed(4) : '—'}</span></div></div>
    <div className="case-card-foot"><div><span className="field-label">รหัสโรค</span><CodeChips row={row} /></div><button className="button button-primary button-small" type="button" onClick={() => onOpen(row.an ?? '')}><Sparkles size={14} />{uncoded ? 'ให้รหัส & วิเคราะห์' : 'วิเคราะห์ DRG'}</button></div>
  </article>;
}

function CaseTable({ rows, onOpen }: { rows: CmiCaseRow[]; onOpen: (an: string) => void }) {
  return <div className="table-shell"><table className="case-table"><caption className="sr-only">รายการเคสผู้ป่วยใน</caption><thead><tr><th>AN / HN</th><th>ผู้ป่วย</th><th>หอผู้ป่วย</th><th>จำหน่าย / LOS</th><th>PDx / SDx</th><th>DRG / AdjRW</th><th>สัญญาณคุณภาพ</th><th aria-label="การดำเนินการ" /></tr></thead><tbody>{rows.map((row) => <tr key={row.an} className={isUncoded(row) ? 'row-uncoded' : ''}><td><strong>AN: {row.an}</strong><span className="muted">HN: {row.hn || '—'}</span></td><td><strong>{row.ptname || 'ไม่ระบุชื่อ'}</strong><span className="muted">{row.sex || '—'} · อายุ {row.age ?? '—'} ปี</span></td><td><strong>{row.firstWardName || row.lastWardName || row.firstWard || '—'}</strong><span className="muted">{row.pttypeName || row.pttype || '—'}</span></td><td><strong>{formatDate(row.dchdate)}</strong><span className="muted">วันนอน {row.los ?? '—'} วัน</span></td><td><CodeChips row={row} /></td><td><strong>{row.drg || '—'}</strong><span className="muted accent-text">AdjRW {row.adjrw != null ? Number(row.adjrw).toFixed(4) : '—'}</span></td><td><CaseSignal row={row} /></td><td><button className="button button-secondary button-small" type="button" onClick={() => onOpen(row.an ?? '')} aria-label={`วิเคราะห์เคส AN ${row.an}`}><Sparkles size={14} />เปิดเคส</button></td></tr>)}</tbody></table></div>;
}

export function WorklistPage({ onSelectCaseForOptimization, connectionConfig, sessionStatus, onConnectSession, onSessionError }: WorklistPageProps) {
  const currentFiscalYear = useMemo(() => getThaiFiscalYear(), []);
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number | 'query_all'>('query_all');
  const [selectedFiscalMonth, setSelectedFiscalMonth] = useState<number | 'all'>('all');
  const [dstart, setDstart] = useState(DEFAULT_WORKLIST_START);
  const [dend, setDend] = useState(DEFAULT_WORKLIST_END);
  const [ward, setWard] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'uncoded' | 'coded'>('all');
  const [scheme, setScheme] = useState<PayerScheme | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [state, dispatch] = useReducer(worklistReducer, { data: emptyData(), loading: false, error: null });
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setCursorStack((stack) => stack.length === 0 ? stack : []);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const query = useMemo<WorklistQueryParams>(() => ({ dstart, dend, ward: ward || undefined, statusFilter, scheme, search: debouncedSearch, pageSize: DEFAULT_PAGE_SIZE, cursor: cursorStack.at(-1) }), [dstart, dend, ward, statusFilter, scheme, debouncedSearch, cursorStack]);

  useEffect(() => {
    const id = ++requestId.current;
    if (sessionStatus !== 'connected' || !connectionConfig?.apiUrl) {
      dispatch({ type: 'clear' });
      return undefined;
    }
    const controller = new AbortController();
    dispatch({ type: 'loading' });
    fetchCasePage(query, connectionConfig, { signal: controller.signal })
      .then((data) => { if (id === requestId.current && !controller.signal.aborted) dispatch({ type: 'success', data }); })
      .catch((error: unknown) => { if (id === requestId.current && !controller.signal.aborted) { if (isBmsSessionFailure(error)) onSessionError?.(); dispatch({ type: 'error', message: error instanceof Error ? error.message : 'โหลดทะเบียนเคสไม่สำเร็จ' }); } });
    return () => controller.abort();
  }, [query, connectionConfig, onSessionError, sessionStatus, reloadKey]);

  const resetPaging = () => setCursorStack((stack) => stack.length === 0 ? stack : []);
  const handleFiscalYear = (value: string) => {
    if (value === 'query_all') { setSelectedFiscalYear('query_all'); setSelectedFiscalMonth('all'); setDstart(DEFAULT_WORKLIST_START); setDend(DEFAULT_WORKLIST_END); resetPaging(); return; }
    const year = Number(value);
    setSelectedFiscalYear(year); setSelectedFiscalMonth('all');
    const range = getFiscalYearRange(year, false);
    setDstart(range.dstart); setDend(range.dend); resetPaging();
  };
  const handleFiscalMonth = (value: string) => {
    if (value === 'all') {
      setSelectedFiscalMonth('all');
      const range = selectedFiscalYear === 'query_all' ? { dstart: DEFAULT_WORKLIST_START, dend: DEFAULT_WORKLIST_END } : getFiscalYearRange(selectedFiscalYear, false);
      setDstart(range.dstart); setDend(range.dend); resetPaging(); return;
    }
    const month = Number(value);
    setSelectedFiscalMonth(month);
    const range = getFiscalMonthRange(selectedFiscalYear === 'query_all' ? currentFiscalYear : selectedFiscalYear, month);
    setDstart(range.dstart); setDend(range.dend); resetPaging();
  };
  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (sessionStatus !== 'connected' || !connectionConfig) {
      if (sessionStatus === 'demo') {
        if (format === 'csv') downloadCasesCsv(state.data.items); else downloadCasesXlsx(state.data.items);
      }
      return;
    }
    setExporting(true);
    try {
      const result = await exportCaseWorklist({ ...query, cursor: undefined }, connectionConfig, format);
      if (format === 'csv') downloadCasesCsv(result.rows); else downloadCasesXlsx(result.rows);
      if (result.truncated) dispatch({ type: 'error', message: 'รายการเกิน 10,000 เคส ระบบส่งออกเฉพาะ 10,000 รายการแรก' });
    } catch (error) {
      if (isBmsSessionFailure(error)) onSessionError?.();
      dispatch({ type: 'error', message: error instanceof Error ? error.message : 'ส่งออกข้อมูลไม่สำเร็จ' });
    } finally { setExporting(false); }
  };

  const fiscalYears = useMemo(() => getRecentFiscalYears(6), []);
  const summary = state.data.summary;
  const rangeLabel = `${dstart} — ${dend}`;
  const noSession = sessionStatus !== 'connected';

  return <div className="page-stack">
    <section className="page-intro">
      <div><span className="eyebrow">INPATIENT WORKLIST</span><h2>ทะเบียนเคสที่ต้องตัดสินใจ</h2><p>คัดกรองเคสผู้ป่วยในจาก HIS แล้วเปิดการวิเคราะห์ DRG เมื่อมีหลักฐานพร้อม</p></div>
      <div className={`status-note status-note-${sessionStatus}`}><span className="status-dot" />{statusText(sessionStatus)}</div>
    </section>

    {noSession && <ConnectionGate status={sessionStatus} onConnect={onConnectSession} />}

    <section className="filter-panel" aria-label="ตัวกรองทะเบียนเคส">
      <div className="filter-panel-head"><div><span className="eyebrow"><Filter size={13} /> QUERY CONTROL</span><h3>ช่วงข้อมูลและตัวกรอง</h3></div><span className="query-range"><CalendarDays size={14} />{rangeLabel}</span></div>
      <div className="filter-grid">
        <label className="field"><span>ปีงบประมาณ</span><select value={selectedFiscalYear} onChange={(event) => handleFiscalYear(event.target.value)}><option value="query_all">ทั้งหมด · Query range</option>{fiscalYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
        <label className="field"><span>เดือนในรอบปีงบฯ</span><select value={selectedFiscalMonth} onChange={(event) => handleFiscalMonth(event.target.value)}><option value="all">ทั้งปีงบประมาณ</option>{THAI_FISCAL_MONTHS.map((month) => <option key={month.fiscalMonth} value={month.fiscalMonth}>{month.name} · {month.fullName}</option>)}</select></label>
        <label className="field"><span>หอผู้ป่วย</span><input value={ward} onChange={(event) => { setWard(event.target.value); resetPaging(); }} placeholder="ทุกหอผู้ป่วย หรือระบุรหัส" list="ward-suggestions" /><datalist id="ward-suggestions">{state.data.items.flatMap((item) => [item.firstWard && `${item.firstWard} · ${item.firstWardName ?? ''}`, item.lastWard && `${item.lastWard} · ${item.lastWardName ?? ''}`]).filter(Boolean).map((item, index) => <option key={`${item}-${index}`} value={String(item).split(' · ')[0]}>{item}</option>)}</datalist></label>
        <label className="field"><span>สถานะการลงรหัส</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); resetPaging(); }}><option value="all">ทุกสถานะ</option><option value="uncoded">ยังไม่ลงรหัส</option><option value="coded">ลงรหัสแล้ว</option></select></label>
        <label className="field"><span>สิทธิ์การรักษา</span><select value={scheme} onChange={(event) => { setScheme(event.target.value as PayerScheme | 'all'); resetPaging(); }}><option value="all">ทุกสิทธิ์</option><option value="ucs">UCS · บัตรทอง</option><option value="ofc">OFC · ข้าราชการ</option><option value="sss">SSS · ประกันสังคม</option><option value="other">อื่น ๆ / ไม่ระบุ</option></select></label>
      </div>
      <div className="filter-foot"><label className="search-field"><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ค้นหา AN, HN ที่ mask แล้ว, ชื่อที่ mask แล้ว, PDx หรือหอผู้ป่วย" aria-label="ค้นหาเคส" /><span className="search-hint">ค้นหาแบบ server-side</span></label><button className="button button-quiet" type="button" onClick={() => { setSearchInput(''); setDebouncedSearch(''); setWard(''); setStatusFilter('all'); setScheme('all'); resetPaging(); }}><X size={15} />ล้างตัวกรอง</button></div>
      {selectedFiscalYear === 'query_all' && <div className="date-editor"><label className="field"><span>ตั้งแต่วันที่</span><input type="date" value={dstart} onChange={(event) => { setDstart(event.target.value); resetPaging(); }} /></label><span className="date-arrow">ถึง</span><label className="field"><span>ถึงวันที่</span><input type="date" value={dend} onChange={(event) => { setDend(event.target.value); resetPaging(); }} /></label></div>}
    </section>

    <section className="kpi-grid" aria-label="สรุปทะเบียนเคส"><KpiCard label="เคสทั้งหมด" value={`${summary.total.toLocaleString()} ราย`} detail="ตาม filter ปัจจุบัน" /><KpiCard label="ยังไม่ลงรหัส" value={`${summary.uncoded.toLocaleString()} ราย`} detail="ต้องทบทวนก่อนส่ง Grouper" tone="danger" /><KpiCard label="ลงรหัสแล้ว" value={`${summary.coded.toLocaleString()} ราย`} detail={`${summary.total ? Math.round(summary.coded / summary.total * 100) : 0}% ของทั้งหมด`} tone="success" /><KpiCard label="ค่าเฉลี่ย CMI" value={summary.averageCmi.toFixed(4)} detail={`รวม AdjRW ${summary.totalAdjrw.toFixed(4)}`} tone="accent" /><KpiCard label="ประมาณการชดเชย" value={summary.estimatedRevenue == null ? 'ยังไม่ตั้งค่า' : `฿${summary.estimatedRevenue.toLocaleString()}`} detail={summary.revenueRateLabel ?? 'เลือกสิทธิ์และตั้ง rate ก่อนคำนวณ'} tone="warning" /></section>

    <section className="results-panel"><div className="results-head"><div><span className="eyebrow">CASE QUEUE</span><h3>{state.loading ? 'กำลังอ่านข้อมูลจาก HIS…' : `${state.data.items.length.toLocaleString()} เคสในหน้านี้`}</h3><p>{state.data.totalCount?.toLocaleString() ?? '—'} เคสตามเงื่อนไข · อัปเดต {state.data.fetchedAt ? new Date(state.data.fetchedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'}</p></div><div className="results-actions"><button className="button button-secondary" type="button" disabled={exporting || noSession || state.data.items.length === 0} onClick={() => handleExport('csv')}><Download size={15} />CSV</button><button className="button button-secondary" type="button" disabled={exporting || noSession || state.data.items.length === 0} onClick={() => handleExport('xlsx')}><FileSpreadsheet size={15} />XLSX</button></div></div>
      {state.loading && <div className="loading-state"><LoaderCircle className="spin" size={26} /><strong>กำลังค้นหาเคสตามเงื่อนไข</strong><span>ระบบกำลังประมวลผลที่ database และจะไม่โหลดข้อมูลทั้งช่วงวันที่เข้าหน่วยความจำ</span></div>}
      {!state.loading && state.error && <div className="error-state" role="alert"><AlertCircle size={24} /><div><strong>โหลดข้อมูลไม่สำเร็จ</strong><span>{state.error}</span></div><button className="button button-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>ลองใหม่</button></div>}
      {!state.loading && !state.error && noSession && <div className="empty-state"><ShieldAlert size={28} /><strong>ยังไม่ได้เชื่อมต่อ HIS</strong><span>เชื่อมต่อ BMS Session เพื่อเปิดทะเบียนเคสจริง</span></div>}
      {!state.loading && !state.error && !noSession && state.data.items.length === 0 && <div className="empty-state"><CheckCircle2 size={28} /><strong>ไม่พบเคสตามเงื่อนไข</strong><span>ลองเปลี่ยนช่วงวันที่หรือเคลียร์ filter แล้วค้นหาอีกครั้ง</span></div>}
      {!state.loading && !state.error && state.data.items.length > 0 && <><div className="desktop-results"><CaseTable rows={state.data.items} onOpen={onSelectCaseForOptimization} /></div><div className="mobile-results">{state.data.items.map((row) => <CaseCard key={row.an} row={row} onOpen={onSelectCaseForOptimization} />)}</div></>}
      <div className="pagination"><span>หน้า {cursorStack.length + 1} · แสดง {state.data.items.length} จาก {state.data.totalCount?.toLocaleString() ?? '—'}</span><div><button className="icon-button" type="button" disabled={cursorStack.length === 0 || state.loading} onClick={() => setCursorStack((stack) => stack.slice(0, -1))} aria-label="หน้าก่อนหน้า"><ChevronLeft size={17} /></button><button className="icon-button" type="button" disabled={!state.data.hasMore || state.loading} onClick={() => { if (state.data.nextCursor) setCursorStack((stack) => [...stack, state.data.nextCursor!]); }} aria-label="หน้าถัดไป"><ChevronRight size={17} /></button></div></div>
    </section>
  </div>;
}
