import React, { useState, useEffect, useCallback } from 'react';
import {
  cmiCaseToDrgInput,
} from '@/cmi/caseAdapter';
import type { CmiCaseRow, UsageLite } from '@/cmi/caseContract';
import {
  extractCandidates,
  type DxCandidate,
} from '@/suggest/candidateExtractor';
import {
  suggestHigherDrg,
  type Suggestion,
  type BaselineResult,
} from '@/suggest/suggestEngine';
import {
  fetchCaseDetail,
  fetchUsageItems,
  retrieveBmsSession,
  extractConnectionConfig,
  type BmsConnectionConfig,
} from '@/services/cmiApi';
import { DEFAULT_HCODE } from '@/drg/grouperContract';
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  PlusCircle,
  Database,
  ArrowRightLeft,
  FileText,
  Activity,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

export interface OptimizerPageProps {
  initialAn?: string;
  onBackToWorklist?: () => void;
  externalSessionId?: string;
  externalConfig?: BmsConnectionConfig | null;
  externalStatus?: 'idle' | 'connected' | 'demo' | 'error';
}

export const OptimizerPage: React.FC<OptimizerPageProps> = ({
  initialAn,
  onBackToWorklist,
  externalSessionId,
  externalConfig,
  externalStatus,
}) => {
  // Session & Connection State
  const [bmsSessionId, setBmsSessionId] = useState<string>(() => {
    if (externalSessionId) return externalSessionId;
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('bms-session-id')?.trim() || '';
    }
    return '';
  });
  const [connectionConfig, setConnectionConfig] = useState<BmsConnectionConfig | null>(externalConfig ?? null);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'connected' | 'demo' | 'error'>(externalStatus ?? 'demo');
  const [hospitalCode, setHospitalCode] = useState<string>(DEFAULT_HCODE);
  const [baseRate, setBaseRate] = useState<number>(8350);

  // Search & Case State
  const [anInput, setAnInput] = useState<string>(initialAn || '1001');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [currentCase, setCurrentCase] = useState<CmiCaseRow | null>(null);
  const [usageItems, setUsageItems] = useState<UsageLite[]>([]);
  const [candidates, setCandidates] = useState<DxCandidate[]>([]);
  const [manualCode, setManualCode] = useState<string>('');

  // Grouper Result State
  const [baseline, setBaseline] = useState<BaselineResult | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  const handleConnectSession = useCallback(async (sid: string) => {
    const cleanSid = sid.trim();
    if (!cleanSid) {
      setConnectionConfig(null);
      setSessionStatus('demo');
      return;
    }

    try {
      setLoadingStep('กำลังดึงข้อมูลการเชื่อมต่อ BMS Session...');
      const raw = await retrieveBmsSession(cleanSid);
      const conf = extractConnectionConfig(raw);
      setConnectionConfig(conf);
      if (raw.hospital_code && /^\d{5}$/.test(raw.hospital_code)) {
        setHospitalCode(raw.hospital_code);
      }
      setSessionStatus('connected');
    } catch (err) {
      setError(`ไม่สามารถเชื่อมต่อ BMS Session: ${(err as Error).message}`);
      setSessionStatus('error');
    }
  }, []);

  // Connect on mount if session was passed in URL query param
  useEffect(() => {
    let ignore = false;
    if (bmsSessionId) {
      retrieveBmsSession(bmsSessionId)
        .then((raw) => {
          if (!ignore) {
            const conf = extractConnectionConfig(raw);
            setConnectionConfig(conf);
            if (raw.hospital_code && /^\d{5}$/.test(raw.hospital_code)) {
              setHospitalCode(raw.hospital_code);
            }
            setSessionStatus('connected');
          }
        })
        .catch((err) => {
          if (!ignore) {
            setError(`ไม่สามารถเชื่อมต่อ BMS Session: ${(err as Error).message}`);
            setSessionStatus('error');
          }
        });

      // Clean URL parameter without page reload
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('bms-session-id');
      window.history.replaceState(window.history.state, '', cleanUrl.toString());
    }

    return () => {
      ignore = true;
    };
  }, [bmsSessionId]);

  const handleLoadAndOptimize = useCallback(async (targetAn?: string) => {
    const an = (targetAn ?? anInput).trim();
    if (!an) {
      setError('กรุณาระบุเลข AN ที่ต้องการค้นหา');
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestions([]);
    setBaseline(null);

    try {
      // Step 1: Fetch Case Detail
      setLoadingStep('กำลังดึงข้อมูลเคสผู้ป่วย (Case Detail)...');
      const isDemo = sessionStatus !== 'connected';
      const caseRow = await fetchCaseDetail(an, connectionConfig || undefined, { useDemoFallback: isDemo });
      setCurrentCase(caseRow);

      // Step 2: Fetch Usage & Medication Items
      setLoadingStep('กำลังดึงรายการยาและเวชภัณฑ์ (Usage/opitemrece)...');
      const items = await fetchUsageItems(an, connectionConfig || undefined, { useDemoFallback: isDemo });
      setUsageItems(items);

      // Step 3: Extract evidenced candidates
      setLoadingStep('กำลังสกัดรหัสวินิจฉัยที่มีหลักฐานกำกับ (Candidate Extraction)...');
      const extracted = extractCandidates(items);
      setCandidates(extracted);

      // Step 4: Adapt to Grouper input
      const drgInput = cmiCaseToDrgInput(caseRow, {
        hcode: hospitalCode,
        baseRate,
      });

      // Step 5: Run Grouper baseline and suggest permutations
      setLoadingStep('กำลังเรียก Grouper ทางการเพื่อคำนวณ Baseline และจัดอันดับรหัสแนะนำ...');
      const result = await suggestHigherDrg(
        drgInput,
        extracted.map((c) => ({
          code: c.code,
          reason: `พบในหลักฐานการใช้ยา (${c.source})`,
          evidence: c.evidence,
        })),
      );

      setBaseline(result.baseline);
      setSuggestions(result.suggestions);
    } catch (err) {
      setError((err as Error).message || 'เกิดข้อผิดพลาดในการโหลดเคสหรือคำนวณ DRG');
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  }, [anInput, connectionConfig, sessionStatus, hospitalCode, baseRate]);

  useEffect(() => {
    let ignore = false;
    if (initialAn) {
      const isDemo = sessionStatus !== 'connected';
      fetchCaseDetail(initialAn, connectionConfig || undefined, { useDemoFallback: isDemo })
        .then(async (caseRow) => {
          if (ignore) return;
          setCurrentCase(caseRow);
          const items = await fetchUsageItems(initialAn, connectionConfig || undefined, { useDemoFallback: isDemo });
          if (ignore) return;
          setUsageItems(items);
          const extracted = extractCandidates(items);
          setCandidates(extracted);
          const drgInput = cmiCaseToDrgInput(caseRow, { hcode: hospitalCode, baseRate });
          const result = await suggestHigherDrg(
            drgInput,
            extracted.map((c) => ({
              code: c.code,
              reason: `พบในหลักฐานการใช้ยา (${c.source})`,
              evidence: c.evidence,
            })),
          );
          if (ignore) return;
          setBaseline(result.baseline);
          setSuggestions(result.suggestions);
        })
        .catch((err) => {
          if (!ignore) setError((err as Error).message);
        });
    }

    return () => {
      ignore = true;
    };
  }, [initialAn, connectionConfig, sessionStatus, hospitalCode, baseRate]);

  const handleAddManualCandidate = async () => {
    const code = manualCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return;
    if (code.length < 3) {
      setError('รหัส ICD-10 ต้องมีความยาวอย่างน้อย 3 ตัวอักษร');
      return;
    }

    const newCandidate: DxCandidate = {
      code,
      source: 'coder_manual',
      evidence: ['ระบุโดย Coder ผู้ใช้งาน'],
    };

    const updatedCandidates = [
      ...candidates.filter((c) => c.code !== code),
      newCandidate,
    ];
    setCandidates(updatedCandidates);
    setManualCode('');

    if (currentCase) {
      setLoading(true);
      setLoadingStep(`กำลังคำนวณผลกระทบของรหัส ${code} ต่อ DRG...`);
      try {
        const drgInput = cmiCaseToDrgInput(currentCase, {
          hcode: hospitalCode,
          baseRate,
        });

        const result = await suggestHigherDrg(
          drgInput,
          updatedCandidates.map((c) => ({
            code: c.code,
            reason: c.source === 'coder_manual' ? 'ระบุโดย Coder' : `พบในหลักฐานการใช้ยา (${c.source})`,
            evidence: c.evidence,
          })),
        );

        setBaseline(result.baseline);
        setSuggestions(result.suggestions);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setLoadingStep('');
      }
    }
  };

  const toggleEvidence = (key: string) => {
    setExpandedEvidence((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const topSuggestion = suggestions.length > 0 ? suggestions[0] : null;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a' }}>
      {/* Top Warning Banner */}
      <div style={{
        backgroundColor: '#fffbeb',
        borderBottom: '1px solid #fde68a',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <AlertTriangle style={{ color: '#d97706', flexShrink: 0 }} size={20} />
        <div style={{ fontSize: '13px', color: '#92400e' }}>
          <strong>ข้อเสนอแนะเพื่อทบทวนโดย coder เท่านั้น — ต้องมีหลักฐานเวชระเบียนรองรับก่อนเปลี่ยนรหัส</strong>
          <span style={{ marginLeft: '8px', color: '#b45309' }}>
            (ระบบทำงานแบบ Read-Only ไม่มีการบันทึกหรือเปลี่ยนแปลงฐานข้อมูลโรงพยาบาลโดยอัตโนมัติ)
          </span>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 20px' }}>
        {onBackToWorklist && (
          <div style={{ marginBottom: '16px' }}>
            <button
              type="button"
              className="btn-modern btn-ghost-neutral"
              onClick={onBackToWorklist}
              style={{ padding: '7px 14px', fontSize: '13px' }}
            >
              <ArrowLeft size={16} /> กลับสู่ทะเบียนเคสผู้ป่วยใน (Worklist)
            </button>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                DRG Optimizer & Clinical Simulation
              </h2>
              <span style={{
                backgroundColor: '#eff6ff',
                color: '#2563eb',
                fontSize: '11px',
                fontWeight: '700',
                padding: '2px 8px',
                borderRadius: '6px',
                border: '1px solid #bfdbfe',
              }}>
                v2.0 PRO
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
              ระบบวิเคราะห์ข้อมูลเคสผู้ป่วยและแนะนำรหัสโรคเพื่อ DRG / AdjRW ที่สูงขึ้นอย่างมีหลักฐานเวชระเบียนรองรับ
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: sessionStatus === 'connected' ? '#dcfce7' : '#eff6ff',
              color: sessionStatus === 'connected' ? '#166534' : '#1d4ed8',
              border: `1px solid ${sessionStatus === 'connected' ? '#bbf7d0' : '#bfdbfe'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: sessionStatus === 'connected' ? '#10b981' : '#3b82f6',
              }} className="animate-pulse-dot" />
              <Database size={14} />
              {sessionStatus === 'connected' ? 'BMS เชื่อมต่อแล้ว' : 'โหมดจำลอง (Demo Mode)'}
            </span>

            <span style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #e2e8f0',
            }}>
              HCode: {hospitalCode} (รพ.กันทรลักษ์)
            </span>
          </div>
        </div>

        {/* Configuration & Search Bar */}
        <div className="card-panel" style={{ padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                เลขที่ผู้ป่วยใน (AN)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="ระบุเลข AN เช่น 1001"
                  value={anInput}
                  onChange={(e) => setAnInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLoadAndOptimize(); }}
                />
                <button
                  type="button"
                  className="btn-modern btn-primary-gradient"
                  onClick={() => handleLoadAndOptimize()}
                  disabled={loading}
                  style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}
                >
                  <Search size={15} />
                  {loading ? 'กำลังประมวลผล...' : 'โหลดเคสและวิเคราะห์'}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                BMS Session ID (ดึงจาก HOSxP/PasteJSON)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="เช่น bms-session-abc123"
                  value={bmsSessionId}
                  onChange={(e) => setBmsSessionId(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  className="btn-modern btn-ghost-neutral"
                  onClick={() => handleConnectSession(bmsSessionId)}
                  style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}
                >
                  เชื่อมต่อ
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                Base Rate กลาง รพ. (บาท/AdjRW)
              </label>
              <input
                type="number"
                value={baseRate}
                onChange={(e) => setBaseRate(Number(e.target.value) || 0)}
                style={{
                  width: '100%',
                  padding: '9px 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>ตัวอย่างทดสอบ:</span>
            <button
              type="button"
              className="btn-modern btn-ghost-neutral"
              onClick={() => {
                setAnInput('1001');
                handleLoadAndOptimize('1001');
              }}
              style={{ padding: '4px 10px', fontSize: '12px', color: '#1d4ed8', backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }}
            >
              เคสจำลอง AN 1001 (Sepsis / DM / Pneumonia)
            </button>
            <button
              type="button"
              className="btn-modern btn-ghost-neutral"
              onClick={() => {
                setAnInput('1002');
                handleLoadAndOptimize('1002');
              }}
              style={{ padding: '4px 10px', fontSize: '12px', color: '#b45309', backgroundColor: '#fffbeb', borderColor: '#fde68a' }}
            >
              เคสจำลอง AN 1002 (Type 2 DM with coma)
            </button>
            <button
              type="button"
              className="btn-modern btn-ghost-neutral"
              onClick={() => {
                setAnInput('1007');
                handleLoadAndOptimize('1007');
              }}
              style={{ padding: '4px 10px', fontSize: '12px', color: '#047857', backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }}
            >
              เคสจำลอง AN 1007 (STEMI / Angioplasty)
            </button>
          </div>
        </div>

        {/* Loading Step Progress */}
        {loading && (
          <div style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 1px 3px rgba(37,99,235,0.08)',
          }}>
            <Activity style={{ animation: 'spin 1s linear infinite', color: '#2563eb', flexShrink: 0 }} size={20} />
            <div style={{ fontSize: '14px', color: '#1e40af', fontWeight: '600' }}>
              {loadingStep || 'กำลังประมวลผลการจำลอง DRG...'}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '24px',
            color: '#991b1b',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <AlertTriangle size={20} color="#dc2626" />
            <span><strong>ข้อผิดพลาด:</strong> {error}</span>
          </div>
        )}

        {/* Patient Baseline Banner */}
        {currentCase && (
          <div className="card-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '18px', marginBottom: '18px' }}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2563eb', backgroundColor: '#eff6ff', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                  ข้อมูลเคสปัจจุบัน (Baseline Case)
                </span>
                <h2 style={{ fontSize: '22px', fontWeight: '800', margin: '8px 0 4px 0', color: '#0f172a' }}>
                  AN {currentCase.an} &bull; {currentCase.ptname || 'ไม่ระบุชื่อผู้ป่วย'}
                </h2>
                <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px' }}>
                  <span><strong>HN:</strong> {currentCase.hn || '-'}</span>
                  <span>&bull;</span>
                  <span><strong>เพศ:</strong> {currentCase.sex || '-'}</span>
                  <span>&bull;</span>
                  <span><strong>อายุ:</strong> {currentCase.age ?? '-'} ปี</span>
                  <span>&bull;</span>
                  <span><strong>วันนอน (LOS):</strong> {currentCase.los ?? '-'} วัน</span>
                  <span>&bull;</span>
                  <span><strong>จำหน่าย:</strong> DC {currentCase.dchtype ?? '1'}{currentCase.dchstts ?? '1'}</span>
                  <span>&bull;</span>
                  <span><strong>ยา/เวชภัณฑ์:</strong> {usageItems.length} รายการ</span>
                </div>
              </div>

              {baseline && (
                <div style={{ textAlign: 'right', backgroundColor: '#f8fafc', padding: '14px 20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Baseline DRG ทางการ</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: '#0f172a', letterSpacing: '0.02em' }}>
                    {baseline.drg || '-'}
                  </div>
                  <div style={{ fontSize: '14px', color: '#059669', fontWeight: '800' }}>
                    AdjRW: {baseline.adjrw != null ? baseline.adjrw.toFixed(4) : '-'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                    ~{baseline.adjrw != null ? (baseline.adjrw * baseRate).toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '-'} บาท
                  </div>
                </div>
              )}
            </div>

            {/* Existing Codes Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>วินิจฉัยหลักเดิม (Primary Diagnosis)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="chip-code chip-pdx" style={{ fontSize: '16px', padding: '4px 12px' }}>
                    {currentCase.pdx || 'ยังไม่ลงรหัส'}
                  </span>
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>วินิจฉัยร่วมเดิม (Secondary Diagnoses)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[currentCase.sdx1, currentCase.sdx2, currentCase.sdx3, currentCase.sdx4].filter(Boolean).length > 0 ? (
                    [currentCase.sdx1, currentCase.sdx2, currentCase.sdx3, currentCase.sdx4].filter(Boolean).map((s, idx) => (
                      <span key={idx} className="chip-code chip-sdx" style={{ fontSize: '13px', padding: '3px 9px' }}>
                        {s}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>ไม่มี SDx เดิม</span>
                  )}
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>หัตถการเดิม (Procedures)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[currentCase.proc1, currentCase.proc2, currentCase.proc3].filter(Boolean).length > 0 ? (
                    [currentCase.proc1, currentCase.proc2, currentCase.proc3].filter(Boolean).map((p, idx) => (
                      <span key={idx} className="chip-code" style={{ fontSize: '13px', padding: '3px 9px', backgroundColor: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>
                        {p}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>ไม่มีหัตถการ</span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '14px', fontSize: '12px', color: '#94a3b8' }}>
              * ข้อมูลที่ CaseDetail ไม่มี: กำหนดค่ามาตรฐานเปิดเผย: น้ำหนัก = 0 kg, อายุวัน = 0, LOS ชม. = 0, Disch Status = {currentCase.dchtype || '1'}{currentCase.dchstts || '1'}
            </div>
          </div>
        )}

        {/* Hero Comparison Card (Before vs After) */}
        {baseline && topSuggestion && (
          <div className="comparison-hero-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <TrendingUp size={20} color="#10b981" />
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                ผลลัพธ์การจำลองที่ดีที่สุด (Top Recommended Optimization)
              </h3>
            </div>

            <div className="comparison-grid">
              {/* Left: Baseline */}
              <div className="comparison-box box-baseline">
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>
                  รหัสปัจจุบัน (Before)
                </span>
                <div style={{ fontSize: '26px', fontWeight: '800', color: '#0f172a', margin: '6px 0 2px 0' }}>
                  DRG {baseline.drg || '-'}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#475569' }}>
                  AdjRW: {baseline.adjrw != null ? baseline.adjrw.toFixed(4) : '-'}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  ~{baseline.adjrw != null ? (baseline.adjrw * baseRate).toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '-'} บาท
                </div>
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '12px', color: '#475569' }}>
                  {`วินิจฉัยเดิม (Primary): ${currentCase?.pdx || '-'}`}
                </div>
              </div>

              {/* Center: Gain Pill & Arrow */}
              <div className="comparison-arrow">
                <div className="delta-gain-pill">
                  <Sparkles size={16} />
                  +{topSuggestion.delta != null ? topSuggestion.delta.toFixed(4) : '-'} AdjRW
                </div>
                <div style={{ margin: '8px 0' }}>
                  <ArrowRight size={28} color="#10b981" />
                </div>
                <div style={{ fontSize: '13px', fontWeight: '800', color: '#059669' }}>
                  +{(topSuggestion.delta != null ? topSuggestion.delta * baseRate : 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })} บาท
                </div>
              </div>

              {/* Right: Top Suggestion */}
              <div className="comparison-box box-optimized">
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#059669', textTransform: 'uppercase' }}>
                  รหัสแนะนำปรับปรุง (After)
                </span>
                <div style={{ fontSize: '26px', fontWeight: '800', color: '#047857', margin: '6px 0 2px 0' }}>
                  DRG {topSuggestion.drg}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '800', color: '#059669' }}>
                  AdjRW: {topSuggestion.adjrw != null ? topSuggestion.adjrw.toFixed(4) : '-'}
                </div>
                <div style={{ fontSize: '12px', color: '#047857', marginTop: '2px' }}>
                  ~{topSuggestion.adjrw != null ? (topSuggestion.adjrw * baseRate).toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '-'} บาท
                </div>
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #bbf7d0', fontSize: '12px', color: '#047857' }}>
                  {`วินิจฉัยแนะนำ (Optimized): ${topSuggestion.pdx}${topSuggestion.sdx.length > 0 ? ` (SDx: ${topSuggestion.sdx.join(', ')})` : ''}`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Evidence Candidates Panel */}
        {currentCase && (
          <div className="workbench-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                  รหัสโรคที่พบหลักฐานในระบบการใช้ยา / เวชระเบียน ({candidates.length} รหัส)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                  สกัดอัตโนมัติจากใบสั่งยา (presc_reason) และเหตุผลการสั่งยาจำเป็น (need_order_reason)
                </p>
              </div>

              {/* Add Manual Candidate */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="เพิ่มรหัส ICD-10 เอง..."
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    width: '160px',
                    outline: 'none',
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddManualCandidate(); }}
                />
                <button
                  type="button"
                  className="btn-modern btn-success-gradient"
                  onClick={handleAddManualCandidate}
                  style={{ padding: '7px 14px', fontSize: '12px' }}
                >
                  <PlusCircle size={15} />
                  เพิ่มรหัส
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {candidates.length > 0 ? (
                candidates.map((c) => {
                  const isCurrentPdx = c.code === currentCase?.pdx;
                  const isCurrentSdx = [currentCase?.sdx1, currentCase?.sdx2, currentCase?.sdx3, currentCase?.sdx4].includes(c.code);

                  return (
                    <div
                      key={c.code}
                      style={{
                        border: '1px solid #e2e8f0',
                        backgroundColor: isCurrentPdx ? '#eff6ff' : isCurrentSdx ? '#f8fafc' : '#ffffff',
                        borderRadius: '10px',
                        padding: '10px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="chip-code chip-pdx" style={{ fontSize: '13px' }}>
                          {c.code}
                        </span>
                        <span className={`evidence-pill-tag ${
                          c.source === 'need_order_reason' ? 'evidence-pill-need_order' :
                          c.source === 'coder_manual' ? 'evidence-pill-coder' : 'evidence-pill-presc'
                        }`}>
                          {c.source === 'need_order_reason' ? 'need_order' : c.source === 'coder_manual' ? 'coder' : 'presc_reason'}
                        </span>
                        <a
                          href={`https://had-api.moph.go.th/cmi/libs/icd10/${c.code}`}
                          target="_blank"
                          rel="noreferrer"
                          title="ดูคำอธิบายรหัสในคลังข้อมูล MoPH"
                          style={{ color: '#2563eb', display: 'flex', alignItems: 'center' }}
                        >
                          <ExternalLink size={13} />
                        </a>
                      </div>

                      {c.evidence.length > 0 && (
                        <div style={{ fontSize: '11px', color: '#64748b', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.evidence[0]}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  ไม่พบรหัสโรคที่ระบุในเหตุผลการใช้ยาสำหรับเคสนี้
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ranked Suggestions Table */}
        {suggestions.length > 0 && (
          <div className="card-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                  ข้อเสนอแนะการปรับปรุงรหัสโรค (จัดอันดับตาม ΔAdjRW สูงสุด)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                  พบ {suggestions.length} รูปแบบที่ทำให้ค่า DRG / AdjRW สูงขึ้นกว่าเดิม
                </p>
              </div>
            </div>

            <div className="modern-table-wrap">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>รูปแบบข้อเสนอแนะ</th>
                    <th>รหัส PDx / SDx ที่ปรับ</th>
                    <th>DRG ใหม่</th>
                    <th>AdjRW ใหม่</th>
                    <th>ΔAdjRW ที่เพิ่มขึ้น</th>
                    <th>ประมาณการเงินเพิ่ม</th>
                    <th>หลักฐานประกอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s, idx) => {
                    const diffMoney = s.delta != null ? s.delta * baseRate : 0;
                    const rowKey = `${s.kind}-${s.pdx}-${s.drg}-${idx}`;
                    const isExpanded = expandedEvidence[rowKey];

                    return (
                      <React.Fragment key={rowKey}>
                        <tr style={{ backgroundColor: idx === 0 ? '#f0fdf4' : '#ffffff' }}>
                          <td style={{ fontWeight: '700', color: '#0f172a' }}>
                            {idx + 1}
                          </td>
                          <td>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '700',
                              backgroundColor: s.kind === 'swap_pdx' ? '#eff6ff' : '#f0fdf4',
                              color: s.kind === 'swap_pdx' ? '#1d4ed8' : '#15803d',
                              border: `1px solid ${s.kind === 'swap_pdx' ? '#bfdbfe' : '#bbf7d0'}`,
                            }}>
                              {s.kind === 'swap_pdx' ? (
                                <>
                                  <ArrowRightLeft size={13} />
                                  สลับเป็น PDx
                                </>
                              ) : (
                                <>
                                  <PlusCircle size={13} />
                                  เพิ่ม SDx
                                </>
                              )}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: '700', color: '#1e40af' }}>
                              PDx: {s.pdx}
                            </div>
                            {s.sdx.length > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                                <span style={{ fontSize: '11px', color: '#64748b' }}>SDx:</span>
                                <span style={{ fontSize: '12px', color: '#334155', fontWeight: '500' }}>
                                  {s.sdx.join(', ')}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="chip-code chip-drg" style={{ fontSize: '14px' }}>
                                {s.drg}
                              </span>
                              <a
                                href={`https://had-api.moph.go.th/cmi/libs/drg-name/${s.drg}`}
                                target="_blank"
                                rel="noreferrer"
                                title="ดูรายละเอียด DRG ในคลังข้อมูล MoPH"
                                style={{ color: '#2563eb' }}
                              >
                                <ExternalLink size={13} />
                              </a>
                            </div>
                          </td>
                          <td style={{ fontWeight: '700', color: '#0f172a' }}>
                            {s.adjrw != null ? s.adjrw.toFixed(4) : '-'}
                          </td>
                          <td>
                            <span style={{
                              backgroundColor: '#dcfce7',
                              color: '#15803d',
                              fontWeight: '800',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              border: '1px solid #86efac',
                            }}>
                              +{s.delta != null ? s.delta.toFixed(4) : '-'}
                            </span>
                          </td>
                          <td style={{ fontWeight: '700', color: '#059669' }}>
                            +{diffMoney.toLocaleString('th-TH', { maximumFractionDigits: 0 })} บ.
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => toggleEvidence(rowKey)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                padding: 0,
                              }}
                            >
                              <FileText size={14} />
                              หลักฐาน
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr style={{ backgroundColor: '#f8fafc' }}>
                            <td colSpan={8} style={{ padding: '14px 18px', fontSize: '13px' }}>
                              <div style={{ color: '#334155', marginBottom: '8px' }}>
                                <strong>เหตุผลที่แนะนำ:</strong> {s.reason}
                              </div>
                              {s.evidence && s.evidence.length > 0 ? (
                                <div className="evidence-quote-box">
                                  <strong>รายการหลักฐานที่พบ:</strong>
                                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: '#475569' }}>
                                    {s.evidence.map((ev, evIdx) => (
                                      <li key={evIdx} style={{ marginTop: '2px' }}>{ev}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <div style={{ color: '#94a3b8' }}>ไม่มีหลักฐานเพิ่มเติม</div>
                              )}
                              {s.warning && (
                                <div style={{ color: '#d97706', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <AlertTriangle size={15} />
                                  <span><strong>คำเตือนจาก Grouper:</strong> {s.warning}</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state when loaded but no higher DRG found */}
        {currentCase && suggestions.length === 0 && !loading && (
          <div className="card-panel" style={{ padding: '48px', textAlign: 'center' }}>
            <CheckCircle2 style={{ color: '#059669', margin: '0 auto 12px auto' }} size={44} />
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px 0' }}>
              รหัสเดิมเป็นค่าสูงสุดแล้ว หรือไม่พบรหัสทดแทนที่ให้ DRG สูงกว่า
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
              เคสนี้ได้รับการลงรหัสที่ครอบคลุม หรือยังไม่มีหลักฐานการใช้ยาตัวอื่นที่รองรับรหัสโรคเพิ่มเติม
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OptimizerPage;
