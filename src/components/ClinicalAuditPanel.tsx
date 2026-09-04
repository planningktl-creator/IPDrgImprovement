import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, DollarSign, Info, Layers, PlusCircle, ShieldAlert, Sparkles } from 'lucide-react';
import type { ClinicalAuditResult, AuditIssue } from '@/audit/clinicalAuditEngine';

export interface ClinicalAuditPanelProps {
  audit: ClinicalAuditResult;
  onApplyCode?: (code: string, isPdx?: boolean) => void;
}

type IssueFilter = 'all' | 'errors' | 'warnings' | 'opportunities';

function issueIcon(issue: AuditIssue) {
  if (issue.type === 'error') return <AlertCircle size={17} />;
  if (issue.type === 'warning') return <AlertTriangle size={17} />;
  if (issue.type === 'opportunity') return <Sparkles size={17} />;
  return <Info size={17} />;
}

function gradeTone(grade: ClinicalAuditResult['grade']): string {
  return grade === 'A' ? 'grade-a' : grade === 'B' ? 'grade-b' : grade === 'C' ? 'grade-c' : 'grade-d';
}

export function ClinicalAuditPanel({ audit, onApplyCode }: ClinicalAuditPanelProps) {
  const [filter, setFilter] = useState<IssueFilter>('all');
  const counts = useMemo(() => ({
    all: audit.issues.length,
    errors: audit.issues.filter((item) => item.type === 'error').length,
    warnings: audit.issues.filter((item) => item.type === 'warning').length,
    opportunities: audit.issues.filter((item) => item.type === 'opportunity').length,
  }), [audit.issues]);
  const issueType: AuditIssue['type'] | null = filter === 'errors' ? 'error' : filter === 'warnings' ? 'warning' : filter === 'opportunities' ? 'opportunity' : null;
  const issues = issueType ? audit.issues.filter((item) => item.type === issueType) : audit.issues;

  return <section className="audit-panel" aria-labelledby="audit-title">
    <header className="audit-header"><div className="audit-title-wrap"><div className="audit-icon"><ShieldAlert size={19} /></div><div><span className="eyebrow">CLINICAL GOVERNANCE</span><h3 id="audit-title">ระบบตรวจสอบความถูกต้องของรหัสโรคและเกณฑ์ DRG (Clinical Coding Audit)</h3><p>อ้างอิงมาตรฐาน สรท., TDRG V6.3.x และแนวทาง CMI@MOPH</p></div></div><div className={`grade-card ${gradeTone(audit.grade)}`}><span>คะแนนคุณภาพการให้รหัส</span><strong>{audit.score}/100 <b>เกรด {audit.grade}</b></strong></div></header>
    <div className="audit-context"><span className="context-chip"><Layers size={14} />{audit.partitionType === 'Surgical' ? 'Surgical DRG' : 'Medical DRG'}</span><span className={`context-chip outlier-${audit.outlier.status}`}><Clock3 size={14} />LOS {audit.outlier.actlos} วัน · {audit.outlier.status === 'normal' ? 'ปกติ' : audit.outlier.status === 'high_outlier' ? 'High Outlier' : 'Low Outlier'}</span><div className="reimbursement-strip"><DollarSign size={14} />{audit.reimbursements.length > 0 ? audit.reimbursements.map((item) => <span className="money-chip" key={item.scheme} title={`${item.schemeName} · ${item.baseRate.toLocaleString()} บาท/AdjRW`}>{item.scheme.toUpperCase()} ฿{item.baselineRevenue.toLocaleString()}</span>) : <span className="muted">ยังไม่ได้ตั้งค่า reimbursement rate</span>}</div></div>
    <div className="audit-tabs" role="tablist" aria-label="ตัวกรองประเด็นตรวจสอบ"><button className={filter === 'all' ? 'is-active' : ''} type="button" role="tab" aria-selected={filter === 'all'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>ทั้งหมด ({counts.all})</button><button className={filter === 'errors' ? 'is-active tab-danger' : 'tab-danger'} type="button" role="tab" aria-selected={filter === 'errors'} aria-pressed={filter === 'errors'} onClick={() => setFilter('errors')} disabled={counts.errors === 0}><AlertCircle size={14} />วิกฤต ({counts.errors})</button><button className={filter === 'warnings' ? 'is-active tab-warning' : 'tab-warning'} type="button" role="tab" aria-selected={filter === 'warnings'} aria-pressed={filter === 'warnings'} onClick={() => setFilter('warnings')} disabled={counts.warnings === 0}><AlertTriangle size={14} />ระวัง ({counts.warnings})</button><button className={filter === 'opportunities' ? 'is-active tab-success' : 'tab-success'} type="button" role="tab" aria-selected={filter === 'opportunities'} aria-pressed={filter === 'opportunities'} onClick={() => setFilter('opportunities')} disabled={counts.opportunities === 0}><Sparkles size={14} />เพิ่มความจำเพาะ ({counts.opportunities})</button></div>
    <div className="audit-content">{issues.length === 0 ? <div className="audit-clear"><CheckCircle2 size={30} /><strong>ไม่พบข้อผิดพลาดในหมวดนี้</strong><span>{audit.gradeDescription}</span></div> : <div className="issue-list">{issues.map((issue) => <article className={`issue-card issue-${issue.type}`} key={issue.id}><div className="issue-icon">{issueIcon(issue)}</div><div className="issue-copy"><strong>{issue.title}</strong><p>{issue.description}</p>{issue.suggestedAction && <span className="issue-action">คำแนะนำ: {issue.suggestedAction}</span>}</div>{issue.suggestedCode && onApplyCode && <button className="button button-primary button-small" type="button" onClick={() => onApplyCode(issue.suggestedCode ?? '')}><PlusCircle size={14} />เพิ่ม {issue.suggestedCode}</button>}</article>)}</div>}</div>
    <footer className="audit-footer"><span>หมายเหตุ WtLOS/OT: {audit.outlier.paymentAdjustmentNote}</span>{audit.outlier.wtlos != null && audit.outlier.ot != null && <span>WtLOS {audit.outlier.wtlos.toFixed(2)} · OT {audit.outlier.ot}</span>}</footer>
  </section>;
}
