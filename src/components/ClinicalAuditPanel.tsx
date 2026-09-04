import React, { useState } from 'react';
import type { ClinicalAuditResult } from '@/audit/clinicalAuditEngine';
import {
  AlertCircle,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Info,
  ShieldAlert,
  Clock,
  DollarSign,
  Layers,
  Scissors,
  PlusCircle,
} from 'lucide-react';

export interface ClinicalAuditPanelProps {
  audit: ClinicalAuditResult;
  onApplyCode?: (code: string, isPdx?: boolean) => void;
}

export const ClinicalAuditPanel: React.FC<ClinicalAuditPanelProps> = ({ audit, onApplyCode }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'errors' | 'warnings' | 'opportunities'>('all');

  const errorIssues = audit.issues.filter((i) => i.type === 'error');
  const warningIssues = audit.issues.filter((i) => i.type === 'warning');
  const opportunityIssues = audit.issues.filter((i) => i.type === 'opportunity');

  const displayedIssues =
    activeTab === 'errors'
      ? errorIssues
      : activeTab === 'warnings'
      ? warningIssues
      : activeTab === 'opportunities'
      ? opportunityIssues
      : audit.issues;

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A':
        return { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' };
      case 'B':
        return { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' };
      case 'C':
        return { bg: '#fffbeb', text: '#92400e', border: '#fde68a' };
      default:
        return { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' };
    }
  };

  const gradeColors = getGradeColor(audit.grade);

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        background: 'linear-gradient(to right, #f8fafc, #ffffff)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            backgroundColor: '#2563eb',
            color: '#ffffff',
            borderRadius: '8px',
            padding: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <ShieldAlert size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>
              ระบบตรวจสอบความถูกต้องของรหัสโรคและเกณฑ์ DRG (Clinical Coding Audit)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              อ้างอิงมาตรฐาน สรท., TDRG V6.3.x และแนวทาง CMI@MOPH (รพศ.ราชบุรี)
            </p>
          </div>
        </div>

        {/* Quality Score Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: gradeColors.bg,
          border: `1px solid ${gradeColors.border}`,
          borderRadius: '10px',
          padding: '6px 14px',
        }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: '700', color: gradeColors.text, textTransform: 'uppercase' }}>
              คะแนนคุณภาพการให้รหัส
            </div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: gradeColors.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{audit.score}/100</span>
              <span style={{
                fontSize: '11px',
                padding: '1px 6px',
                backgroundColor: gradeColors.text,
                color: '#ffffff',
                borderRadius: '4px',
                fontWeight: '700',
              }}>
                เกรด {audit.grade}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Clinical Context & Indicators Bar */}
      <div style={{
        padding: '12px 20px',
        backgroundColor: '#f8fafc',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        fontSize: '12px',
      }}>
        {/* Partition Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '6px',
          backgroundColor: audit.orProcedureDetected ? '#eff6ff' : '#f1f5f9',
          color: audit.orProcedureDetected ? '#1d4ed8' : '#475569',
          fontWeight: '600',
          border: audit.orProcedureDetected ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
        }}>
          {audit.orProcedureDetected ? <Scissors size={14} /> : <Layers size={14} />}
          <span>กลุ่มการจำแนก: <strong>{audit.partitionType} DRG</strong></span>
        </div>

        {/* Outlier Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '6px',
          backgroundColor:
            audit.outlier.status === 'normal'
              ? '#ecfdf5'
              : audit.outlier.status === 'high_outlier'
              ? '#eff6ff'
              : '#fef2f2',
          color:
            audit.outlier.status === 'normal'
              ? '#065f46'
              : audit.outlier.status === 'high_outlier'
              ? '#1d4ed8'
              : '#991b1b',
          fontWeight: '600',
          border:
            audit.outlier.status === 'normal'
              ? '1px solid #a7f3d0'
              : audit.outlier.status === 'high_outlier'
              ? '1px solid #bfdbfe'
              : '1px solid #fecaca',
        }}>
          <Clock size={14} />
          <span>สถานะวันนอน ({audit.outlier.actlos} วัน): <strong>
            {audit.outlier.status === 'normal'
              ? 'วันนอนปกติ'
              : audit.outlier.status === 'high_outlier'
              ? 'วันนอนเกินเกณฑ์ (High Outlier)'
              : 'วันนอนต่ำเกณฑ์ (Low Outlier)'}
          </strong></span>
        </div>

        {/* Multi-payer Baseline Revenue Simulation */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          marginLeft: 'auto',
          color: '#334155',
          fontWeight: '500',
        }}>
          <DollarSign size={14} color="#059669" />
          <span>ประมาณการรายได้ชดเชย:</span>
          {audit.reimbursements.map((r) => (
            <span
              key={r.scheme}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '600',
                color: '#0f172a',
              }}
              title={`${r.schemeName} (อัตราฐาน ${r.baseRate.toLocaleString()} ฿)`}
            >
              {r.scheme.toUpperCase()}: ฿{r.baselineRevenue.toLocaleString()}
            </span>
          ))}
        </div>
      </div>

      {/* Filter Tabs for Issues */}
      <div style={{
        padding: '10px 20px',
        display: 'flex',
        gap: '8px',
        borderBottom: '1px solid #f1f5f9',
        backgroundColor: '#ffffff',
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          style={{
            padding: '5px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: activeTab === 'all' ? '700' : '500',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: activeTab === 'all' ? '#1e293b' : '#f1f5f9',
            color: activeTab === 'all' ? '#ffffff' : '#64748b',
          }}
        >
          ประเด็นทั้งหมด ({audit.issues.length})
        </button>

        {errorIssues.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('errors')}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: activeTab === 'errors' ? '700' : '500',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'errors' ? '#fee2e2' : '#fef2f2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <AlertCircle size={13} />
            ข้อผิดพลาดวิกฤต ({errorIssues.length})
          </button>
        )}

        {warningIssues.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('warnings')}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: activeTab === 'warnings' ? '700' : '500',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'warnings' ? '#fef3c7' : '#fffbeb',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <AlertTriangle size={13} />
            ข้อควรระวัง ({warningIssues.length})
          </button>
        )}

        {opportunityIssues.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('opportunities')}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: activeTab === 'opportunities' ? '700' : '500',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'opportunities' ? '#dcfce7' : '#f0fdf4',
              color: '#15803d',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={13} />
            เพิ่มความจำเพาะ CC/MCC ({opportunityIssues.length})
          </button>
        )}
      </div>

      {/* Issues List */}
      <div style={{ padding: '16px 20px' }}>
        {displayedIssues.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            color: '#059669',
            backgroundColor: '#ecfdf5',
            borderRadius: '8px',
            border: '1px solid #a7f3d0',
          }}>
            <CheckCircle2 size={32} style={{ margin: '0 auto 8px auto', display: 'block' }} />
            <div style={{ fontWeight: '700', fontSize: '14px' }}>
              ไม่พบข้อผิดพลาดหรือข้อควรระวังในหมวดนี้
            </div>
            <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
              {audit.gradeDescription}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {displayedIssues.map((issue) => {
              const isError = issue.type === 'error';
              const isWarning = issue.type === 'warning';
              const isOpp = issue.type === 'opportunity';

              const icon = isError ? (
                <AlertCircle size={16} color="#dc2626" />
              ) : isWarning ? (
                <AlertTriangle size={16} color="#d97706" />
              ) : isOpp ? (
                <Sparkles size={16} color="#16a34a" />
              ) : (
                <Info size={16} color="#2563eb" />
              );

              const borderColor = isError
                ? '#fecaca'
                : isWarning
                ? '#fde68a'
                : isOpp
                ? '#bbf7d0'
                : '#bfdbfe';

              const bgColor = isError
                ? '#fff5f5'
                : isWarning
                ? '#fffdf5'
                : isOpp
                ? '#f6fef9'
                : '#f8faff';

              return (
                <div
                  key={issue.id}
                  style={{
                    border: `1px solid ${borderColor}`,
                    backgroundColor: bgColor,
                    borderRadius: '8px',
                    padding: '12px 14px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ marginTop: '2px' }}>{icon}</div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
                          {issue.title}
                        </div>
                        <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px', lineHeight: '1.5' }}>
                          {issue.description}
                        </div>
                        {issue.suggestedAction && (
                          <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '4px', fontWeight: '600' }}>
                            คำแนะนำ: {issue.suggestedAction}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {issue.suggestedCode && onApplyCode && (
                        <button
                          type="button"
                          onClick={() => onApplyCode(issue.suggestedCode!)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          <PlusCircle size={13} />
                          เพิ่มรหัส {issue.suggestedCode}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Outlier explanation footer */}
      <div style={{
        padding: '10px 20px',
        backgroundColor: '#f8fafc',
        borderTop: '1px solid #f1f5f9',
        fontSize: '11px',
        color: '#64748b',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <span>
          💡 <strong>หมายเหตุเกณฑ์วันนอน (WtLOS & OT):</strong> {audit.outlier.paymentAdjustmentNote}
        </span>
        {audit.outlier.wtlos && audit.outlier.ot && (
          <span>
            WtLOS มาตรฐาน = {audit.outlier.wtlos.toFixed(2)} วัน | จุดตัด OT = {audit.outlier.ot} วัน
          </span>
        )}
      </div>
    </div>
  );
};
