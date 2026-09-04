import { describe, it, expect } from 'vitest';
import { auditClinicalCase } from '@/audit/clinicalAuditEngine';

describe('ClinicalAuditEngine', () => {
  it('detects missing principal diagnosis and assigns grade D with Error Code 1 warning', () => {
    const res = auditClinicalCase({
      an: '10001',
      los: 3,
      pdx: null,
      sdx: [],
      proc: [],
    });

    expect(res.score).toBeLessThan(70);
    expect(res.grade).toBe('D');
    expect(res.issues.some((i) => i.id === 'pdx-missing')).toBe(true);
  });

  it('detects symptom R-code as PDx and flags for underlying etiology', () => {
    const res = auditClinicalCase({
      an: '10002',
      los: 4,
      pdx: 'R50.9',
      sdx: ['I10'],
      proc: [],
    });

    expect(res.issues.some((i) => i.id === 'pdx-symptom-code')).toBe(true);
  });

  it('detects unacceptable inpatient PDx (Z-code) leading to DRG 26519 error', () => {
    const res = auditClinicalCase({
      an: '10003',
      los: 2,
      pdx: 'Z00.0',
      sdx: [],
      proc: [],
    });

    expect(res.issues.some((i) => i.id === 'pdx-unacceptable')).toBe(true);
    expect(res.score).toBeLessThan(80);
  });

  it('detects duplicate SDx matching PDx and self-duplicates (Warning 1)', () => {
    const res = auditClinicalCase({
      an: '10004',
      los: 5,
      pdx: 'I21.0',
      sdx: ['I21.0', 'E11.9', 'E11.9'],
      proc: [],
    });

    expect(res.issues.some((i) => i.id.startsWith('sdx-dup-pdx'))).toBe(true);
    expect(res.issues.some((i) => i.id.startsWith('sdx-dup-self'))).toBe(true);
  });

  it('suggests specificity refinement for Sepsis A41.9, Pneumonia J18.9, and DM E11.9', () => {
    const res = auditClinicalCase({
      an: '10005',
      los: 6,
      pdx: 'A41.9',
      sdx: ['J18.9', 'E11.9', 'N18.9'],
      proc: [],
    });

    expect(res.issues.some((i) => i.id === 'spec-sepsis')).toBe(true);
    expect(res.issues.some((i) => i.id === 'spec-pneumonia')).toBe(true);
    expect(res.issues.some((i) => i.id === 'spec-dm')).toBe(true);
    expect(res.issues.some((i) => i.id === 'spec-ckd-stage')).toBe(true);
  });

  it('detects missing mechanical ventilation (96.7x) when intubation (96.04) is present', () => {
    const res = auditClinicalCase({
      an: '10006',
      los: 7,
      pdx: 'J96.0',
      sdx: ['I50.9'],
      proc: ['9604'], // Endotracheal intubation without 967x
    });

    expect(res.issues.some((i) => i.id === 'proc-missing-vent')).toBe(true);
  });

  it('detects OR procedures and marks partition as Surgical DRG', () => {
    const res = auditClinicalCase({
      an: '10007',
      los: 5,
      pdx: 'K35.8',
      sdx: [],
      proc: ['4709'], // Appendectomy (OR procedure)
    });

    expect(res.orProcedureDetected).toBe(true);
    expect(res.partitionType).toBe('Surgical');
    expect(res.issues.some((i) => i.id === 'proc-or-detected')).toBe(true);
  });

  it('detects obstetric conflict between normal delivery O80.0 and complications (DRG 26529)', () => {
    const res = auditClinicalCase({
      an: '10008',
      los: 2,
      pdx: 'O800',
      sdx: ['O244'], // Gestational diabetes with normal delivery
      proc: ['7359'],
    });

    expect(res.issues.some((i) => i.id === 'ob-conflict-o800')).toBe(true);
    expect(res.score).toBeLessThan(80);
  });

  it('calculates Low Outlier and High Outlier correctly against WtLOS and OT', () => {
    // Low outlier stay (1 day with WtLOS = 5 days)
    const lowRes = auditClinicalCase({
      an: '10009',
      los: 1,
      pdx: 'I50.0',
      sdx: [],
      proc: [],
      wtlos: 5.2,
      ot: 16,
    });
    expect(lowRes.outlier.status).toBe('same_day');
    expect(lowRes.issues.some((i) => i.id === 'outlier-low')).toBe(true);

    // High outlier stay (20 days with OT = 16 days)
    const highRes = auditClinicalCase({
      an: '10010',
      los: 20,
      pdx: 'I50.0',
      sdx: [],
      proc: [],
      wtlos: 5.2,
      ot: 16,
    });
    expect(highRes.outlier.status).toBe('high_outlier');
    expect(highRes.issues.some((i) => i.id === 'outlier-high')).toBe(true);
  });

  it('calculates multi-payer reimbursement estimates for UCS, OFC, and SSS', () => {
    const res = auditClinicalCase({
      an: '10011',
      los: 4,
      pdx: 'I210',
      sdx: ['I10'],
      proc: ['3606'],
      adjrw: 2.5,
    });

    const ucs = res.reimbursements.find((r) => r.scheme === 'ucs');
    const ofc = res.reimbursements.find((r) => r.scheme === 'ofc');
    const sss = res.reimbursements.find((r) => r.scheme === 'sss');

    expect(ucs?.baselineRevenue).toBe(Math.round(2.5 * 8350));
    expect(ofc?.baselineRevenue).toBe(Math.round(2.5 * 7500));
    expect(sss?.baselineRevenue).toBe(Math.round(2.5 * 12000)); // AdjRW >= 2.0 gets 12,000 baht base rate
  });
});
