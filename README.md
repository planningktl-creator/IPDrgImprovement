# DRG Optimizer

แอปพลิเคชันวิเคราะห์ข้อมูลเคสผู้ป่วยใน (Inpatient Cases) จากระบบโรงพยาบาล (ผ่าน BMS Session API แบบเดียวกับ CMI-Dashboard) และคำนวณเปรียบเทียบกลุ่มวินิจฉัยโรคร่วม (DRG) ผ่าน Grouper ทางการของกระทรวงสาธารณสุข (`had-api.moph.go.th` แบบเดียวกับ DRGSeeker) เพื่อแนะนำรหัสวินิจฉัยหลัก (PDx), วินิจฉัยร่วม (SDx) หรือหัตถการ ที่มีหลักฐานการใช้ยาและเวชภัณฑ์รองรับในเวชระเบียน ซึ่งทำให้ค่า DRG และ AdjRW สะท้อนการรักษาจริงได้ดียิ่งขึ้น

---

## 🌟 คุณสมบัติเด่น (Features)

1. **ดึงข้อมูลเคสและรายการยาตรงจาก HIS**:
   - เชื่อมต่อ BMS Session API แบบ Read-Only (`SELECT / WITH` เท่านั้น มีระบบป้องกันคำสั่ง INSERT/UPDATE/DELETE เด็ดขาด)
   - ดึงข้อมูล CaseDetail (วินิจฉัยเดิม, วันนอน, สถานะจำหน่าย) และ itemized Usage/opitemrece
2. **สกัดรหัสโรคที่มีหลักฐานเชิงประจักษ์ (Evidence Extraction)**:
   - ตรวจหา ICD-10 จากเหตุผลการสั่งยา (`presc_reason`, `presc_reason_2..5`) เช่น ยาควบคุมเฉพาะ, ยาปฏิชีวนะกลุ่มพิเศษ
   - ตรวจหา ICD-10 จากเหตุผลความจำเป็นในการสั่งยา (`need_order_reason`)
   - บันทึกการอ้างอิงหลักฐานคู่กับ `hos_guid` และชื่อรายการยา
3. **คำนวณผ่าน Official MOPH DRG Grouper (Version 6)**:
   - Port 1:1 Contract จาก DRGSeeker (TGrp6305 v6.3.5)
   - Zero CORS Proxy: ยิงตรงไปยัง `https://had-api.moph.go.th/cmi/drg/calculate` รักษาความปลอดภัยของข้อมูลเคส
4. **จัดอันดับข้อเสนอแนะตาม ΔAdjRW**:
   - ประเมินผลกระทบกรณีเพิ่มโรคร่วม (Add SDx) หรือสลับรหัสขึ้นเป็นวินิจฉัยหลัก (Swap PDx)
   - แสดงส่วนต่างค่าน้ำหนักสัมพัทธ์ (ΔAdjRW) และประมาณการรายได้ที่เพิ่มขึ้นตาม Base Rate
   - ลิงก์ตรงไปยังคลังคำอธิบายรหัสโรค (`/libs/icd10/{code}`) และรหัส DRG (`/libs/drg-name/{drg}`)
5. **ความปลอดภัยทางการแพทย์ (Clinical Governance)**:
   - ป้ายเตือน Coder Review ทุกหน้าจอ
   - ไม่เขียนทับฐานข้อมูลเดิม ผู้ตรวจสอบรหัสโรค (Coder) เป็นผู้ตัดสินใจสุดท้ายเสมอ

---

## 🚀 การติดตั้งและรันระบบ (Quick Start)

### ข้อกำหนดระบบ (Prerequisites)
- Node.js version 20+ หรือ 22+ (ทดสอบแล้วบน Node v25)
- npm version 10+

### คำสั่งติดตั้งและเริ่มใช้งาน
```bash
# ติดตั้ง dependencies
npm install

# รัน Development Server
npm run dev -- --port 5174

# เปิดบราวเซอร์ที่:
# http://localhost:5174/
```

### การเปิดใช้งานด้วย BMS Session ID
สามารถส่ง Session ID ผ่าน URL ได้โดยตรง:
```
http://localhost:5174/?bms-session-id=YOUR_SESSION_ID
```
ระบบจะดึงการตั้งค่าโรงพยาบาลจาก `https://hosxp.net/phapi/PasteJSON` อัตโนมัติ และล้าง Session ID ออกจาก URL เพื่อความปลอดภัย

---

## 🧪 การทดสอบระบบ (Testing & Quality Assurance)

โปรเจ็กต์พัฒนาด้วยแนวทาง Test-Driven Development (TDD) ครอบคลุม Unit Tests, Integration Contracts, Typecheck, และ Component Tests:

```bash
# 1. รันการทดสอบ Vitest ทั้งหมด (Unit & Component Tests)
npm test

# 2. ตรวจสอบ TypeScript Type Safety
npx tsc --noEmit

# 3. ตรวจสอบ ESLint Code Quality
npm run lint

# 4. ทดสอบสร้าง Production Bundle
npm run build
```

---

## 📁 โครงสร้างโปรเจ็กต์ (Architecture)

```
drg-optimizer/
├── src/
│   ├── cmi/                      # CMI Data Layer
│   │   ├── caseAdapter.ts        # แปลง CaseDetail เป็น DrgCaseInput
│   │   └── caseContract.ts       # Domain types จาก CMI-Dashboard
│   ├── drg/                      # MOPH Grouper Layer
│   │   ├── grouperClient.ts      # Client ยิงตรง MoPH (Zero Proxy)
│   │   └── grouperContract.ts    # Contract ค่าคงที่ API v6, HCode 10929
│   ├── suggest/                  # Suggestion Engine
│   │   ├── candidateExtractor.ts # สกัดรหัส ICD-10 จากเหตุผลการสั่งยา
│   │   └── suggestEngine.ts      # วน Permutations และจัดอันดับ ΔAdjRW
│   ├── services/                 # BMS Session Services
│   │   └── cmiApi.ts             # Read-only SQL executor & demo fixtures
│   ├── pages/
│   │   └── OptimizerPage.tsx     # หน้าจอหลักแสดงผลเคสและข้อเสนอแนะ
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   ├── unit/                     # Unit tests (Contracts, Client, Adapter, Engine)
│   └── component/                # Component tests (UI, Search, Table)
└── docs/
    ├── CODER-GUIDE.md            # คู่มือการอ่านผลสำหรับ Coder
    └── THAI-IP-NOTE.md           # ข้อกำหนด IP ไทยสำหรับ Grouper API
```

---

## 🔒 มาตรการความปลอดภัย (Security & Compliance)

1. **Zero Public Proxy**: ข้อมูลเคสใน `POST /drg/calculate` ไม่ผ่านพร็อกซีภายนอกเด็ดขาด
2. **Read-Only Enforcement**: ฟังก์ชัน `assertCmiQueryIsReadOnly` ตรวจจับและปฏิเสธคำสั่ง SQL ที่มีเจตนาแก้ไขข้อมูล
3. **No PII Storage**: ไม่เก็บชื่อและข้อมูลระบุตัวตนผู้ป่วยลงใน LocalStorage หรือ SessionStorage
4. **Masked Patient Identity**: ชื่อผู้ป่วยแสดงผลในรูปแบบ Masked เสมอ
