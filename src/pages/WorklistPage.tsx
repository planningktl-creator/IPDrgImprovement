import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { CmiCaseRow, WorklistQueryParams } from '@/cmi/caseContract';
import { fetchCaseWorklist, type BmsConnectionConfig } from '@/services/cmiApi';
import {
  Search,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Clock,
  Activity,
  Calendar,
  Database,
  ShieldCheck,
  Building,
} from 'lucide-react';
import {
  getThaiFiscalYear,
  getRecentFiscalYears,
  getFiscalYearRange,
  getFiscalMonthRange,
  THAI_FISCAL_MONTHS,
} from '@/utils/dateUtils';
import { auditClinicalCase } from '@/audit/clinicalAuditEngine';

export interface WorklistPageProps {
  onSelectCaseForOptimization: (an: string) => void;
  connectionConfig: BmsConnectionConfig | null;
  sessionStatus: 'idle' | 'connected' | 'demo' | 'error';
  onConnectSession?: (sid: string) => Promise<void>;
}

export const WorklistPage: React.FC<WorklistPageProps> = ({
  onSelectCaseForOptimization,
  connectionConfig,
  sessionStatus,
  onConnectSession,
}) => {
  // Fiscal Year & Month management
  const currentFiscalYear = useMemo(() => getThaiFiscalYear(), []);
  const availableFiscalYears = useMemo(() => getRecentFiscalYears(6), []);

  // Default to user query date range: 2023-10-01 to 2026-09-30 (covering FY 2567-2569)
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number | 'query_all'>('query_all');
  const [selectedFiscalMonth, setSelectedFiscalMonth] = useState<number | 'all'>('all');
  const [showCustomDate, setShowCustomDate] = useState<boolean>(false);

  // Dynamic Date range based on user's query
  const [dstart, setDstart] = useState<string>('2023-10-01');
  const [dend, setDend] = useState<string>('2026-09-30');

  // Dropdown filter states
  const [statusFilter, setStatusFilter] = useState<'all' | 'uncoded' | 'coded'>('all');
  const [selectedWard, setSelectedWard] = useState<string>('all');
  const [selectedScheme, setSelectedScheme] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Manual Session Connect input state
  const [sessionIdInput, setSessionIdInput] = useState<string>('');
  const [connectingSession, setConnectingSession] = useState<boolean>(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Cases and loading states
  const [cases, setCases] = useState<CmiCaseRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiscalYearChange = (yearVal: string) => {
    if (yearVal === 'query_all') {
      setSelectedFiscalYear('query_all');
      setSelectedFiscalMonth('all');
      setDstart('2023-10-01');
      setDend('2026-09-30');
    } else {
      const year = parseInt(yearVal, 10);
      setSelectedFiscalYear(year);
      setSelectedFiscalMonth('all');
      const range = getFiscalYearRange(year, false);
      setDstart(range.dstart);
      setDend(range.dend);
    }
  };

  const handleFiscalMonthChange = (monthVal: string) => {
    if (monthVal === 'all') {
      setSelectedFiscalMonth('all');
      if (selectedFiscalYear === 'query_all') {
        setDstart('2023-10-01');
        setDend('2026-09-30');
      } else {
        const range = getFiscalYearRange(selectedFiscalYear, false);
        setDstart(range.dstart);
        setDend(range.dend);
      }
    } else {
      const m = parseInt(monthVal, 10);
      setSelectedFiscalMonth(m);
      const targetYear = selectedFiscalYear === 'query_all' ? currentFiscalYear : selectedFiscalYear;
      const range = getFiscalMonthRange(targetYear, m);
      setDstart(range.dstart);
      setDend(range.dend);
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionIdInput.trim() || !onConnectSession) return;
    setConnectingSession(true);
    setSessionError(null);
    try {
      await onConnectSession(sessionIdInput.trim());
    } catch (err) {
      setSessionError((err as Error).message);
    } finally {
      setConnectingSession(false);
    }
  };

  const loadWorklist = useCallback(async () => {
    if (sessionStatus !== 'connected' || !connectionConfig?.apiUrl) {
      setCases([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params: WorklistQueryParams = {
        dstart,
        dend,
        ward: selectedWard !== 'all' ? selectedWard : undefined,
        statusFilter,
        search: searchQuery,
      };

      const result = await fetchCaseWorklist(params, connectionConfig, {
        useDemoFallback: false,
      });
      setCases(result);
    } catch (err) {
      setError((err as Error).message || 'เกิดข้อผิดพลาดในการโหลดทะเบียนเคสผู้ป่วยใน');
    } finally {
      setLoading(false);
    }
  }, [dstart, dend, selectedWard, statusFilter, searchQuery, connectionConfig, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'connected' && connectionConfig?.apiUrl) {
      loadWorklist();
    } else {
      setCases([]);
    }
  }, [loadWorklist, sessionStatus, connectionConfig]);

  // Extract distinct wards from real cases for dynamic dropdown
  const availableWards = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cases) {
      if (c.firstWard && c.firstWardName) {
        map.set(c.firstWard, c.firstWardName);
      } else if (c.lastWard && c.lastWardName) {
        map.set(c.lastWard, c.lastWardName);
      }
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [cases]);

  // Client-side filtering for fast instant responsiveness
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (statusFilter === 'uncoded') {
        if (c.remark !== 'ยังไม่ลงรหัสโรค' && c.pdx) return false;
      } else if (statusFilter === 'coded') {
        if (c.remark === 'ยังไม่ลงรหัสโรค' || !c.pdx) return false;
      }

      if (selectedWard !== 'all') {
        if (c.firstWard !== selectedWard && c.lastWard !== selectedWard) return false;
      }

      if (selectedScheme !== 'all') {
        const ptt = (c.pttypeName || c.pttype || '').toLowerCase();
        if (selectedScheme === 'ucs' && !ptt.includes('ทอง') && !ptt.includes('ประกันสุขภาพ') && !ptt.includes('uc')) return false;
        if (selectedScheme === 'ofc' && !ptt.includes('ข้าราชการ') && !ptt.includes('เบิก') && !ptt.includes('ofc')) return false;
        if (selectedScheme === 'sss' && !ptt.includes('ประกันสังคม') && !ptt.includes('sss')) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const anMatch = c.an?.toLowerCase().includes(q);
        const hnMatch = c.hn?.toLowerCase().includes(q);
        const nameMatch = c.ptname?.toLowerCase().includes(q);
        const pdxMatch = c.pdx?.toLowerCase().includes(q);
        const wardMatch = c.firstWardName?.toLowerCase().includes(q) || c.lastWardName?.toLowerCase().includes(q);
        if (!anMatch && !hnMatch && !nameMatch && !pdxMatch && !wardMatch) return false;
      }

      return true;
    });
  }, [cases, statusFilter, selectedWard, selectedScheme, searchQuery]);

  // Summary statistics
  const stats = useMemo(() => {
    const total = filteredCases.length;
    const uncoded = filteredCases.filter((c) => c.remark === 'ยังไม่ลงรหัสโรค' || !c.pdx).length;
    const coded = total - uncoded;
    const totalAdjrw = filteredCases.reduce((sum, c) => sum + (c.adjrw || 0), 0);
    const avgCmi = coded > 0 ? totalAdjrw / coded : 0;
    const totalIncome = filteredCases.reduce((sum, c) => sum + (c.income || 0), 0);
    const estUcsRevenue = Math.round(totalAdjrw * 8350);

    return { total, uncoded, coded, totalAdjrw, avgCmi, totalIncome, estUcsRevenue };
  }, [filteredCases]);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>
              ทะเบียนเคสผู้ป่วยใน (Inpatient Worklist)
            </h2>
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              backgroundColor: sessionStatus === 'connected' ? '#ecfdf5' : '#fef2f2',
              color: sessionStatus === 'connected' ? '#047857' : '#b91c1c',
              border: `1px solid ${sessionStatus === 'connected' ? '#a7f3d0' : '#fecaca'}`,
              borderRadius: '6px',
              fontWeight: '700',
            }}>
              {sessionStatus === 'connected' ? 'HIS Database Connected' : 'HIS Offline'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            ตรวจสอบสถานะการลงรหัสโรค ความถูกต้องตามเกณฑ์ สรท. และนำเข้าสู่ระบบ DRG Optimizer
          </p>
        </div>

        {sessionStatus === 'connected' && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => loadWorklist()}
              disabled={loading}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: '600',
                color: '#334155',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              <RefreshCw size={15} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'กำลังโหลด...' : 'รีเฟรชข้อมูล'}
            </button>
          </div>
        )}
      </div>

      {/* Disconnected State / BMS Connection Prompt */}
      {sessionStatus !== 'connected' && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '32px 24px',
          border: '1px solid #e2e8f0',
          marginBottom: '24px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            backgroundColor: '#eff6ff',
            color: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
          }}>
            <Database size={28} />
          </div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
            พร้อมเชื่อมต่อฐานข้อมูลผู้ป่วยในจริง (HOSxP / BMS Cloud)
          </h3>
          <p style={{ margin: '0 auto 20px auto', maxWidth: '560px', fontSize: '13px', color: '#64748b', lineHeight: '1.6' }}>
            ระบบนี้ทำงานโดยตรงกับฐานข้อมูล HIS ของโรงพยาบาล โดยไม่มีการจำลองข้อมูล (No Mock Data)
            เพื่อความถูกต้องและปลอดภัย โปรดระบุ BMS Session ID หรือเปิดระบบผ่านลิงก์ของโรงพยาบาล
          </p>

          <form onSubmit={handleManualConnect} style={{ maxWidth: '460px', margin: '0 auto', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="ระบุ BMS Session ID (เช่น d8f7a...)"
              value={sessionIdInput}
              onChange={(e) => setSessionIdInput(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={connectingSession || !sessionIdInput.trim()}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 18px',
                fontSize: '13px',
                fontWeight: '700',
                cursor: connectingSession ? 'not-allowed' : 'pointer',
              }}
            >
              {connectingSession ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อ HIS'}
            </button>
          </form>

          {sessionError && (
            <div style={{ marginTop: '12px', color: '#dc2626', fontSize: '12px', fontWeight: '600' }}>
              ⚠️ {sessionError}
            </div>
          )}
        </div>
      )}

      {/* Streamlined Dropdown Filter Toolbar */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        padding: '16px 20px',
        border: '1px solid #e2e8f0',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px',
          alignItems: 'flex-end',
        }}>
          {/* Dropdown 1: Fiscal Year */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Calendar size={13} color="#2563eb" /> ปีงบประมาณ:
              </span>
            </label>
            <select
              value={selectedFiscalYear}
              onChange={(e) => handleFiscalYearChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: '600',
                color: '#0f172a',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="query_all">
                ทั้งหมดตาม Query (2567-2569: 2023-10-01 ถึง 2026-09-30)
              </option>
              {availableFiscalYears.map((year) => (
                <option key={year} value={year}>
                  ปีงบประมาณ {year} {year === currentFiscalYear ? '(ปัจจุบัน)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Dropdown 2: Fiscal Month */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={13} color="#059669" /> เดือนในรอบปีงบ:
              </span>
            </label>
            <select
              value={selectedFiscalMonth}
              onChange={(e) => handleFiscalMonthChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: '500',
                color: '#0f172a',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">ทั้งปีงบประมาณ (12 เดือน)</option>
              {THAI_FISCAL_MONTHS.map((m) => (
                <option key={m.fiscalMonth} value={m.fiscalMonth}>
                  เดือน {m.fiscalMonth}: {m.fullName} ({m.name})
                </option>
              ))}
            </select>
          </div>

          {/* Dropdown 3: Ward */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Building size={13} color="#8b5cf6" /> หอผู้ป่วย:
              </span>
            </label>
            <select
              value={selectedWard}
              onChange={(e) => setSelectedWard(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                color: '#0f172a',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">ทุกหอผู้ป่วย</option>
              {availableWards.map((w) => (
                <option key={w.code} value={w.code}>
                  [{w.code}] {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Dropdown 4: Coding Status */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Activity size={13} color="#d97706" /> สถานะการลงรหัส:
              </span>
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'uncoded' | 'coded')}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: '500',
                color: '#0f172a',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">สถานะทั้งหมด</option>
              <option value="uncoded">ยังไม่ลงรหัสโรค (Uncoded / DRG ว่าง)</option>
              <option value="coded">ลงรหัสโรคแล้ว (Coded / มี DRG แล้ว)</option>
            </select>
          </div>

          {/* Dropdown 5: Scheme / Pttype */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={13} color="#0284c7" /> สิทธิการรักษา:
              </span>
            </label>
            <select
              value={selectedScheme}
              onChange={(e) => setSelectedScheme(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                color: '#0f172a',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">ทุกสิทธิการรักษา</option>
              <option value="ucs">บัตรทอง (UCS 8,350 ฿)</option>
              <option value="ofc">ข้าราชการ (OFC 7,500 ฿)</option>
              <option value="sss">ประกันสังคม (SSS 11,000-12,000 ฿)</option>
            </select>
          </div>
        </div>

        {/* Search & Date info bar */}
        <div style={{
          marginTop: '14px',
          paddingTop: '12px',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          {/* Search box */}
          <div style={{ position: 'relative', flex: 1, minWidth: '240px', maxWidth: '420px' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '10px' }} />
            <input
              type="text"
              placeholder="ค้นหา AN, HN, ชื่อผู้ป่วย, หรือรหัสโรค PDx..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 12px 7px 32px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#64748b' }}>
            <span>
              ช่วงวันที่สืบค้น: <strong>{dstart}</strong> ถึง <strong>{dend}</strong>
            </span>
            <button
              type="button"
              onClick={() => setShowCustomDate(!showCustomDate)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563eb',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {showCustomDate ? 'ซ่อนการระบุวันที่เอง' : 'ระบุวันที่เอง'}
            </button>
          </div>
        </div>

        {/* Collapsible custom date inputs */}
        {showCustomDate && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            fontSize: '12px',
          }}>
            <span>ตั้งแต่วันที่:</span>
            <input
              type="date"
              value={dstart}
              onChange={(e) => setDstart(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
            <span>ถึงวันที่:</span>
            <input
              type="date"
              value={dend}
              onChange={(e) => setDend(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '14px',
        marginBottom: '20px',
      }}>
        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '14px 18px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>เคสผู้ป่วยทั้งหมด</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
            {stats.total.toLocaleString()} ราย
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '14px 18px', border: '1px solid #fecaca' }}>
          <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: '700' }}>ยังไม่ลงรหัสโรค (Uncoded)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#dc2626', marginTop: '4px' }}>
            {stats.uncoded.toLocaleString()} ราย
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '14px 18px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>ลงรหัสโรคแล้ว (Coded)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#16a34a', marginTop: '4px' }}>
            {stats.coded.toLocaleString()} ราย
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '14px 18px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>ค่าเฉลี่ย CMI (Case Mix Index)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb', marginTop: '4px' }}>
            {stats.avgCmi.toFixed(4)}
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '14px 18px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>ประมาณการรายได้ชดเชย UCS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
            ฿{stats.estUcsRevenue.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Case Table / Empty State */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px auto' }} />
            <div>กำลังสืบค้นข้อมูลผู้ป่วยในจากระบบ HIS...</div>
          </div>
        ) : error ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>
            <AlertCircle size={36} style={{ margin: '0 auto 12px auto' }} />
            <div style={{ fontWeight: '700', fontSize: '15px' }}>ไม่สามารถดึงข้อมูลได้</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>{error}</div>
          </div>
        ) : filteredCases.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center', color: '#64748b' }}>
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
              color: '#94a3b8',
            }}>
              <Search size={26} />
            </div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '700', color: '#1e293b' }}>
              {sessionStatus === 'connected' ? 'ไม่พบข้อมูลผู้ป่วยใน' : 'ยังไม่ได้เชื่อมต่อระบบ HIS'}
            </h4>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
              {sessionStatus === 'connected'
                ? 'ไม่พบข้อมูลผู้ป่วยตามปีงบประมาณ เดือน หรือเงื่อนไขตัวกรองที่เลือก ลองเปลี่ยนเดือนหรือช่วงวันที่'
                : 'กรุณาเชื่อมต่อ BMS Session เพื่อดึงข้อมูลจริงจากโรงพยาบาล'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '700' }}>
                  <th style={{ padding: '12px 16px' }}>AN / HN</th>
                  <th style={{ padding: '12px 16px' }}>ผู้ป่วย</th>
                  <th style={{ padding: '12px 16px' }}>หอผู้ป่วย</th>
                  <th style={{ padding: '12px 16px' }}>วันจำหน่าย / LOS</th>
                  <th style={{ padding: '12px 16px' }}>รหัสโรค (PDx / SDx)</th>
                  <th style={{ padding: '12px 16px' }}>DRG / AdjRW</th>
                  <th style={{ padding: '12px 16px' }}>สถานะและความถูกต้อง</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((c) => {
                  const isUncoded = c.remark === 'ยังไม่ลงรหัสโรค' || !c.pdx;
                  const auditRes = auditClinicalCase({
                    an: c.an || '',
                    age: c.age,
                    sex: c.sex,
                    los: c.los ?? 0,
                    pdx: c.pdx,
                    sdx: [c.sdx1, c.sdx2, c.sdx3, c.sdx4].filter(Boolean) as string[],
                    proc: [c.proc1, c.proc2, c.proc3].filter(Boolean) as string[],
                    rw: c.rw,
                    adjrw: c.adjrw,
                  });

                  return (
                    <tr
                      key={c.an}
                      onClick={() => onSelectCaseForOptimization(c.an || '')}
                      title="คลิกแถวเพื่อส่งต่อเข้าสู่หน้าวิเคราะห์ DRG ทันที"
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background-color 0.15s ease',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
                    >
                      {/* AN / HN */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>AN: {c.an}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>HN: {c.hn}</div>
                      </td>

                      {/* Patient Name */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: '600', color: '#1e293b' }}>
                          {c.ptname || 'ไม่ระบุชื่อ'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {c.sex || '-'} • อายุ {c.age ?? '-'} ปี
                        </div>
                      </td>

                      {/* Ward */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ color: '#334155' }}>
                          {c.firstWardName || c.lastWardName || c.firstWard || '-'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {c.pttypeName || c.pttype || '-'}
                        </div>
                      </td>

                      {/* Discharge Date & LOS */}
                      <td style={{ padding: '12px 16px' }}>
                        <div>{c.dchdate || '-'}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          วันนอน: <strong>{c.los} วัน</strong>
                        </div>
                      </td>

                      {/* Diagnoses */}
                      <td style={{ padding: '12px 16px' }}>
                        {isUncoded ? (
                          <span style={{
                            fontSize: '11px',
                            color: '#dc2626',
                            backgroundColor: '#fef2f2',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: '600',
                          }}>
                            ยังไม่ลงรหัสโรค
                          </span>
                        ) : (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: '700' }}>PDX:</span>
                              <span style={{
                                fontWeight: '700',
                                color: '#1e40af',
                                backgroundColor: '#eff6ff',
                                padding: '1px 6px',
                                borderRadius: '4px',
                              }}>
                                {c.pdx}
                              </span>
                            </div>
                            {(c.sdx1 || c.sdx2) && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                SDx: {[c.sdx1, c.sdx2, c.sdx3].filter(Boolean).join(', ')}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* DRG & AdjRW */}
                      <td style={{ padding: '12px 16px' }}>
                        {c.drg ? (
                          <div>
                            <div style={{ fontWeight: '700', color: '#0f172a' }}>DRG: {c.drg}</div>
                            <div style={{ fontSize: '11px', color: '#059669', fontWeight: '600' }}>
                              AdjRW: {c.adjrw ? Number(c.adjrw).toFixed(4) : '-'}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>-</span>
                        )}
                      </td>

                      {/* Clinical Accuracy Audit Badge */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '700',
                            backgroundColor:
                              auditRes.grade === 'A'
                                ? '#ecfdf5'
                                : auditRes.grade === 'B'
                                ? '#eff6ff'
                                : auditRes.grade === 'C'
                                ? '#fffbeb'
                                : '#fef2f2',
                            color:
                              auditRes.grade === 'A'
                                ? '#065f46'
                                : auditRes.grade === 'B'
                                ? '#1e40af'
                                : auditRes.grade === 'C'
                                ? '#92400e'
                                : '#991b1b',
                            border: `1px solid ${
                              auditRes.grade === 'A'
                                ? '#a7f3d0'
                                : auditRes.grade === 'B'
                                ? '#bfdbfe'
                                : auditRes.grade === 'C'
                                ? '#fde68a'
                                : '#fecaca'
                            }`,
                          }}>
                            เกรด {auditRes.grade} ({auditRes.score}%)
                          </span>
                        </div>
                        {auditRes.issues.length > 0 && (
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            {auditRes.issues[0].title}
                          </div>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => onSelectCaseForOptimization(c.an || '')}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '6px 12px',
                            backgroundColor: isUncoded ? '#2563eb' : '#f1f5f9',
                            color: isUncoded ? '#ffffff' : '#1e293b',
                            borderRadius: '6px',
                            border: isUncoded ? 'none' : '1px solid #cbd5e1',
                            fontSize: '12px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Sparkles size={13} color={isUncoded ? '#ffffff' : '#2563eb'} />
                          {isUncoded ? 'ให้รหัส & วิเคราะห์' : 'วิเคราะห์ DRG'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
