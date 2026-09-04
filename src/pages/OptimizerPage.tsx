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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Warning Banner */}
      <div style={{ backgroundColor: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <AlertTriangle style={{ color: '#d97706', flexShrink: 0 }} size={22} />
        <div style={{ fontSize: '14px', color: '#92400e' }}>
          <strong>ข้อเสนอแนะเพื่อทบทวนโดย coder เท่านั้น — ต้องมีหลักฐานเวชระเบียนรองรับก่อนเปลี่ยนรหัส</strong>
          <span style={{ marginLeft: '8px', color: '#b45309' }}>
            (ระบบทำงานแบบ Read-Only ไม่มีการบันทึกหรือเปลี่ยนแปลงฐานข้อมูลโรงพยาบาลโดยอัตโนมัติ)
          </span>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 20px' }}>
        {onBackToWorklist && (
          <div style={{ marginBottom: '16px' }}>
            <button
              type="button"
              onClick={onBackToWorklist}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: '600',
                color: '#2563eb',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <ArrowLeft size={16} /> กลับสู่ทะเบียนเคสผู้ป่วยใน (Worklist)
            </button>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '700', margin: 0, color: '#1e293b' }}>
              DRG Optimizer
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#64748b' }}>
              ระบบวิเคราะห์ข้อมูลเคสผู้ป่วยและแนะนำรหัสโรคเพื่อ DRG / AdjRW ที่สูงขึ้นอย่างมีหลักฐานเวชระเบียนรองรับ
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: '500',
              backgroundColor: sessionStatus === 'connected' ? '#dcfce7' : '#e0f2fe',
              color: sessionStatus === 'connected' ? '#166534' : '#0369a1',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Database size={15} />
              {sessionStatus === 'connected' ? 'BMS เชื่อมต่อแล้ว' : 'โหมดจำลอง (Demo Mode)'}
            </span>

            <span style={{
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: '500',
              backgroundColor: '#f1f5f9',
              color: '#475569',
            }}>
              HCode: {hospitalCode} (กันทรลักษ์)
            </span>
          </div>
        </div>

        {/* Configuration & Search Bar */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
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
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLoadAndOptimize(); }}
                />
                <button
                  type="button"
                  onClick={() => handleLoadAndOptimize()}
                  disabled={loading}
                  style={{
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 18px',
                    fontWeight: '600',
                    fontSize: '14px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  <Search size={16} />
                  {loading ? 'กำลังประมวลผล...' : 'โหลดเคสและวิเคราะห์'}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
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
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleConnectSession(bmsSessionId)}
                  style={{
                    backgroundColor: '#f1f5f9',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    fontWeight: '500',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  เชื่อมต่อ
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                Base Rate กลาง รพ. (บาท/AdjRW)
              </label>
              <input
                type="number"
                value={baseRate}
                onChange={(e) => setBaseRate(Number(e.target.value) || 0)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>ตัวอย่างทดสอบ:</span>
            <button
              type="button"
              onClick={() => {
                setAnInput('1001');
                handleLoadAndOptimize('1001');
              }}
              style={{
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              เคสจำลอง AN 1001 (Sepsis / DM / Pneumonia)
            </button>
          </div>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '16px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Activity style={{ animation: 'spin 1s linear infinite', color: '#2563eb' }} size={20} />
            <div style={{ fontSize: '14px', color: '#1e40af', fontWeight: '500' }}>
              {loadingStep || 'กำลังประมวลผล...'}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '16px 20px', marginBottom: '24px', color: '#991b1b', fontSize: '14px' }}>
            <strong>ข้อผิดพลาด:</strong> {error}
          </div>
        )}

        {/* Case Baseline Card */}
        {currentCase && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2563eb', backgroundColor: '#eff6ff', padding: '4px 8px', borderRadius: '4px' }}>
                  ข้อมูลเคสปัจจุบัน (Baseline Case)
                </span>
                <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '8px 0 4px 0', color: '#0f172a' }}>
                  AN {currentCase.an} &bull; {currentCase.ptname || 'ไม่ระบุชื่อผู้ป่วย'}
                </h2>
                <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span>HN: {currentCase.hn || '-'}</span>
                  <span>เพศ: {currentCase.sex || '-'}</span>
                  <span>อายุ: {currentCase.age ?? '-'} ปี</span>
                  <span>LOS: {currentCase.los ?? '-'} วัน</span>
                  <span>สถานะจำหน่าย: DC {currentCase.dchtype ?? '1'}{currentCase.dchstts ?? '1'}</span>
                  <span>รายการยา/เวชภัณฑ์: {usageItems.length} รายการ</span>
                </div>
              </div>

              {baseline && (
                <div style={{ textAlign: 'right', backgroundColor: '#f8fafc', padding: '12px 18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Baseline DRG ทางการ</div>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#1e293b' }}>
                    {baseline.drg || '-'}
                  </div>
                  <div style={{ fontSize: '14px', color: '#059669', fontWeight: '700' }}>
                    AdjRW: {baseline.adjrw != null ? baseline.adjrw.toFixed(4) : '-'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    ~{baseline.adjrw != null ? (baseline.adjrw * baseRate).toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '-'} บาท
                  </div>
                </div>
              )}
            </div>

            {/* Existing Codes Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px' }}>วินิจฉัยหลักเดิม (Primary Diagnosis)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '700', color: '#1e40af', backgroundColor: '#dbeafe', padding: '4px 10px', borderRadius: '6px' }}>
                    {currentCase.pdx || 'ยังไม่ลงรหัส'}
                  </span>
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px' }}>วินิจฉัยร่วมเดิม (Secondary Diagnoses)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[currentCase.sdx1, currentCase.sdx2, currentCase.sdx3, currentCase.sdx4].filter(Boolean).length > 0 ? (
                    [currentCase.sdx1, currentCase.sdx2, currentCase.sdx3, currentCase.sdx4].filter(Boolean).map((s, idx) => (
                      <span key={idx} style={{ fontSize: '13px', fontWeight: '600', color: '#334155', backgroundColor: '#e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>
                        {s}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>ไม่มี SDx เดิม</span>
                  )}
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px' }}>หัตถการเดิม (Procedures)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[currentCase.proc1, currentCase.proc2, currentCase.proc3].filter(Boolean).length > 0 ? (
                    [currentCase.proc1, currentCase.proc2, currentCase.proc3].filter(Boolean).map((p, idx) => (
                      <span key={idx} style={{ fontSize: '13px', fontWeight: '600', color: '#334155', backgroundColor: '#e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>
                        {p}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>ไม่มีหัตถการ</span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '12px', fontSize: '12px', color: '#94a3b8' }}>
              * ข้อมูลที่ CaseDetail ไม่มี: กำหนดค่ามาตรฐานเปิดเผย: น้ำหนัก = 0 kg, อายุวัน = 0, LOS ชม. = 0, Disch Status = {currentCase.dchtype || '1'}{currentCase.dchstts || '1'}
            </div>
          </div>
        )}

        {/* Evidence Candidates Panel */}
        {currentCase && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '700', margin: 0, color: '#1e293b' }}>
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
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    width: '160px',
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddManualCandidate(); }}
                />
                <button
                  type="button"
                  onClick={handleAddManualCandidate}
                  style={{
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
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
                        backgroundColor: isCurrentPdx ? '#eff6ff' : isCurrentSdx ? '#f8fafc' : '#f0fdf4',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>
                          {c.code}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: c.source === 'need_order_reason' ? '#fef3c7' : c.source === 'coder_manual' ? '#f3e8ff' : '#dcfce7',
                          color: c.source === 'need_order_reason' ? '#92400e' : c.source === 'coder_manual' ? '#6b21a8' : '#166534',
                          fontWeight: '600',
                        }}>
                          {c.source === 'need_order_reason' ? 'need_order' : c.source === 'coder_manual' ? 'coder' : 'presc_reason'}
                        </span>
                        <a
                          href={`https://had-api.moph.go.th/cmi/libs/icd10/${c.code}`}
                          target="_blank"
                          rel="noreferrer"
                          title="ดูคำอธิบายรหัสในคลังข้อมูล MoPH"
                          style={{ color: '#64748b' }}
                        >
                          <ExternalLink size={13} />
                        </a>
                      </div>

                      {c.evidence.length > 0 && (
                        <div style={{ fontSize: '11px', color: '#64748b', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0, color: '#0f172a' }}>
                  ข้อเสนอแนะการปรับปรุงรหัสโรค (จัดอันดับตาม ΔAdjRW สูงสุด)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                  พบ {suggestions.length} รูปแบบที่ทำให้ค่า DRG / AdjRW สูงขึ้นกว่าเดิม
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '12px 14px' }}>#</th>
                    <th style={{ padding: '12px 14px' }}>รูปแบบข้อเสนอแนะ</th>
                    <th style={{ padding: '12px 14px' }}>รหัส PDx / SDx ที่ปรับ</th>
                    <th style={{ padding: '12px 14px' }}>DRG ใหม่</th>
                    <th style={{ padding: '12px 14px' }}>AdjRW ใหม่</th>
                    <th style={{ padding: '12px 14px' }}>ΔAdjRW ที่เพิ่มขึ้น</th>
                    <th style={{ padding: '12px 14px' }}>ประมาณการเงินเพิ่ม</th>
                    <th style={{ padding: '12px 14px' }}>หลักฐานประกอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s, idx) => {
                    const diffMoney = s.delta != null ? s.delta * baseRate : 0;
                    const rowKey = `${s.kind}-${s.pdx}-${s.drg}-${idx}`;
                    const isExpanded = expandedEvidence[rowKey];

                    return (
                      <React.Fragment key={rowKey}>
                        <tr style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: idx === 0 ? '#f0fdf4' : '#ffffff' }}>
                          <td style={{ padding: '12px 14px', fontWeight: '600' }}>
                            {idx + 1}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600',
                              backgroundColor: s.kind === 'swap_pdx' ? '#eff6ff' : '#f0fdf4',
                              color: s.kind === 'swap_pdx' ? '#1d4ed8' : '#15803d',
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
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ fontWeight: '600', color: '#1e40af' }}>
                              PDx: {s.pdx}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>
                              SDx: {s.sdx.length > 0 ? s.sdx.join(', ') : '-'}
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: '700', fontSize: '15px' }}>
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
                          <td style={{ padding: '12px 14px', fontWeight: '600' }}>
                            {s.adjrw != null ? s.adjrw.toFixed(4) : '-'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{
                              backgroundColor: '#dcfce7',
                              color: '#15803d',
                              fontWeight: '700',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '13px',
                            }}>
                              +{s.delta != null ? s.delta.toFixed(4) : '-'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: '600', color: '#059669' }}>
                            +{diffMoney.toLocaleString('th-TH', { maximumFractionDigits: 0 })} บ.
                          </td>
                          <td style={{ padding: '12px 14px' }}>
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
                                fontWeight: '500',
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
                          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <td colSpan={8} style={{ padding: '12px 16px', fontSize: '12px' }}>
                              <div style={{ color: '#334155', marginBottom: '6px' }}>
                                <strong>เหตุผลที่แนะนำ:</strong> {s.reason}
                              </div>
                              {s.evidence && s.evidence.length > 0 ? (
                                <div>
                                  <strong>รายการหลักฐานที่พบ:</strong>
                                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: '#475569' }}>
                                    {s.evidence.map((ev, evIdx) => (
                                      <li key={evIdx}>{ev}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <div style={{ color: '#94a3b8' }}>ไม่มีหลักฐานเพิ่มเติม</div>
                              )}
                              {s.warning && (
                                <div style={{ color: '#d97706', marginTop: '6px' }}>
                                  <strong>คำเตือนจาก Grouper:</strong> {s.warning}
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
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '36px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <CheckCircle2 style={{ color: '#059669', margin: '0 auto 12px auto' }} size={40} />
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px 0' }}>
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
