import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleStop, Clock3, Database, LoaderCircle, Plus, RotateCw, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { cmiCaseToDrgInput } from '@/cmi/caseAdapter';
import type { CmiCaseRow, UsageLite } from '@/cmi/caseContract';
import { extractCandidates, cleanIcdCode, type DxCandidate } from '@/suggest/candidateExtractor';
import { suggestHigherDrg, type BaselineResult, type SuggestFailure, type Suggestion, type SuggestProgress } from '@/suggest/suggestEngine';
import { fetchCaseDetail, fetchUsageItems, getRowProcedures, getRowSdx, isBmsSessionFailure, type BmsConnectionConfig } from '@/services/cmiApi';
import { DEFAULT_HCODE } from '@/drg/grouperContract';
import { auditClinicalCase, type ClinicalAuditResult } from '@/audit/clinicalAuditEngine';
import { ClinicalAuditPanel } from '@/components/ClinicalAuditPanel';
import type { SessionStatus } from '@/session/useBmsSession';
import { getPayerRateConfig } from '@/config/reimbursementRates';

export interface OptimizerPageProps {
  initialAn?: string;
  onBackToWorklist?: () => void;
  externalSessionId?: string;
  externalConfig?: BmsConnectionConfig | null;
  externalStatus?: SessionStatus;
  onConnectSession?: (sid: string) => Promise<void>;
  onSessionError?: () => void;
}

const isAbort = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError');

function CodeSet({ title, codes, tone = 'neutral' }: { title: string; codes: string[]; tone?: 'pdx' | 'sdx' | 'proc' | 'neutral' }) {
  return <div className="code-set"><span className="field-label">{title}</span>{codes.length > 0 ? <div className="code-list">{codes.map((code, index) => <span className={`code-pill code-${tone}`} key={`${code}-${index}`}>{code}</span>)}</div> : <span className="muted">ไม่มีข้อมูล</span>}</div>;
}

function UsageEvidence({ items }: { items: UsageLite[] }) {
  if (items.length === 0) return <div className="empty-inline"><Database size={18} />ไม่พบรายการยา/เวชภัณฑ์สำหรับสร้างหลักฐาน</div>;
  return <div className="evidence-list">{items.map((item, index) => <article className="evidence-item" key={`${item.hosGuid ?? item.icode ?? 'item'}-${index}`}><div className="evidence-marker">{index + 1}</div><div><strong>{item.itemName || item.icode || 'รายการไม่ระบุชื่อ'}</strong><span>{item.needOrderReason || item.prescReason || 'ไม่มีเหตุผลกำกับรายการ'}</span>{item.prescReason && <small>presc: {item.prescReason}</small>}</div></article>)}</div>;
}

function SuggestionCard({ suggestion, index }: { suggestion: Suggestion; index: number }) {
  return <article className="suggestion-card"><div className="suggestion-rank">{String(index + 1).padStart(2, '0')}</div><div className="suggestion-main"><div className="suggestion-title"><strong>{suggestion.kind === 'swap_pdx' ? 'สลับ PDx' : 'เพิ่ม SDx'}</strong><span className="code-pill code-pdx">{suggestion.drg}</span></div><p>{suggestion.reason}</p><div className="suggestion-codes"><span>PDx <b>{suggestion.pdx}</b></span><span>AdjRW <b>{suggestion.adjrw != null ? suggestion.adjrw.toFixed(4) : '—'}</b></span><span className="delta-positive">Δ +{suggestion.delta?.toFixed(4) ?? '—'}</span></div>{suggestion.evidence && suggestion.evidence.length > 0 && <details><summary>ดูหลักฐาน ({suggestion.evidence.length})</summary><ul>{suggestion.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></details>}</div></article>;
}

function ConnectionPrompt({ status, onConnect }: { status: SessionStatus; onConnect?: (sid: string) => Promise<void> }) {
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onConnect || !sessionId.trim()) return;
    setBusy(true); setError(null);
    try { await onConnect(sessionId.trim()); setSessionId(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'เชื่อมต่อไม่สำเร็จ'); }
    finally { setBusy(false); }
  };
  return <section className="connection-card compact"><div className="connection-icon"><ShieldCheck size={20} /></div><div className="connection-copy"><span className="eyebrow">HIS ACCESS REQUIRED</span><h2>ต้องเชื่อมต่อ HIS ก่อนวิเคราะห์เคสจริง</h2><p>{status === 'unsupported' ? 'BMS Session นี้ไม่ใช่ PostgreSQL หรือไม่มี API URL ที่รองรับ' : 'ใช้ BMS Session ID เพื่อดึง Case Detail และ Usage แบบ read-only'}</p></div>{onConnect && <form className="connection-form" onSubmit={submit}><label htmlFor="optimizer-session-id">BMS Session ID</label><div className="input-with-action"><input id="optimizer-session-id" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="ระบุ BMS Session ID" autoComplete="off" /><button className="button button-primary" disabled={busy || !sessionId.trim()} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : 'เชื่อมต่อ'}</button></div>{error && <span className="field-error" role="alert">{error}</span>}</form>}</section>;
}

