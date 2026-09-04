/**
 * Clinical Coding Accuracy & DRG Audit Engine
 * Based on Thai DRG V6.3.x rules, TCMC guidelines, and CMI@MOPH training materials
 * (Dr. Wirote Thatchasringkarnsakul, Ratchaburi Hospital)
 */

export interface AuditIssue {
  id: string;
  type: 'error' | 'warning' | 'opportunity' | 'info';
  category: 'pdx' | 'sdx' | 'procedure' | 'obstetric' | 'outlier' | 'demographic';
  title: string;
  description: string;
  suggestedCode?: string;
  suggestedAction?: string;
  impactAdjrw?: number;
}

export interface OutlierAnalysis {
  actlos: number;
  wtlos?: number | null;
  ot?: number | null;
  status: 'normal' | 'low_outlier' | 'high_outlier' | 'same_day';
  description: string;
  paymentAdjustmentNote: string;
}

export interface ReimbursementEstimate {
  scheme: 'ucs' | 'ofc' | 'sss';
  schemeName: string;
  baseRate: number;
  baselineRevenue: number;
  optimizedRevenue?: number;
  deltaRevenue?: number;
}

export interface ClinicalAuditResult {
  score: number; // 0 to 100
  grade: 'A' | 'B' | 'C' | 'D';
  gradeDescription: string;
  issues: AuditIssue[];
  outlier: OutlierAnalysis;
  reimbursements: ReimbursementEstimate[];
  orProcedureDetected: boolean;
  partitionType: 'Surgical' | 'Medical';
}

export interface AuditCaseInput {
  an: string;
  age?: number | null;
  sex?: string | null;
  los: number;
  pdx?: string | null;
  sdx: string[];
  proc: string[];
  rw?: number | null;
  adjrw?: number | null;
  wtlos?: number | null;
  ot?: number | null;
  admwt?: number | null; // admission weight in kg
  dchtype?: string | null;
  pttype?: string | null;
}

// Known Symptom & Sign codes (ICD-10 Chapter XVIII: R00-R99)
const SYMPTOM_CODE_PREFIXES = ['R'];

// Known Unacceptable Inpatient Principal Diagnoses (Screening, routine, convalescence Z-codes)
const UNACCEPTABLE_PDX_PREFIXES = [
  'Z00', 'Z01', 'Z02', 'Z03', 'Z04', 'Z08', 'Z09', 'Z10', 'Z11', 'Z12', 'Z13',
  'Z20', 'Z21', 'Z22', 'Z28', 'Z29', 'Z76',
];

// Common ICD-9-CM Operating Room (OR) procedures driving Surgical DRG Partition (DC 01-49)
const OR_PROCEDURE_PATTERNS = [
  // General surgery, abdomen, thoracic, ortho, neuro, gynae OR procedures
  /^(?:0[1-7]|1[8-9]|2[1-9]|3[0-8]|4[0-9]|5[0-4]|5[5-9]|6[0-9]|7[0-9]|8[0-6])\d{2}$/,
];

// Specific Non-OR procedures (endoscopies, biopsies, diagnostic infusions)
const NON_OR_PROCEDURES = new Set([
  '9914', '9915', '9919', '9921', '9922', '9923', '9925', '9929',
  '8703', '8744', '8872', '8876', '8879', '8891', '8952', '8954',
  '9059', '9069', '9109', '9604', '9670', '9671', '9672',
]);

const cleanCode = (code?: string | null): string =>
  (code || '').trim().toUpperCase().replace(/\./g, '').replace(/[^A-Z0-9]/g, '');

/**
 * Evaluates clinical coding accuracy and DRG audit rules for an inpatient case
 */
