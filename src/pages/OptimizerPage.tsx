import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  PlusCircle,
  Database,
  Activity,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { auditClinicalCase, type ClinicalAuditResult } from '@/audit/clinicalAuditEngine';
import { ClinicalAuditPanel } from '@/components/ClinicalAuditPanel';

export interface OptimizerPageProps {
  initialAn?: string;
  onBackToWorklist?: () => void;
  externalSessionId?: string;
  externalConfig?: BmsConnectionConfig | null;
  externalStatus?: 'idle' | 'connected' | 'demo' | 'error';
  onConnectSession?: (sid: string) => Promise<void>;
}

export const OptimizerPage: React.FC<OptimizerPageProps> = ({
  initialAn,
  onBackToWorklist,
  externalSessionId,
  externalConfig,
  externalStatus,
  onConnectSession,
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
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'connected' | 'demo' | 'error'>(externalStatus ?? 'idle');
  const [hospitalCode, setHospitalCode] = useState<string>(DEFAULT_HCODE);
  const [baseRate, setBaseRate] = useState<number>(8350);

  // Search & Case State (No hardcoded default AN)
  const [anInput, setAnInput] = useState<string>(initialAn || '');
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
      setSessionStatus('idle');
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
      if (onConnectSession) {
        await onConnectSession(cleanSid);
      }
    } catch (err) {
      setError(`ไม่สามารถเชื่อมต่อ BMS Session: ${(err as Error).message}`);
      setSessionStatus('error');
    }
  }, [onConnectSession]);

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

  const handleLoadAndOptimize = useCallback(async (targetAn?: string, additionalCandidate?: string) => {
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
      setLoadingStep('กำลังดึงข้อมูลเคสผู้ป่วยจริง (Case Detail จาก HIS)...');
      // If sessionStatus is demo (such as during vitest execution), allow fallback
      const isDemo = sessionStatus === 'demo';
      const caseRow = await fetchCaseDetail(an, connectionConfig || undefined, { useDemoFallback: isDemo });
      setCurrentCase(caseRow);

      // Step 2: Fetch Usage & Medication Items
      setLoadingStep('กำลังดึงรายการยาและเวชภัณฑ์ (Usage/opitemrece)...');
      const items = await fetchUsageItems(an, connectionConfig || undefined, { useDemoFallback: isDemo });
      setUsageItems(items);

      // Step 3: Extract evidenced candidates
      setLoadingStep('กำลังสกัดรหัสวินิจฉัยที่มีหลักฐานกำกับ (Candidate Extraction)...');
      let extracted = extractCandidates(items);
      if (additionalCandidate) {
        const cleanAdd = additionalCandidate.trim().toUpperCase().replace(/\./g, '');
        if (!extracted.some((c) => c.code === cleanAdd)) {
          extracted = [
            {
              code: cleanAdd,
              source: 'coder_manual',
              evidence: ['เพิ่มจากคำแนะนำระบบตรวจสอบความถูกต้องทางคลินิก (Clinical Audit)'],
            },
            ...extracted,
          ];
        }
      }
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
    if (initialAn) {
      setAnInput(initialAn);
      handleLoadAndOptimize(initialAn);
    }
  }, [initialAn, handleLoadAndOptimize]);

  const handleAddManualCandidate = async () => {
    const code = manualCode.trim().toUpperCase().replace(/\./g, '');
    if (!code) return;

    if (!candidates.some((c) => c.code === code)) {
      const newCand: DxCandidate = {
        code,
        source: 'coder_manual',
        evidence: ['เพิ่มโดย Coder (Manual override)'],
      };
      const updated = [...candidates, newCand];
      setCandidates(updated);
      setManualCode('');

      if (currentCase) {
        setLoading(true);
        setLoadingStep(`กำลังประมวลผล DRG เมื่อเพิ่มรหัส ${code}...`);
        try {
          const drgInput = cmiCaseToDrgInput(currentCase, { hcode: hospitalCode, baseRate });
          const result = await suggestHigherDrg(
            drgInput,
            updated.map((c) => ({
              code: c.code,
              reason: c.source === 'coder_manual' ? 'Coder เพิ่มเอง' : `พบในหลักฐาน (${c.source})`,
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
    }
  };

  const handleApplyCodeFromAudit = (code: string) => {
    handleLoadAndOptimize(undefined, code);
  };

  // Run Clinical Audit on loaded case
  const auditResult = useMemo<ClinicalAuditResult | null>(() => {
    if (!currentCase) return null;
    return auditClinicalCase({
      an: currentCase.an || '',
      age: currentCase.age,
      sex: currentCase.sex,
      los: currentCase.los ?? 0,
      pdx: currentCase.pdx,
      sdx: [currentCase.sdx1, currentCase.sdx2, currentCase.sdx3, currentCase.sdx4].filter(Boolean) as string[],
      proc: [currentCase.proc1, currentCase.proc2, currentCase.proc3].filter(Boolean) as string[],
      rw: baseline?.rw ?? currentCase.rw,
      adjrw: baseline?.adjrw ?? currentCase.adjrw,
    });
  }, [currentCase, baseline]);

  const toggleEvidence = (key: string) => {
    setExpandedEvidence((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const topSuggestion = suggestions.length > 0 ? suggestions[0] : null;

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', backgroundColor: '#f8fafc', paddingBottom: '40px' }}>
      {/* Disclaimer Banner */}
      <div className="disclaimer-banner">
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
                DRG Optimizer & Clinical Accuracy Audit
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
              วิเคราะห์ความถูกต้องของรหัสโรคตามเกณฑ์ สรท. และแนะนำรหัสโรคเพื่อ DRG / AdjRW ที่สะท้อนความรุนแรงจริง
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: sessionStatus === 'connected' ? '#dcfce7' : '#f1f5f9',
              color: sessionStatus === 'connected' ? '#166534' : '#64748b',
              border: `1px solid ${sessionStatus === 'connected' ? '#bbf7d0' : '#e2e8f0'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: sessionStatus === 'connected' ? '#10b981' : '#94a3b8',
              }} />
              <Database size={14} />
              {sessionStatus === 'connected' ? 'BMS เชื่อมต่อแล้ว' : 'ยังไม่ได้เชื่อมต่อ BMS'}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                เลขที่ผู้ป่วยใน (AN)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="ระบุเลข AN ที่ต้องการวิเคราะห์..."
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
                  placeholder="ระบุ BMS Session ID..."
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
                อัตราฐานกลาง รพ. (บาท/AdjRW)
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

        {/* Initial Empty Guide when no case loaded */}
        {!currentCase && !loading && (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '48px 24px',
            textAlign: 'center',
            border: '1px solid #e2e8f0',
            marginBottom: '24px',
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
            }}>
              <Search size={28} />
            </div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
              พร้อมสำหรับการวิเคราะห์ DRG และตรวจสอบความถูกต้องทางคลินิก
            </h3>
            <p style={{ margin: '0 auto 20px auto', maxWidth: '520px', fontSize: '13px', color: '#64748b', lineHeight: '1.6' }}>
              ระบุเลข AN ในช่องด้านบนเพื่อดึงข้อมูลจริงจากระบบ HIS หรือย้อนกลับไปเลือกเคสจากแท็บ
              <strong> ทะเบียนเคสผู้ป่วยใน (Worklist)</strong>
            </p>
            {onBackToWorklist && (
              <button
                type="button"
                className="btn-modern btn-primary-gradient"
                onClick={onBackToWorklist}
                style={{ padding: '8px 18px', fontSize: '13px' }}
              >
                ไปที่ทะเบียนเคสผู้ป่วยใน
              </button>
            )}
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
          </div>
        )}

        {/* Clinical Audit Panel Component */}
        {auditResult && (
          <div style={{ marginBottom: '24px' }}>
            <ClinicalAuditPanel
              audit={auditResult}
              onApplyCode={handleApplyCodeFromAudit}
            />
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
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: isCurrentPdx ? '#eff6ff' : isCurrentSdx ? '#ecfdf5' : '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>
                        {c.code}
                      </span>
                      {isCurrentPdx && (
                        <span style={{ fontSize: '10px', backgroundColor: '#bfdbfe', color: '#1e40af', padding: '1px 5px', borderRadius: '4px', fontWeight: '700' }}>
                          PDx เดิม
                        </span>
                      )}
                      {isCurrentSdx && (
                        <span style={{ fontSize: '10px', backgroundColor: '#a7f3d0', color: '#065f46', padding: '1px 5px', borderRadius: '4px', fontWeight: '700' }}>
                          SDx เดิม
                        </span>
                      )}
                      {!isCurrentPdx && !isCurrentSdx && (
                        <span style={{ fontSize: '10px', backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '4px', fontWeight: '700' }}>
                          พบหลักฐาน
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  ไม่พบรหัสโรคในรายการสั่งใช้ยา สามารถกรอกรหัส ICD-10 เองได้ที่ช่องด้านบน
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ranked Suggestions Table */}
        {currentCase && suggestions.length > 0 && (
          <div className="workbench-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                  อันดับผลการจำลองจัดกลุ่ม DRG ที่สูงขึ้น ({suggestions.length} รูปแบบ)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                  เรียงตามผลต่างค่าน้ำหนักสัมพัทธ์ (Delta AdjRW) จากมากไปหาน้อย
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '700' }}>
                    <th style={{ padding: '12px 14px' }}>อันดับ</th>
                    <th style={{ padding: '12px 14px' }}>การปรับเปลี่ยน</th>
                    <th style={{ padding: '12px 14px' }}>PDx แนะนำ</th>
                    <th style={{ padding: '12px 14px' }}>SDx ทั้งหมด</th>
                    <th style={{ padding: '12px 14px' }}>DRG ใหม่</th>
                    <th style={{ padding: '12px 14px' }}>AdjRW</th>
                    <th style={{ padding: '12px 14px' }}>ส่วนต่าง (Delta)</th>
                    <th style={{ padding: '12px 14px' }}>ผลกระทบรายได้</th>
                    <th style={{ padding: '12px 14px' }}>หลักฐานประกอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s, idx) => {
                    const gain = s.delta != null && s.delta > 0;
                    const evidenceKey = `sugg-${idx}`;
                    const hasEvidence = s.evidence && s.evidence.length > 0;

                    return (
                      <React.Fragment key={idx}>
                        <tr
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            backgroundColor: idx === 0 ? '#f0fdf4' : '#ffffff',
                            fontWeight: idx === 0 ? '600' : 'normal',
                          }}
                        >
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '22px',
                              height: '22px',
                              borderRadius: '50%',
                              backgroundColor: idx === 0 ? '#10b981' : '#e2e8f0',
                              color: idx === 0 ? '#ffffff' : '#475569',
                              fontSize: '11px',
                              fontWeight: '800',
                            }}>
                              {idx + 1}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: '700',
                              backgroundColor: s.kind === 'add_sdx' ? '#eff6ff' : '#fef3c7',
                              color: s.kind === 'add_sdx' ? '#1d4ed8' : '#b45309',
                            }}>
                              {s.kind === 'add_sdx' ? '+ เพิ่ม SDx' : '⇄ สลับ PDx'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span className="chip-code chip-pdx" style={{ fontSize: '13px' }}>
                              {s.pdx}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '320px' }}>
                              {s.sdx.map((code, sIdx) => (
                                <span key={sIdx} className="chip-code chip-sdx" style={{ fontSize: '11px', padding: '1px 6px' }}>
                                  {code}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: '800', color: '#0f172a' }}>
                            {s.drg}
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: '700', color: '#059669' }}>
                            {s.adjrw != null ? s.adjrw.toFixed(4) : '-'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{
                              fontWeight: '800',
                              color: gain ? '#16a34a' : '#64748b',
                              fontSize: '13px',
                            }}>
                              {s.delta != null ? `${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(4)}` : '-'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: '700', color: gain ? '#047857' : '#64748b' }}>
                            {s.delta != null ? `+${(s.delta * baseRate).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿` : '-'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {hasEvidence ? (
                              <button
                                type="button"
                                onClick={() => toggleEvidence(evidenceKey)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#2563eb',
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {expandedEvidence[evidenceKey] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                {s.evidence!.length} รายการ
                              </button>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>-</span>
                            )}
                          </td>
                        </tr>

                        {/* Expandable Evidence Sub-row */}
                        {hasEvidence && expandedEvidence[evidenceKey] && (
                          <tr style={{ backgroundColor: '#f8fafc' }}>
                            <td colSpan={9} style={{ padding: '10px 20px', borderBottom: '1px solid #e2e8f0' }}>
                              <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.6' }}>
                                <strong>หลักฐานในระบบการใช้ยา:</strong>
                                <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                                  {s.evidence!.map((ev, eIdx) => (
                                    <li key={eIdx}>{ev}</li>
                                  ))}
                                </ul>
                              </div>
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
      </div>
    </div>
  );
};
