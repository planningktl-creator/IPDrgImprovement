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
  // Dynamic Thai Fiscal Year default range (no hardcoded dates)
  const initialDateRange = useMemo(() => getCurrentFiscalYearRange(), []);
  const [dstart, setDstart] = useState<string>(initialDateRange.dstart);
  const [dend, setDend] = useState<string>(initialDateRange.dend);
  const [statusFilter, setStatusFilter] = useState<'all' | 'uncoded' | 'coded'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedWard, setSelectedWard] = useState<string>('all');

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

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <User size={15} /> จำนวนเคสทั้งหมด
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '6px' }}>
            {stats.total.toLocaleString()} <span style={{ fontSize: '14px', fontWeight: '500', color: '#64748b' }}>เคส</span>
          </div>
        </div>

        <div style={{ backgroundColor: '#fffbeb', borderRadius: '10px', padding: '16px', border: '1px solid #fef3c7', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '12px', color: '#92400e', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={15} /> ยังไม่ลงรหัสโรค (เป้าหมายทบทวน)
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#b45309', marginTop: '6px' }}>
            {stats.uncoded.toLocaleString()} <span style={{ fontSize: '14px', fontWeight: '500', color: '#92400e' }}>เคส</span>
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Activity size={15} /> CMI เฉลี่ย (เคสที่ลงรหัสแล้ว)
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#059669', marginTop: '6px' }}>
            {stats.avgCmi.toFixed(4)}
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={15} /> ผลรวม AdjRW
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#2563eb', marginTop: '6px' }}>
            {stats.totalAdjrw.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '18px', border: '1px solid #e2e8f0', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {/* Quick Date Presets Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Calendar size={14} color="#2563eb" /> ช่วงเวลาด่วน:
          </span>
          <button
            type="button"
            onClick={() => {
              const r = getCurrentFiscalYearRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: '#334155',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            ปีงบประมาณนี้ (ถึงวันนี้)
          </button>
          <button
            type="button"
            onClick={() => {
              const r = getCurrentMonthRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: '#334155',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            เดือนนี้
          </button>
          <button
            type="button"
            onClick={() => {
              const r = getLastDaysRange(30);
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: '#334155',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            30 วันล่าสุด
          </button>
          <button
            type="button"
            onClick={() => {
              const r = getPreviousFiscalYearRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: '#334155',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            ปีงบก่อนหน้า
          </button>
          <button
            type="button"
            onClick={() => {
              const r = getFullFiscalYearRange();
              setDstart(r.dstart);
              setDend(r.dend);
            }}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: '#334155',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            ปีงบเต็มปี (ต.ค. - ก.ย.)
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
          {/* Date Range Controls */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>
              วันที่จำหน่ายเริ่มต้น (dstart)
            </label>
            <input
              type="date"
              value={dstart}
              onChange={(e) => setDstart(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>
              วันที่จำหน่ายสิ้นสุด (dend)
            </label>
            <input
              type="date"
              value={dend}
              onChange={(e) => setDend(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
              }}
            />
          </div>

          {/* Ward Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>
              วอร์ด (Ward)
            </label>
            <select
              value={selectedWard}
              onChange={(e) => setSelectedWard(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                minWidth: '160px',
              }}
            >
              <option value="all">ทุกวอร์ด</option>
              {wardOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id})
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div style={{ flex: 1, minWidth: '220px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>
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
                  boxSizing: 'border-box',
                  padding: '8px 12px 8px 34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
              <Search
                size={16}
                style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }}
              />
            </div>
          </div>
        </div>

        {/* Filter Badges Bar */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Filter size={13} /> สถานะรหัสโรค:
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === 'all' ? '#2563eb' : '#f1f5f9',
              color: statusFilter === 'all' ? '#ffffff' : '#475569',
            }}
          >
            ทั้งหมด ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('uncoded')}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === 'uncoded' ? '#d97706' : '#fef3c7',
              color: statusFilter === 'uncoded' ? '#ffffff' : '#92400e',
            }}
          >
            ยังไม่ลงรหัสโรค ({stats.uncoded})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('coded')}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === 'coded' ? '#059669' : '#dcfce7',
              color: statusFilter === 'coded' ? '#ffffff' : '#166534',
            }}
          >
            ลงรหัสแล้ว ({stats.coded})
          </button>

          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#64748b', fontWeight: '500' }}>
            ช่วงวันที่ค้นหา: {dstart} ถึง {dend}
          </span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', color: '#991b1b', fontSize: '13px', marginBottom: '16px' }}>
          <strong>ข้อผิดพลาด:</strong> {error}
        </div>
      )}

      {/* Cases Table */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '12px 14px' }}>AN / HN</th>
                <th style={{ padding: '12px 14px' }}>ผู้ป่วย (Masked)</th>
                <th style={{ padding: '12px 14px' }}>วอร์ด</th>
                <th style={{ padding: '12px 14px' }}>วันจำหน่าย (LOS)</th>
                <th style={{ padding: '12px 14px' }}>วินิจฉัยหลัก (PDx)</th>
                <th style={{ padding: '12px 14px' }}>วินิจฉัยร่วม (SDx 1..12)</th>
                <th style={{ padding: '12px 14px' }}>หัตถการ (Proc)</th>
                <th style={{ padding: '12px 14px' }}>DRG / AdjRW</th>
                <th style={{ padding: '12px 14px' }}>สถานะ</th>
                <th style={{ padding: '12px 14px', textAlign: 'center' }}>การกระทำ</th>
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
                      style={{
                        borderBottom: '1px solid #e2e8f0',
                        backgroundColor: isUncoded ? '#fffdfa' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>{c.an}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>HN: {c.hn || '-'}</div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: '600', color: '#334155' }}>
                          {c.ptname || 'ไม่ระบุชื่อ'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {c.sex || '-'} &bull; {c.age != null ? `${c.age} ปี` : '-'}
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ color: '#0f172a', fontWeight: '500' }}>
                          {c.lastWardName || c.firstWardName || '-'}
                        </div>
                        {c.firstWardName && c.lastWardName && c.firstWardName !== c.lastWardName && (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            แรกรับ: {c.firstWardName}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ color: '#0f172a' }}>{c.dchdate || '-'}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {c.los != null ? `${c.los} วัน` : '-'}
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        {c.pdx ? (
                          <span style={{
                            backgroundColor: '#dbeafe',
                            color: '#1e40af',
                            fontWeight: '700',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                          }}>
                            {c.pdx}
                          </span>
                        ) : (
                          <span style={{ color: '#d97706', fontWeight: '600' }}>-</span>
                        )}
                      </td>

                      <td style={{ padding: '12px 14px', maxWidth: '200px' }}>
                        {allSdx.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {allSdx.slice(0, 4).map((s, sIdx) => (
                              <span key={sIdx} style={{
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                padding: '2px 5px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: '500',
                              }}>
                                {s}
                              </span>
                            ))}
                            {allSdx.length > 4 && (
                              <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center' }}>
                                +{allSdx.length - 4}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>-</span>
                        )}
                      </td>

                      <td style={{ padding: '12px 14px', maxWidth: '160px' }}>
                        {allProc.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {allProc.slice(0, 3).map((p, pIdx) => (
                              <span key={pIdx} style={{
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                padding: '2px 5px',
                                borderRadius: '3px',
                                fontSize: '11px',
                              }}>
                                {p}
                              </span>
                            ))}
                            {allProc.length > 3 && (
                              <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center' }}>
                                +{allProc.length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>-</span>
                        )}
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>
                          {c.drg || '-'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#059669', fontWeight: '600' }}>
                          AdjRW: {c.adjrw != null ? c.adjrw.toFixed(4) : '-'}
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        {isUncoded ? (
                          <span style={{
                            backgroundColor: '#fef3c7',
                            color: '#b45309',
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '700',
                            display: 'inline-block',
                          }}>
                            ยังไม่ลงรหัสโรค
                          </span>
                        ) : (
                          <span style={{
                            backgroundColor: '#dcfce7',
                            color: '#15803d',
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            display: 'inline-block',
                          }}>
                            ลงรหัสแล้ว
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => onSelectCaseForOptimization(c.an || '')}
                          style={{
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                          }}
                        >
                          <Sparkles size={13} />
                          วิเคราะห์ DRG
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                    {loading ? 'กำลังสืบค้นข้อมูล...' : 'ไม่พบเคสผู้ป่วยตามเงื่อนไขที่เลือก'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WorklistPage;