export function OptimizerPage({ initialAn, onBackToWorklist, externalConfig, externalStatus = 'idle', onConnectSession, onSessionError }: OptimizerPageProps) {
  const [anInput, setAnInput] = useState(initialAn ?? '');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [progress, setProgress] = useState<SuggestProgress | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentCase, setCurrentCase] = useState<CmiCaseRow | null>(null);
  const [usageItems, setUsageItems] = useState<UsageLite[]>([]);
  const [candidates, setCandidates] = useState<DxCandidate[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [baseline, setBaseline] = useState<BaselineResult | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [failures, setFailures] = useState<SuggestFailure[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const isDemo = externalStatus === 'demo';
  const rates = useMemo(() => getPayerRateConfig(isDemo ? 'demo' : 'runtime'), [isDemo]);
  const hcode = externalConfig?.hospitalCode ?? DEFAULT_HCODE;

  const stopAnalysis = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const handleLoadAndOptimize = useCallback(async (targetAn?: string, additionalCandidate?: string, forceRefresh = false) => {
    const an = (targetAn ?? anInput).trim();
    if (!an) { setError('กรุณาระบุเลข AN ที่ต้องการค้นหา'); return; }
    stopAnalysis();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestRef.current;
    setAnInput(an); setLoading(true); setCancelled(false); setError(null); setBaseline(null); setSuggestions([]); setFailures([]); setProgress(null); setCandidates([]); setCurrentCase(null);
    try {
      setLoadingStep('กำลังดึงข้อมูลเคสจาก HIS…');
      const row = await fetchCaseDetail(an, externalConfig ?? undefined, { signal: controller.signal, useDemoFallback: isDemo, bypassCache: forceRefresh });
      if (requestId !== requestRef.current) return;
      setCurrentCase(row);
      setLoadingStep('กำลังอ่านรายการยาและเวชภัณฑ์เพื่อสร้างหลักฐาน…');
      const usage = await fetchUsageItems(an, externalConfig ?? undefined, { signal: controller.signal, useDemoFallback: isDemo, bypassCache: forceRefresh });
      if (requestId !== requestRef.current) return;
      setUsageItems(usage);
      setLoadingStep('กำลังสกัดรหัสที่มีหลักฐานกำกับ และรหัส SDx เดิม…');
      let extracted = extractCandidates(usage);

      // Include all existing SDx on this case from HIS into permutation testing
      const existingSdx = getRowSdx(row);
      for (const code of existingSdx) {
        if (!code || code === row.pdx) continue;
        const normalized = cleanIcdCode(code);
        if (!extracted.some((item) => item.code === normalized)) {
          extracted.push({
            code: normalized,
            source: 'existing_sdx',
            evidence: ['รหัส SDx ที่บันทึกในเวชระเบียน HIS (iptdiag) สำหรับเคสนี้'],
          });
        }
      }

      if (additionalCandidate) {
        const code = cleanIcdCode(additionalCandidate);
        if (!/^[A-Z0-9]{3,8}$/.test(code)) throw new Error('รหัสที่เพิ่มต้องเป็น ICD code ที่มีรูปแบบถูกต้อง');
        if (!extracted.some((item) => item.code === code)) extracted = [{ code, source: 'coder_manual', evidence: ['เพิ่มโดย Coder เพื่อทบทวนเพิ่มเติม'] }, ...extracted];
      }
      setCandidates(extracted);
      setLoadingStep('กำลังเรียก MOPH Grouper ตามลำดับเพื่อเทียบ DRG…');
      const input = cmiCaseToDrgInput(row, { hcode });
      const result = await suggestHigherDrg(
        input,
        extracted.map((item) => ({
          code: item.code,
          reason: item.source === 'existing_sdx'
            ? 'สลับ SDx เดิมใน HIS ขึ้นเป็น PDx เพื่อเปรียบเทียบทางเลือก'
            : item.source === 'coder_manual'
              ? 'ทดสอบตามที่ Coder เพิ่มรหัสเอง'
              : `พบในหลักฐานการใช้ยา (${item.source})`,
          evidence: item.evidence,
        })),
        { signal: controller.signal, maxCandidates: 25, onProgress: setProgress }
      );
      if (requestId !== requestRef.current) return;
      setBaseline(result.baseline); setSuggestions(result.suggestions); setFailures(result.failures); setCancelled(result.cancelled);
    } catch (reason) {
      if (requestId === requestRef.current) {
        if (isAbort(reason)) setCancelled(true);
        else { if (isBmsSessionFailure(reason)) onSessionError?.(); setError(reason instanceof Error ? reason.message : 'เกิดข้อผิดพลาดในการวิเคราะห์เคส'); }
      }
    } finally {
      if (requestId === requestRef.current) { setLoading(false); setLoadingStep(''); controllerRef.current = null; }
    }
  }, [anInput, externalConfig, hcode, isDemo, onSessionError, stopAnalysis]);

  useEffect(() => {
    if (!initialAn) return undefined;
    const timer = window.setTimeout(() => void handleLoadAndOptimize(initialAn), 0);
    return () => { window.clearTimeout(timer); stopAnalysis(); };
  }, [initialAn, handleLoadAndOptimize, stopAnalysis]);

  const addManualCandidate = async () => {
    const code = cleanIcdCode(manualCode);
    if (!/^[A-Z0-9]{3,8}$/.test(code)) { setError('กรุณาระบุ ICD code ที่ถูกต้อง เช่น A419 หรือ N184'); return; }
    setManualCode('');
    await handleLoadAndOptimize(currentCase?.an, code);
  };

  const auditResult = useMemo<ClinicalAuditResult | null>(() => {
    if (!currentCase) return null;
    return auditClinicalCase({
      an: currentCase.an ?? '', age: currentCase.age, sex: currentCase.sex, los: currentCase.los ?? 0, pdx: currentCase.pdx,
      sdx: getRowSdx(currentCase),
      proc: getRowProcedures(currentCase),
      rw: baseline?.rw ?? currentCase.rw, adjrw: baseline?.adjrw ?? currentCase.adjrw, wtlos: baseline?.wtlos, ot: baseline?.ot, pttype: currentCase.pttype, pttypeName: currentCase.pttypeName, dchdate: currentCase.dchdate, reimbursementRates: rates,
    });
  }, [baseline, currentCase, rates]);

  const sdx = currentCase ? getRowSdx(currentCase) : [];
  const proc = currentCase ? getRowProcedures(currentCase) : [];

  return <div className="page-stack optimizer-page">
    <section className="page-intro optimizer-intro"><div><span className="eyebrow">DRG REVIEW WORKBENCH</span><h2>วิเคราะห์เคสจากหลักฐาน</h2><p>ข้อเสนอแนะเพื่อทบทวนโดย Coder เท่านั้น · ระบบไม่เขียนข้อมูลกลับ HIS</p></div><button className="button button-quiet" type="button" onClick={onBackToWorklist}><ArrowLeft size={16} />กลับทะเบียนเคส</button></section>
    {externalStatus !== 'connected' && !isDemo && <ConnectionPrompt status={externalStatus} onConnect={onConnectSession} />}
    <section className="case-search-panel"><div className="search-field large"><Search size={18} /><label className="sr-only" htmlFor="an-search">เลข AN</label><input id="an-search" value={anInput} onChange={(event) => setAnInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleLoadAndOptimize(); }} placeholder="ค้นหา AN เพื่อเริ่มวิเคราะห์" inputMode="numeric" /><button className="button button-primary" type="button" onClick={() => void handleLoadAndOptimize()} disabled={loading || !anInput.trim()}>{loading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} {loading ? 'กำลังวิเคราะห์' : 'โหลดเคส'}</button>{currentCase && <button className="button button-secondary" type="button" onClick={() => void handleLoadAndOptimize(currentCase.an, undefined, true)} disabled={loading} title="ดึงข้อมูลสดจากฐานข้อมูล HIS ใหม่ โดยไม่ใช้แคช"><RotateCw size={15} />รีเฟรชสด</button>}{loading && <button className="button button-danger-quiet" type="button" onClick={stopAnalysis}><CircleStop size={16} />ยกเลิก</button>}</div>{error && <div className="inline-error" role="alert"><AlertTriangle size={17} /><span>{error}</span>{anInput.trim() && <button className="button button-secondary button-small" type="button" onClick={() => void handleLoadAndOptimize(anInput, undefined, true)}>ลองใหม่ (สด)</button>}<button className="icon-button" type="button" onClick={() => setError(null)} aria-label="ปิดข้อความผิดพลาด"><X size={15} /></button></div>}</section>
    {loading && <section className="analysis-progress"><div className="progress-orbit"><LoaderCircle className="spin" size={24} /></div><div><strong>{loadingStep}</strong><span>{progress ? `ประมวลผล Grouper ${progress.completed}/${progress.total}` : 'กรุณารอสักครู่ ระบบกำลังตรวจสอบข้อมูลตามลำดับ'}</span></div></section>}
    {!loading && cancelled && <div className="inline-warning" role="status"><CircleStop size={17} />ยกเลิกการคำนวณแล้ว — ผลลัพธ์ที่แสดงเป็นเพียงบางส่วน</div>}
    {!loading && !currentCase && !error && <div className="empty-state large"><Sparkles size={30} /><strong>เลือกเคสเพื่อเริ่มการวิเคราะห์</strong><span>ระบุ AN จากทะเบียนเคส แล้วระบบจะดึงข้อมูลจริงและแสดงคำแนะนำที่มีหลักฐานกำกับ</span></div>}
    {currentCase && <>
      <section className="case-identity-panel"><div className="identity-main"><span className="eyebrow">CASE {currentCase.an}</span><h3>{currentCase.ptname || 'ไม่ระบุชื่อผู้ป่วย'}</h3><div className="identity-meta"><span>HN {currentCase.hn || '—'}</span><span>{currentCase.sex || '—'} · {currentCase.age ?? '—'} ปี</span><span>LOS {currentCase.los ?? '—'} วัน</span><span>{currentCase.firstWardName || currentCase.firstWard || 'ไม่ระบุหอผู้ป่วย'}</span></div></div><div className="identity-drg"><span>DRG จาก HIS</span><strong>{currentCase.drg || '—'}</strong><small>AdjRW {currentCase.adjrw != null ? Number(currentCase.adjrw).toFixed(4) : '—'}</small></div></section>
      <section className="code-overview"><CodeSet title="PDx · วินิจฉัยหลัก" codes={currentCase.pdx ? [currentCase.pdx] : []} tone="pdx" /><CodeSet title={`SDx · วินิจฉัยร่วม (${sdx.length}/12)`} codes={sdx} tone="sdx" /><CodeSet title={`Procedure · หัตถการ (${proc.length}/30)`} codes={proc} tone="proc" /></section>
      <section className="analysis-grid"><div className="analysis-main"><div className="section-heading"><div><span className="eyebrow">GROUPER COMPARISON</span><h3>Baseline และโอกาสปรับปรุง</h3></div><span className="source-badge"><CheckCircle2 size={14} />MOPH V6</span></div><div className="compare-grid"><article className="compare-card"><span className="compare-label">Baseline จาก Grouper</span><strong>{baseline?.drg || currentCase.drg || 'ยังไม่ได้คำนวณ'}</strong><span>AdjRW {baseline?.adjrw != null ? baseline.adjrw.toFixed(4) : currentCase.adjrw != null ? Number(currentCase.adjrw).toFixed(4) : '—'}</span><small>{baseline?.wtlos != null ? `WtLOS ${baseline.wtlos.toFixed(2)} · OT ${baseline.ot ?? '—'}` : 'ข้อมูลจากเคสปัจจุบัน'}</small>{baseline?.error && <span className="grouper-error" role="alert">Grouper error: {baseline.error}</span>}{baseline?.warning && <span className="grouper-warning">Grouper warning: {baseline.warning}</span>}</article><article className="compare-card compare-opportunity"><span className="compare-label">คำแนะนำที่มี delta สูงสุด</span><strong>{suggestions[0]?.drg || '—'}</strong><span>{suggestions[0]?.delta != null ? `+${suggestions[0].delta.toFixed(4)} AdjRW` : 'ยังไม่มีคำแนะนำที่ผ่านเกณฑ์'}</span><small>{suggestions.length ? `${suggestions.length} ทางเลือกที่มีผลบวก` : 'ต้องมี evidence และผล Grouper ที่สูงขึ้น'}</small></article></div><div className="suggestion-header"><div><h3>คำแนะนำจาก Candidate</h3><p>ระบบจะแสดงเฉพาะ permutation ที่ AdjRW เพิ่มขึ้นและมีหลักฐานประกอบ</p></div><div className="manual-candidate"><input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="เพิ่ม ICD เช่น N184" aria-label="เพิ่ม ICD candidate" /><button className="button button-secondary button-small" type="button" onClick={() => void addManualCandidate()} disabled={loading}><Plus size={14} />เพิ่ม</button></div></div>{suggestions.length > 0 ? <div className="suggestion-list">{suggestions.map((item, index) => <SuggestionCard suggestion={item} index={index} key={`${item.kind}-${item.pdx}-${index}`} />)}</div> : <div className="empty-inline"><CheckCircle2 size={18} />ยังไม่พบคำแนะนำที่ทำให้ AdjRW เพิ่มขึ้นจากหลักฐานที่มี</div>}{failures.length > 0 && <details className="failure-disclosure"><summary><AlertTriangle size={15} /> {failures.length} candidate คำนวณไม่สำเร็จ</summary><ul>{failures.map((item, index) => <li key={`${item.code}-${index}`}>{item.code} · {item.message}</li>)}</ul></details>}</div><aside className="analysis-side"><div className="section-heading"><div><span className="eyebrow">EVIDENCE</span><h3>Usage ที่ใช้ประกอบ</h3></div><span className="count-badge">{usageItems.length}</span></div><UsageEvidence items={usageItems} /><div className="candidate-summary"><span className="field-label">Candidates ที่นำมาสลับ/วิเคราะห์ ({candidates.length})</span><div className="code-list">{candidates.length ? candidates.map((item) => <span className={`code-pill ${item.source === 'existing_sdx' ? 'code-sdx' : item.source === 'coder_manual' ? 'code-proc' : 'code-pdx'}`} key={item.code} title={item.source === 'existing_sdx' ? 'SDx เดิมใน HIS' : item.source === 'coder_manual' ? 'Coder เพิ่มเอง' : 'หลักฐานยา/เวชภัณฑ์'}>{item.code} <small style={{ opacity: 0.8 }}>({item.source === 'existing_sdx' ? 'HIS' : item.source === 'coder_manual' ? 'Manual' : 'Rx'})</small></span>) : <span className="muted">ยังไม่พบ code</span>}</div></div></aside></section>
      {auditResult && <ClinicalAuditPanel audit={auditResult} onApplyCode={(code) => void handleLoadAndOptimize(currentCase.an, code)} />}
    </>}
    {!loading && currentCase && <div className="optimizer-footnote"><Clock3 size={15} />ผลการวิเคราะห์เป็น snapshot ของข้อมูล ณ เวลาที่โหลด · หากมีการแก้ไขข้อมูลใน HIS ให้โหลดเคสใหม่อีกครั้ง</div>}
  </div>;
}