export function auditClinicalCase(input: AuditCaseInput): ClinicalAuditResult {
  const issues: AuditIssue[] = [];
  const pdx = cleanCode(input.pdx);
  const sdxList = input.sdx.map(cleanCode).filter(Boolean);
  const procList = input.proc.map(cleanCode).filter(Boolean);
  const age = input.age ?? null;
  const los = input.los > 0 ? input.los : 1;

  // 1. Principal Diagnosis (PDx) Audits
  if (!pdx) {
    issues.push({
      id: 'pdx-missing',
      type: 'error',
      category: 'pdx',
      title: 'ยังไม่ลงรหัสโรคหลัก (Missing Principal Diagnosis)',
      description: 'เคสนี้ไม่มีรหัสโรคหลัก (PDx) จะส่งผลให้ Grouper ประมวลผลเป็น Error Code 1 (Ungroupable DRG 26509)',
      suggestedAction: 'ระบุรหัสโรคหลักตามเหตุผลแท้จริงที่ทำให้ผู้ป่วยต้องเข้ารับการรักษาในโรงพยาบาล',
    });
  } else {
    // 1.1 Check Symptom R-codes as PDx
    if (SYMPTOM_CODE_PREFIXES.some((pref) => pdx.startsWith(pref))) {
      issues.push({
        id: 'pdx-symptom-code',
        type: 'warning',
        category: 'pdx',
        title: 'รหัสโรคหลักเป็นกลุ่มอาการ (Symptom/Sign R-code)',
        description: `รหัส ${pdx} จัดอยู่ในกลุ่มอาการและอาการแสดง (R-codes) หากแพทย์สืบค้นพบสาเหตุแท้จริงแล้ว (เช่น Sepsis, Pneumonia, Heart Failure) ต้องสรุปสาเหตุแท้จริงเป็นโรคหลักตามเกณฑ์ สรท.`,
        suggestedAction: 'ตรวจสอบบันทึกผลแล็บ เอกซเรย์ และ Progress note เพื่อวินิจฉัยโรคที่เป็นสาเหตุหลักแท้จริง',
      });
    }

    // 1.2 Check Unacceptable Inpatient PDx (Z-codes)
    if (UNACCEPTABLE_PDX_PREFIXES.some((pref) => pdx.startsWith(pref))) {
      issues.push({
        id: 'pdx-unacceptable',
        type: 'error',
        category: 'pdx',
        title: 'รหัสโรคหลักไม่เหมาะสำหรับการเป็นผู้ป่วยใน (Unacceptable PDx)',
        description: `รหัส ${pdx} มักเป็นรหัสคัดกรองหรือตรวจสุขภาพทั่วไป จะทำให้ติด Grouper Error Code 3 (DRG 26519 Unacceptable PDx) มีค่า RW = 0`,
        suggestedAction: 'เปลี่ยนรหัสโรคหลักเป็นโรคหรือภาวะผิดปกติที่เป็นสาเหตุในการรับไว้รักษาในโรงพยาบาล',
      });
    }
  }

  // 2. Secondary Diagnosis (SDx) Audits & Duplicates
  const seenSdx = new Set<string>();
  sdxList.forEach((sdx, idx) => {
    if (sdx === pdx) {
      issues.push({
        id: `sdx-dup-pdx-${sdx}`,
        type: 'warning',
        category: 'sdx',
        title: `รหัสโรคร่วมซ้ำกับโรคหลัก (${sdx})`,
        description: `รหัสโรคร่วม SDx ลำดับที่ ${idx + 1} (${sdx}) ซ้ำกับรหัสโรคหลัก PDx จะติด Grouper Warning Code 1`,
        suggestedAction: `ลบรหัส ${sdx} ออกจากโรคร่วม หรือเลือกรหัสภาวะแทรกซ้อนที่มีความจำเพาะอื่น`,
      });
    }

    if (seenSdx.has(sdx)) {
      issues.push({
        id: `sdx-dup-self-${sdx}-${idx}`,
        type: 'warning',
        category: 'sdx',
        title: `รหัสโรคร่วมซ้ำกันเอง (${sdx})`,
        description: `รหัส ${sdx} ถูกบันทึกซ้ำมากกว่า 1 ครั้งในโรคร่วม จะติด Grouper Warning Code 1`,
        suggestedAction: `ตัดรหัสที่ซ้ำซ้อนออก เพื่อให้มีพื้นที่บันทึกโรคร่วมอื่นๆ ได้ครบถ้วน`,
      });
    }
    seenSdx.add(sdx);
  });

  // 3. Clinical Specificity & CC/MCC Opportunities (Based on CMI Lecture & Dr. Wirote)
  const allDx = [pdx, ...sdxList];

  // 3.1 Sepsis Specificity Check
  if (allDx.includes('A419')) {
    issues.push({
      id: 'spec-sepsis',
      type: 'opportunity',
      category: 'sdx',
      title: 'ภาวะติดเชื้อในกระแสเลือดไม่ระบุเชื้อ (A41.9 Sepsis, unspecified)',
      description: 'พบรหัส A41.9 หากผลเพาะเชื้อ (Blood Hemoculture) หรือแล็บระบุเชื้อก่อโรคได้ชัดเจน ควรระบุรหัสจำเพาะ เช่น A41.51 (E. coli), A41.52 (Klebsiella) หรือหากมีความดันโลหิตตกต้องการยากระตุ้นความดัน ให้ตรวจสอบ Septic Shock (R57.2 ซึ่งเป็น MCC)',
      suggestedCode: 'R572',
      suggestedAction: 'ตรวจสอบผล Hemoculture และการใช้ยา Norepinephrine/Inotropes เพื่อลงรหัส Septic Shock หรือเชื้อเฉพาะ',
    });
  }

  // 3.2 Pneumonia Specificity Check
  if (allDx.includes('J189')) {
    issues.push({
      id: 'spec-pneumonia',
      type: 'opportunity',
      category: 'sdx',
      title: 'ปอดอักเสบไม่ระบุเชื้อ (J18.9 Pneumonia, unspecified)',
      description: 'พบรหัส J18.9 แนะนำตรวจสอบผล Sputum Gram stain/Culture หรือกรณีผู้ป่วยสำลัก/มีภาวะกลืนลำบาก ตรวจสอบว่าเป็น Aspiration pneumonia (J69.0) หรือไม่ ซึ่งมีค่าความรุนแรงและ RW สูงกว่า',
      suggestedCode: 'J690',
      suggestedAction: 'ทบทวนประวัติการสำลักและผลเสมหะเพื่อระบุรหัสปอดอักเสบที่จำเพาะเจาะจง',
    });
  }

  // 3.3 Diabetes Mellitus Complications Check
  if (allDx.includes('E119')) {
    issues.push({
      id: 'spec-dm',
      type: 'opportunity',
      category: 'sdx',
      title: 'เบาหวานชนิดที่ 2 ไม่ระบุภาวะแทรกซ้อน (E11.9 DM without complications)',
      description: 'การลง E11.9 เพียงอย่างเดียวทำให้ไม่สะท้อนความซับซ้อนของผู้ป่วย แนะนำตรวจสอบว่ามีไตวายจากเบาหวาน (E11.22 Diabetic nephropathy), แผลเบาหวาน/หลอดเลือดส่วนปลาย (E11.5x), หรือมีภาวะน้ำตาลต่ำ (E11.64 Hypoglycemia) หรือไม่',
      suggestedCode: 'E1122',
      suggestedAction: 'ตรวจสอบค่า eGFR, Microalbuminuria, หรือภาวะแทรกซ้อนของเบาหวานในเวชระเบียน',
    });
  }

  // 3.4 Renal Specificity Check (AKI vs CKD)
  const hasCkd = allDx.some((c) => c.startsWith('N18'));
  const hasAki = allDx.includes('N179') || allDx.some((c) => c.startsWith('N17'));
  if (allDx.includes('N189')) {
    issues.push({
      id: 'spec-ckd-stage',
      type: 'opportunity',
      category: 'sdx',
      title: 'ไตวายเรื้อรังไม่ระบุระยะ (N18.9 CKD, unspecified)',
      description: 'พบรหัส N18.9 แนะนำคำนวณ eGFR เพื่อระบุ Stage ให้ชัดเจน เช่น N18.3 (Stage 3), N18.4 (Stage 4), N18.5 (Stage 5/ESRD) เพื่อความถูกต้องของข้อมูลตามมาตรฐาน สปสช.',
      suggestedAction: 'คำนวณ eGFR จากค่า Serum Creatinine ล่าสุดเพื่อระบุระยะ CKD Stage 1-5',
    });
  }
  if (!hasAki && !hasCkd && allDx.includes('E872')) {
    issues.push({
      id: 'spec-acidosis-aki',
      type: 'opportunity',
      category: 'sdx',
      title: 'พบภาวะ Acidosis (E87.2) โดยไม่มีการลงรหัสโรคไต',
      description: 'ผู้ป่วยมีภาวะ Metabolic Acidosis แนะนำตรวจสอบระดับ Creatinine ว่ามีภาวะไตวายเฉียบพลัน (AKI N17.9) ร่วมด้วยหรือไม่ ซึ่งเป็น CC/MCC ที่สำคัญมาก',
      suggestedCode: 'N179',
      suggestedAction: 'ตรวจสอบผล Creatinine ย้อนหลังเทียบกับ Baseline ว่าเข้าเกณฑ์ AKI หรือไม่',
    });
  }

  // 3.5 Heart Failure Specificity Check
  if (allDx.includes('I509')) {
    issues.push({
      id: 'spec-hf',
      type: 'opportunity',
      category: 'sdx',
      title: 'ภาวะหัวใจล้มเหลวไม่ระบุชนิด (I50.9 Heart failure, unspecified)',
      description: 'หากผู้ป่วยมีอาการน้ำท่วมปอด บวม หรือต้องการยาขับปัสสาวะทางหลอดเลือดดำ ควรตรวจสอบว่าเข้าได้กับ Congestive heart failure (I50.0) หรือ Acute decompensated heart failure หรือไม่',
      suggestedCode: 'I500',
      suggestedAction: 'ตรวจสอบประวัติการตอบสนองต่อ Furosemide IV และผล Echocardiogram/Chest X-ray',
    });
  }

  // 4. Procedure (ICD-9-CM) Audits
  // 4.1 Mechanical Ventilation Check
  const hasIntubation = procList.includes('9604');
  const hasMechVent = procList.some((p) => p.startsWith('967'));
  if (hasIntubation && !hasMechVent) {
    issues.push({
      id: 'proc-missing-vent',
      type: 'warning',
      category: 'procedure',
      title: 'มีการใส่ท่อช่วยหายใจ (96.04) แต่ยังไม่ลงรหัสเครื่องช่วยหายใจ (96.7x)',
      description: 'พบการทำ Endotracheal intubation (96.04) หากผู้ป่วยได้รับการต่อเครื่องช่วยหายใจต่อเนื่อง จะต้องลงรหัส 96.71 (ใช้เครื่อง < 96 ชม.) หรือ 96.72 (ใช้เครื่อง >= 96 ชม.) การขาดรหัสนี้จะทำให้สูญเสียค่า RW และกลุ่ม Pre-MDC Tracheostomy/Ventilator',
      suggestedCode: '9671',
      suggestedAction: 'ตรวจสอบ Respiratory flow sheet เพื่อรวมจำนวนชั่วโมงการใช้เครื่องช่วยหายใจ',
    });
  }

  // 4.2 Detect OR Procedures vs Non-OR
  const orProcs = procList.filter((p) => {
    if (NON_OR_PROCEDURES.has(p)) return false;
    return OR_PROCEDURE_PATTERNS.some((regex) => regex.test(p));
  });
  const orProcedureDetected = orProcs.length > 0;
  const partitionType: 'Surgical' | 'Medical' = orProcedureDetected ? 'Surgical' : 'Medical';

  if (orProcedureDetected) {
    issues.push({
      id: 'proc-or-detected',
      type: 'info',
      category: 'procedure',
      title: `ตรวจพบหัตถการในห้องผ่าตัด (OR Procedure: ${orProcs.join(', ')})`,
      description: `เคสนี้จัดอยู่ในกลุ่ม Surgical DRG (DC 01-49) ซึ่งสะท้อนการผ่าตัดและทรัพยากรห้องผ่าตัด ส่งผลให้น้ำหนักสัมพัทธ์ (RW) สูงกว่ากลุ่มอายุรกรรมอย่างมีนัยสำคัญ`,
    });
  }

  // 5. Obstetric & Neonatal DRG Rules (Dr. Wirote Lecture day 1)
  if (pdx === 'O800' || pdx.startsWith('O80')) {
    // Normal delivery cannot have complication SDx
    const complicationSdx = sdxList.filter((s) => s.startsWith('O') && !s.startsWith('O80'));
    if (complicationSdx.length > 0) {
      issues.push({
        id: 'ob-conflict-o800',
        type: 'error',
        category: 'obstetric',
        title: 'ข้อขัดแย้งทางสูติกรรม: คลอดปกติ (O80.0) ร่วมกับภาวะแทรกซ้อน',
        description: `พบการลง PDx = O80.0 แต่มี SDx โรคแทรกซ้อน (${complicationSdx.join(', ')}) จะส่งผลให้เกิด Grouper Error: DRG 26529 (Unacceptable OB Dx Combination)`,
        suggestedAction: 'เปลี่ยนรหัสโรคหลัก PDx เป็นภาวะแทรกซ้อนนั้น หรือเปลี่ยนเป็นรหัสการคลอดที่มีภาวะแทรกซ้อน (O60-O75)',
      });
    }
  }

  // 5.2 Neonatal Weight Check (< 28 days)
  if (age !== null && age === 0) {
    if (input.admwt !== undefined && input.admwt !== null && input.admwt < 0.3) {
      issues.push({
        id: 'neo-weight-error',
        type: 'error',
        category: 'demographic',
        title: 'น้ำหนักแรกรับในทารกไม่ถูกต้อง (< 0.3 กก.)',
        description: 'ผู้ป่วยทารกแรกเกิดมีน้ำหนักตัวแรกรับน้อยกว่า 0.3 กก. จะทำให้ติด Grouper Error Code 10 (Ungroupable due to admission weight)',
        suggestedAction: 'ระบุน้ำหนักตัวแรกรับจริงในหน่วยกิโลกรัมให้ถูกต้อง',
      });
    }
  }

  // 6. Outlier Analysis (Length of stay vs WtLOS & OT)
  const wtlos = input.wtlos ?? null;
  const ot = input.ot ?? null;
  let outlierStatus: OutlierAnalysis['status'] = 'normal';
  let outlierDesc = 'วันนอนอยู่ในเกณฑ์มาตรฐานปกติ (1/3 WtLOS <= วันนอน <= OT) ค่า AdjRW เท่ากับ RW มาตรฐาน';
  let paymentNote = 'ได้รับเงินชดเชยตามอัตราสัมพัทธ์ปกติ (Normal DRG Weight)';

  if (los <= 1 && wtlos && wtlos > 2) {
    outlierStatus = 'same_day';
    outlierDesc = `จำหน่ายภายในวันแรก หรือวันนอน (${los} วัน) ต่ำกว่า 1 ใน 3 ของเกณฑ์มาตรฐาน (WtLOS = ${wtlos.toFixed(1)} วัน)`;
    paymentNote = 'เข้าเกณฑ์ Low Outlier: ค่า AdjRW จะถูกปรับลดลงตามสัดส่วนวันนอนจริง (คำนวณตามสูตรวันนอนขั้นต่ำ)';
    issues.push({
      id: 'outlier-low',
      type: 'warning',
      category: 'outlier',
      title: 'วันนอนต่ำกว่าเกณฑ์มาตรฐาน (Low Outlier / Same Day)',
      description: outlierDesc,
      suggestedAction: 'ตรวจสอบว่ามีการส่งต่อ (Refer out) หรือจำหน่ายขัดคำสั่งแพทย์ (DAMA) หรือไม่เพื่อลงรหัส Discharge Type ให้ถูกต้อง',
    });
  } else if (wtlos && los < wtlos / 3) {
    outlierStatus = 'low_outlier';
    outlierDesc = `วันนอน (${los} วัน) น้อยกว่า 1 ใน 3 ของค่ามาตรฐานวันนอน (WtLOS = ${wtlos.toFixed(1)} วัน)`;
    paymentNote = 'เข้าเกณฑ์ Low Outlier: ค่า AdjRW จะถูกปรับลดลงต่ำกว่า RW ปกติ';
  } else if (ot && los > ot) {
    outlierStatus = 'high_outlier';
    outlierDesc = `วันนอนจริง (${los} วัน) เกินกว่าจุดตัดวันนอนเกินเกณฑ์ (OT = ${ot} วัน)`;
    paymentNote = `เข้าเกณฑ์ High Outlier: โรงพยาบาลจะได้รับเงินชดเชยวันนอนส่วนเกิน (${los - ot} วัน) เพิ่มเติมตามสูตรจุดตัด OT`;
    issues.push({
      id: 'outlier-high',
      type: 'info',
      category: 'outlier',
      title: 'วันนอนเกินเกณฑ์จุดตัด (High Outlier Trim Point)',
      description: outlierDesc,
      suggestedAction: 'ตรวจสอบเวชระเบียนเพื่อให้มั่นใจว่าบันทึกอาการแทรกซ้อนและการรักษาครอบคลุมวันนอนที่ยาวนานครบถ้วน',
    });
  }

  const outlier: OutlierAnalysis = {
    actlos: los,
    wtlos,
    ot,
    status: outlierStatus,
    description: outlierDesc,
    paymentAdjustmentNote: paymentNote,
  };

  // 7. Base Rate & Reimbursement Estimation
  const activeAdjrw = input.adjrw ?? input.rw ?? 0;
  const reimbursements: ReimbursementEstimate[] = [
    {
      scheme: 'ucs',
      schemeName: 'หลักประกันสุขภาพถ้วนหน้า (UCS บัตรทอง)',
      baseRate: 8350, // อัตราฐานเฉลี่ยในเขต รพ.กันทรลักษ์
      baselineRevenue: Math.round(activeAdjrw * 8350),
    },
    {
      scheme: 'ofc',
      schemeName: 'สวัสดิการข้าราชการ (OFC กรมบัญชีกลาง)',
      baseRate: 7500, // อัตราฐานเฉลี่ย 6,500 - 9,000 บาท
      baselineRevenue: Math.round(activeAdjrw * 7500),
    },
    {
      scheme: 'sss',
      schemeName: 'ประกันสังคม (SSS)',
      baseRate: activeAdjrw >= 2.0 ? 12000 : 11000, // เกณฑ์ AdjRW >= 2.0 ได้ 12,000 บาททุกกรณีตามสไลด์
      baselineRevenue: Math.round(activeAdjrw * (activeAdjrw >= 2.0 ? 12000 : 11000)),
    },
  ];

  // 8. Quality Score Calculation (0 - 100)
  let score = 100;
  const errorCount = issues.filter((i) => i.type === 'error').length;
  const warningCount = issues.filter((i) => i.type === 'warning').length;
  const oppCount = issues.filter((i) => i.type === 'opportunity').length;

  if (!pdx) {
    score -= 50; // Missing PDx is an automatic severe failure
  } else {
    score -= errorCount * 30; // other errors are critical
  }
  score -= warningCount * 12; // warnings affect data quality
  score -= Math.min(oppCount * 5, 20); // opportunities indicate lack of specificity

  if (score < 0) score = 0;

  let grade: ClinicalAuditResult['grade'] = 'A';
  let gradeDescription = 'คุณภาพการให้รหัสโรคยอดเยี่ยม ถูกต้องตามเกณฑ์ สรท. และสะท้อนความรุนแรงครบถ้วน';
  if (score < 60) {
    grade = 'D';
    gradeDescription = 'พบข้อผิดพลาดร้ายแรงที่ทำให้ Grouper ไม่สามารถจัดกลุ่มได้ (Ungroupable หรือ Unacceptable PDx)';
  } else if (score < 75) {
    grade = 'C';
    gradeDescription = 'มีข้อควรระวังหรือรหัสซ้ำซ้อนที่ควรปรับปรุงก่อนส่งข้อมูล CMI@MOPH';
  } else if (score < 90) {
    grade = 'B';
    gradeDescription = 'มีความถูกต้องพื้นฐานดี แต่อาจยังมีโอกาสระบุรหัสโรคร่วม/ภาวะแทรกซ้อน (CC/MCC) ให้จำเพาะยิ่งขึ้น';
  }

  return {
    score,
    grade,
    gradeDescription,
    issues,
    outlier,
    reimbursements,
    orProcedureDetected,
    partitionType,
  };
}
