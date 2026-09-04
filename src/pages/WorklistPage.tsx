import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { CmiCaseRow, WorklistQueryParams } from '@/cmi/caseContract';
import { fetchCaseWorklist, type BmsConnectionConfig } from '@/services/cmiApi';
import {
  Search,
  Filter,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Clock,
  User,
  Activity,
  Calendar,
} from 'lucide-react';
import {
  getThaiFiscalYear,
  getRecentFiscalYears,
  getFiscalYearRange,
  getFiscalMonthRange,
  THAI_FISCAL_MONTHS,
  getCurrentFiscalYearRange,
  getFullFiscalYearRange,
  getCurrentMonthRange,
  getLastDaysRange,
  getPreviousFiscalYearRange,
} from '@/utils/dateUtils';

export interface WorklistPageProps {
  onSelectCaseForOptimization: (an: string) => void;
  connectionConfig: BmsConnectionConfig | null;
  sessionStatus: 'idle' | 'connected' | 'demo' | 'error';
}

export const WorklistPage: React.FC<WorklistPageProps> = ({
  onSelectCaseForOptimization,
  connectionConfig,
  sessionStatus,
}) => {
  // Fiscal Year state management
  const currentFiscalYear = useMemo(() => getThaiFiscalYear(), []);
  const availableFiscalYears = useMemo(() => getRecentFiscalYears(5), []);

  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(currentFiscalYear);
  const [selectedFiscalMonth, setSelectedFiscalMonth] = useState<number | 'all'>('all');
  const [isCurrentYearToDate, setIsCurrentYearToDate] = useState<boolean>(true);

  // Dynamic Thai Fiscal Year default range (no hardcoded dates)
  const initialDateRange = useMemo(() => getCurrentFiscalYearRange(), []);
  const [dstart, setDstart] = useState<string>(initialDateRange.dstart);
  const [dend, setDend] = useState<string>(initialDateRange.dend);
  const [statusFilter, setStatusFilter] = useState<'all' | 'uncoded' | 'coded'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedWard, setSelectedWard] = useState<string>('all');

  const handleSelectFiscalYear = (year: number) => {
    setSelectedFiscalYear(year);
    setSelectedFiscalMonth('all');
    const range = getFiscalYearRange(year, year !== currentFiscalYear || !isCurrentYearToDate);
    setDstart(range.dstart);
    setDend(range.dend);
  };

  const handleSelectFiscalMonth = (month: number | 'all') => {
    setSelectedFiscalMonth(month);
    if (month === 'all') {
      const range = getFiscalYearRange(selectedFiscalYear, selectedFiscalYear !== currentFiscalYear || !isCurrentYearToDate);
      setDstart(range.dstart);
      setDend(range.dend);
    } else {
      const range = getFiscalMonthRange(selectedFiscalYear, month);
      setDstart(range.dstart);
      setDend(range.dend);
    }
  };

  const handleToggleCurrentYearScope = (toDate: boolean) => {
    setIsCurrentYearToDate(toDate);
    if (selectedFiscalMonth === 'all') {
      const range = getFiscalYearRange(selectedFiscalYear, !toDate);
      setDstart(range.dstart);
      setDend(range.dend);
    }
  };

  const [cases, setCases] = useState<CmiCaseRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorklist = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const isDemo = sessionStatus !== 'connected';
      const params: WorklistQueryParams = {
        dstart,
        dend,
        ward: selectedWard !== 'all' ? selectedWard : undefined,
        statusFilter,
        search: searchQuery,
      };

      const result = await fetchCaseWorklist(params, connectionConfig || undefined, {
        useDemoFallback: isDemo,
      });
      setCases(result);
    } catch (err) {
      setError((err as Error).message || 'เกิดข้อผิดพลาดในการโหลดทะเบียนผู้ป่วยใน');
    } finally {
      setLoading(false);
    }
  }, [dstart, dend, selectedWard, statusFilter, searchQuery, connectionConfig, sessionStatus]);

  useEffect(() => {
    let ignore = false;
    const isDemo = sessionStatus !== 'connected';
    const params: WorklistQueryParams = {
      dstart,
      dend,
      ward: selectedWard !== 'all' ? selectedWard : undefined,
      statusFilter,
      search: searchQuery,
    };

    fetchCaseWorklist(params, connectionConfig || undefined, {
      useDemoFallback: isDemo,
    })
      .then((result) => {
        if (!ignore) {
          setCases(result);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError((err as Error).message || 'เกิดข้อผิดพลาดในการโหลดทะเบียนผู้ป่วยใน');
        }
      });

    return () => {
      ignore = true;
    };
  }, [dstart, dend, selectedWard, statusFilter, searchQuery, connectionConfig, sessionStatus]);

  // Client-side filtering when in demo mode or for instant responsiveness
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
  }, [cases, statusFilter, selectedWard, searchQuery]);

  // Summary KPI Calculations
  const stats = useMemo(() => {
    const total = filteredCases.length;
    const uncoded = filteredCases.filter((c) => c.remark === 'ยังไม่ลงรหัสโรค' || !c.pdx).length;
    const coded = total - uncoded;
    const totalAdjrw = filteredCases.reduce((sum, c) => sum + (c.adjrw || 0), 0);
    const avgCmi = coded > 0 ? totalAdjrw / coded : 0;
    const totalIncome = filteredCases.reduce((sum, c) => sum + (c.income || 0), 0);

    return { total, uncoded, coded, totalAdjrw, avgCmi, totalIncome };
  }, [filteredCases]);

  // Extract unique wards for the dropdown
  const wardOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cases) {
      if (c.firstWard && c.firstWardName) map.set(c.firstWard, c.firstWardName);
      if (c.lastWard && c.lastWardName) map.set(c.lastWard, c.lastWardName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [cases]);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
            ทะเบียนเคสผู้ป่วยใน (Inpatient Case Registry & Worklist)
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            สืบค้นและคัดกรองเคสผู้ป่วยในตามช่วงวันที่จำหน่าย เพื่อตรวจสอบสถานะการลงรหัสโรค และนำเข้าสู่ DRG Optimizer
          </p>
        </div>

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
            }}
          >
            <RefreshCw size={15} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'กำลังโหลด...' : 'รีเฟรชข้อมูล'}
          </button>
        </div>
      </div>

      {/* Fiscal Year Selection Panel */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        padding: '16px 20px',
        border: '1px solid #e2e8f0',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Fiscal Year Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={16} color="#2563eb" /> แสดงข้อมูลปีงบประมาณ:
            </span>
            {availableFiscalYears.map((year) => {
              const isSelected = selectedFiscalYear === year;
              const isCurrent = year === currentFiscalYear;
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => handleSelectFiscalYear(year)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: isSelected ? '700' : '500',
                    border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                    backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                    color: isSelected ? '#1d4ed8' : '#334155',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: isSelected ? '0 1px 2px rgba(37,99,235,0.1)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>ปีงบประมาณ {year}</span>
                  {isCurrent && (
                    <span style={{
                      fontSize: '10px',
                      backgroundColor: isSelected ? '#2563eb' : '#e2e8f0',
                      color: isSelected ? '#ffffff' : '#475569',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      fontWeight: '600',
                    }}>
                      ปัจจุบัน
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Current Year Scope Toggle (when current FY and all months) */}
          {selectedFiscalYear === currentFiscalYear && selectedFiscalMonth === 'all' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', backgroundColor: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
              <button
                type="button"
                onClick={() => handleToggleCurrentYearScope(true)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: isCurrentYearToDate ? '#ffffff' : 'transparent',
                  color: isCurrentYearToDate ? '#1d4ed8' : '#64748b',
                  cursor: 'pointer',
                  fontWeight: isCurrentYearToDate ? '700' : '500',
                  boxShadow: isCurrentYearToDate ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                ถึงปัจจุบัน
              </button>
              <button
                type="button"
                onClick={() => handleToggleCurrentYearScope(false)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: !isCurrentYearToDate ? '#ffffff' : 'transparent',
                  color: !isCurrentYearToDate ? '#1d4ed8' : '#64748b',
                  cursor: 'pointer',
                  fontWeight: !isCurrentYearToDate ? '700' : '500',
                  boxShadow: !isCurrentYearToDate ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                เต็มปีงบประมาณ
              </button>
            </div>
          )}
        </div>

        {/* Fiscal Month Selection Sub-bar */}
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginRight: '4px' }}>
              เดือนในรอบปีงบ {selectedFiscalYear}:
            </span>
            <button
              type="button"
              onClick={() => handleSelectFiscalMonth('all')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: selectedFiscalMonth === 'all' ? '700' : '500',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: selectedFiscalMonth === 'all' ? '#1e293b' : '#f1f5f9',
                color: selectedFiscalMonth === 'all' ? '#ffffff' : '#475569',
              }}
            >
              ทั้งหมด (12 เดือน)
            </button>

            {THAI_FISCAL_MONTHS.map((m) => {
              const isMonthSelected = selectedFiscalMonth === m.fiscalMonth;
              return (
                <button
                  key={m.fiscalMonth}
                  type="button"
                  onClick={() => handleSelectFiscalMonth(m.fiscalMonth)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: isMonthSelected ? '700' : '500',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: isMonthSelected ? '#2563eb' : '#f8fafc',
                    color: isMonthSelected ? '#ffffff' : '#475569',
                  }}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active Scope Summary Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b' }}>
          สรุปสถิติ: <span style={{ color: '#2563eb' }}>ปีงบประมาณ {selectedFiscalYear}</span>
          {selectedFiscalMonth !== 'all' && (
            <span style={{ color: '#059669', marginLeft: '6px' }}>
              (เดือน{THAI_FISCAL_MONTHS.find((m) => m.fiscalMonth === selectedFiscalMonth)?.fullName})
            </span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: '#64748b' }}>
          ช่วงวันจำหน่าย: <strong>{dstart}</strong> ถึง <strong>{dend}</strong>
        </div>
      </div>

      {/* KPI Cards — Executive Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div className="kpi-metric-card kpi-blue">
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={15} color="#2563eb" /> จำนวนเคสทั้งหมด
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#0f172a', marginTop: '8px' }}>
              {stats.total.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>เคส</span>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>ยอดรับรักษาผู้ป่วยในสะสม</span>
          </div>
        </div>

        <div className="kpi-metric-card kpi-amber">
          <div>
            <div style={{ fontSize: '12px', color: '#b45309', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: '#f59e0b',
                display: 'inline-block',
              }} className="animate-pulse-dot" />
              <AlertCircle size={15} color="#d97706" /> ยังไม่ลงรหัสโรค (เป้าหมายทบทวน)
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#b45309', marginTop: '8px' }}>
              {stats.uncoded.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: '600', color: '#b45309' }}>เคส</span>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#92400e', marginTop: '10px', fontWeight: '600' }}>
            ⚠ รอแพทย์และ Coder ให้รหัสโรคสมบูรณ์
          </div>
        </div>

        <div className="kpi-metric-card kpi-emerald">
          <div>
            <div style={{ fontSize: '12px', color: '#047857', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={15} color="#059669" /> CMI เฉลี่ย (เคสที่ลงรหัสแล้ว)
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#059669', marginTop: '8px' }}>
              {stats.avgCmi.toFixed(4)}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#047857', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>จากเคสที่ลงรหัสแล้ว {stats.coded} เคส</span>
          </div>
        </div>

        <div className="kpi-metric-card kpi-purple">
          <div>
            <div style={{ fontSize: '12px', color: '#4338ca', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={15} color="#4f46e5" /> ผลรวม AdjRW
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#1e1b4b', marginTop: '8px' }}>
              {stats.totalAdjrw.toFixed(4)}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#4338ca', marginTop: '10px', fontWeight: '600' }}>
            ประมาณการชดเชย: ฿{(stats.totalAdjrw * 8350).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        {/* Quick Date Presets Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Calendar size={14} color="#2563eb" /> ช่วงเวลาด่วน:
          </span>
          <button
            type="button"
            className="btn-modern btn-ghost-neutral"
            onClick={() => {
              const r = getCurrentFiscalYearRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{ padding: '5px 12px', fontSize: '12px' }}
          >
            ปีงบประมาณนี้ (ถึงวันนี้)
          </button>
          <button
            type="button"
            className="btn-modern btn-ghost-neutral"
            onClick={() => {
              const r = getCurrentMonthRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{ padding: '5px 12px', fontSize: '12px' }}
          >
            เดือนนี้
          </button>
          <button
            type="button"
            className="btn-modern btn-ghost-neutral"
            onClick={() => {
              const r = getLastDaysRange(30);
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{ padding: '5px 12px', fontSize: '12px' }}
          >
            30 วันล่าสุด
          </button>
          <button
            type="button"
            className="btn-modern btn-ghost-neutral"
            onClick={() => {
              const r = getPreviousFiscalYearRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{ padding: '5px 12px', fontSize: '12px' }}
          >
            ปีงบก่อนหน้า
          </button>
          <button
            type="button"
            className="btn-modern btn-ghost-neutral"
            onClick={() => {
              const r = getFullFiscalYearRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{ padding: '5px 12px', fontSize: '12px' }}
          >
            ปีงบเต็มปี (ต.ค. - ก.ย.)
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
          {/* Date Range Controls */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
              วันที่จำหน่ายเริ่มต้น (dstart)
            </label>
            <input
              type="date"
              value={dstart}
              onChange={(e) => setDstart(e.target.value)}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
              วันที่จำหน่ายสิ้นสุด (dend)
            </label>
            <input
              type="date"
              value={dend}
              onChange={(e) => setDend(e.target.value)}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                outline: 'none',
              }}
            />
          </div>

          {/* Ward Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
              หอผู้ป่วย / วอร์ด (Ward)
            </label>
            <select
              value={selectedWard}
              onChange={(e) => setSelectedWard(e.target.value)}
              style={{
                padding: '9px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                minWidth: '180px',
                outline: 'none',
              }}
            >
              <option value="all">ทุกวอร์ด (All Wards)</option>
              {wardOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id})
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div style={{ flex: 1, minWidth: '240px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
              ค้นหาเคส (AN, HN, ชื่อผู้ป่วย, PDx)
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="พิมพ์ AN หรือชื่อโรคเพื่อค้นหา..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 14px 9px 36px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <Search
                size={16}
                style={{ position: 'absolute', left: '12px', top: '11px', color: '#94a3b8' }}
              />
            </div>
          </div>
        </div>

        {/* Filter Badges Bar */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Filter size={14} /> สถานะรหัสโรค:
          </span>
          <button
            type="button"
            className="btn-modern"
            onClick={() => setStatusFilter('all')}
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              backgroundColor: statusFilter === 'all' ? '#2563eb' : '#f1f5f9',
              color: statusFilter === 'all' ? '#ffffff' : '#475569',
            }}
          >
            ทั้งหมด ({stats.total})
          </button>
          <button
            type="button"
            className="btn-modern"
            onClick={() => setStatusFilter('uncoded')}
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              backgroundColor: statusFilter === 'uncoded' ? '#d97706' : '#fef3c7',
              color: statusFilter === 'uncoded' ? '#ffffff' : '#92400e',
              boxShadow: statusFilter === 'uncoded' ? '0 1px 3px rgba(217,119,6,0.2)' : 'none',
            }}
          >
            ยังไม่ลงรหัสโรค ({stats.uncoded})
          </button>
          <button
            type="button"
            className="btn-modern"
            onClick={() => setStatusFilter('coded')}
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              backgroundColor: statusFilter === 'coded' ? '#059669' : '#dcfce7',
              color: statusFilter === 'coded' ? '#ffffff' : '#166534',
            }}
          >
            ลงรหัสแล้ว ({stats.coded})
          </button>

          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#64748b', fontWeight: '600', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            ช่วงวันที่ค้นหา: {dstart} ถึง {dend}
          </span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '14px 18px', color: '#991b1b', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={18} color="#dc2626" />
          <span><strong>ข้อผิดพลาด:</strong> {error}</span>
        </div>
      )}

      {/* Cases Table */}
      <div className="modern-table-wrap">
        <table className="modern-table">
          <thead>
            <tr>
              <th>AN / HN</th>
              <th>ผู้ป่วย (Masked)</th>
              <th>หอผู้ป่วย (Ward)</th>
              <th>วันจำหน่าย (LOS)</th>
              <th>วินิจฉัยหลัก (PDx)</th>
              <th>วินิจฉัยร่วม (SDx 1..12)</th>
              <th>หัตถการ (Proc)</th>
              <th>DRG / AdjRW</th>
              <th>สถานะ</th>
              <th style={{ textAlign: 'center' }}>การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            {filteredCases.length > 0 ? (
              filteredCases.map((c) => {
                const isUncoded = c.remark === 'ยังไม่ลงรหัสโรค' || !c.pdx;
                const allSdx = [
                  c.sdx1, c.sdx2, c.sdx3, c.sdx4,
                  c.sdx5, c.sdx6, c.sdx7, c.sdx8,
                  c.sdx9, c.sdx10, c.sdx11, c.sdx12,
                ].filter(Boolean);

                const allProc = [
                  c.proc1, c.proc2, c.proc3, c.proc4,
                  c.proc5, c.proc6, c.proc7, c.proc8,
                  c.proc9, c.proc10, c.proc11, c.proc12,
                ].filter(Boolean);

                return (
                  <tr
                    key={c.an}
                    className={isUncoded ? 'row-uncoded' : ''}
                  >
                    <td>
                      <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px', letterSpacing: '0.02em' }}>
                        {c.an}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>HN: {c.hn || '-'}</div>
                    </td>

                    <td>
                      <div style={{ fontWeight: '600', color: '#1e293b' }}>
                        {c.ptname || 'ไม่ระบุชื่อ'}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                        <span style={{ backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>{c.sex || '-'}</span>
                        <span>&bull;</span>
                        <span>{c.age != null ? `${c.age} ปี` : '-'}</span>
                      </div>
                    </td>

                    <td>
                      <div style={{ color: '#0f172a', fontWeight: '600' }}>
                        {c.lastWardName || c.firstWardName || '-'}
                      </div>
                      {c.firstWardName && c.lastWardName && c.firstWardName !== c.lastWardName && (
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          แรกรับ: {c.firstWardName}
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ color: '#0f172a', fontWeight: '500' }}>{c.dchdate || '-'}</div>
                      <div style={{ fontSize: '11px', color: '#2563eb', fontWeight: '600', marginTop: '2px' }}>
                        {c.los != null ? `${c.los} วันนอน` : '-'}
                      </div>
                    </td>

                    <td>
                      {c.pdx ? (
                        <span className="chip-code chip-pdx">
                          {c.pdx}
                        </span>
                      ) : (
                        <span style={{ color: '#d97706', fontWeight: '700', fontSize: '13px' }}>-</span>
                      )}
                    </td>

                    <td style={{ maxWidth: '220px' }}>
                      {allSdx.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {allSdx.slice(0, 4).map((s, sIdx) => (
                            <span key={sIdx} className="chip-code chip-sdx">
                              {s}
                            </span>
                          ))}
                          {allSdx.length > 4 && (
                            <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center', fontWeight: '600', backgroundColor: '#f1f5f9', padding: '2px 5px', borderRadius: '4px' }}>
                              +{allSdx.length - 4}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>-</span>
                      )}
                    </td>

                    <td style={{ maxWidth: '180px' }}>
                      {allProc.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {allProc.slice(0, 3).map((p, pIdx) => (
                            <span key={pIdx} className="chip-code" style={{ backgroundColor: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1' }}>
                              {p}
                            </span>
                          ))}
                          {allProc.length > 3 && (
                            <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center', fontWeight: '600', backgroundColor: '#f1f5f9', padding: '2px 5px', borderRadius: '4px' }}>
                              +{allProc.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>-</span>
                      )}
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="chip-code chip-drg">
                          {c.drg || '-'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#059669', fontWeight: '700', marginTop: '3px' }}>
                        AdjRW: {c.adjrw != null ? c.adjrw.toFixed(4) : '-'}
                      </div>
                    </td>

                    <td>
                      {isUncoded ? (
                        <span style={{
                          backgroundColor: '#fef3c7',
                          color: '#b45309',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '700',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid #fde68a',
                        }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b' }} className="animate-pulse-dot" />
                          ยังไม่ลงรหัสโรค
                        </span>
                      ) : (
                        <span style={{
                          backgroundColor: '#dcfce7',
                          color: '#15803d',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '600',
                          display: 'inline-block',
                          border: '1px solid #bbf7d0',
                        }}>
                          ลงรหัสแล้ว
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn-modern btn-primary-gradient"
                        onClick={() => onSelectCaseForOptimization(c.an || '')}
                        style={{ padding: '6px 14px', fontSize: '12px' }}
                      >
                        <Sparkles size={14} />
                        วิเคราะห์ DRG
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={10} style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                  {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite', color: '#2563eb' }} />
                      <span>กำลังสืบค้นข้อมูลจากฐานข้อมูล...</span>
                    </div>
                  ) : (
                    'ไม่พบเคสผู้ป่วยตามเงื่อนไขที่เลือก'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WorklistPage;
