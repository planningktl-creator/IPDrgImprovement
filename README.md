# IPTImprove

IPTImprove เป็น Coder workbench สำหรับทะเบียนผู้ป่วยในและการทบทวน DRG โดยอ่านข้อมูลจาก HOSxP/BMS แบบ read-only, ส่งเคสไปยัง MOPH Grouper โดยตรง และแสดงข้อเสนอแนะให้ Coder ตรวจสอบเอง ระบบไม่เขียนข้อมูลกลับ HIS และไม่แสดง mock result อัตโนมัติเมื่อ session หรือ API ใช้งานไม่ได้

## ขอบเขตการทำงาน

- `/worklist` — worklist แบบ server-side filter, count และ keyset pagination (เริ่ม 50 สูงสุด 100 รายการต่อหน้า)
- `/optimizer/:an` — Case Detail, Usage evidence, candidate Grouper, Clinical Audit และ retry/cancel
- `/` — redirect ไป `/worklist`
- Query ใช้ allow-list registry เท่านั้น (`casePage`, `caseCount`, `worklistSummary`, `caseDetail`, `usagePage`, `caseExport`)
- SQL boundary mask HN และชื่อผู้ป่วยก่อนส่งข้อมูลเข้า browser; AN แสดงเต็ม
- Worklist รองรับ SDx 12 และ Procedure 12; Case Detail/Grouper รองรับ Procedure 30
- Reimbursement rate อ่านจาก `VITE_REIMBURSEMENT_RATES_JSON`; ถ้าไม่ตั้งค่าจะแสดง “ยังไม่ได้ตั้งค่า rate” ใน runtime
- Export CSV/XLSX ถูกจำกัดที่ 10,000 รายการ และตรวจด้วย `check:static`/CI

## รันในเครื่อง

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5174
```

เปิด `http://127.0.0.1:5174/` แล้วใส่ BMS Session ID หรือเปิดด้วย `?bms-session-id=...` ได้ ระบบจะดึง payload แบบ reference ของ CMI-Dashboard (`result.user_info.bms_url`, `bms_session_code`, `bms_database_type`) และล้าง session ออกจาก URL หลัง handshake

รองรับ PostgreSQL เท่านั้นใน data path นี้; MySQL/รูปแบบที่ไม่มี API URL จะถูกแสดงเป็น unsupported

ตัวอย่าง runtime rate configuration:

```text
VITE_REIMBURSEMENT_RATES_JSON=[{"scheme":"ucs","label":"UCS","baseRate":8350,"effectiveFrom":"2026-01-01","effectiveTo":"2026-09-30","matchTokens":["ucs","บัตรทอง"]}]
```

ก่อนนำค่าไปใช้ควรเรียก `validatePayerRateConfig()` เพื่อตรวจ rate ซ้ำและช่วงเวลาทับซ้อน

## ทดสอบและ build

```bash
npm run lint
npm test -- --run
npm run build
npm run check:static
```

Browser smoke/visual QA ใช้ Playwright กับข้อมูลจำลองที่ mask แล้วใน `scripts/browser-smoke.py` โดยเปิด `vite preview` ก่อน แล้วรัน `npm run test:browser` ในอีก terminal หนึ่ง ระบบตรวจ `/`, `/worklist`, `/optimizer/:an`, viewport 1440/1024/768/375/320, horizontal overflow, console/page errors, debounce และ deep link; CI ติดตั้ง Chromium แล้วรัน smoke หลัง `vite preview`

## Docker + Nginx

Image เป็น multi-stage build และรัน Nginx ด้วย user `nginx` ที่ port container `8080`; compose map เป็น `3081:8080` เพื่อไม่ชนกับ CMI-Dashboard:

```bash
docker compose build --build-arg BMS_ALLOWED_ORIGINS="https://hosxp.net https://had-api.moph.go.th http://192.168.1.100:45011"
docker compose up -d
```

`BMS_ALLOWED_ORIGINS` เป็น space-separated `http(s)` origins ที่จะถูกฝังใน CSP ตอน build ต้องใส่ origin ของ BMS staging/production และ MOPH Grouper ที่ใช้งานจริงเอง ไม่ควรใช้ public CORS proxy

Deployment artifacts:

- `Dockerfile`
- `docker-compose.yaml`
- `nginx.conf.template`
- `nginx.conf` (default reviewable configuration)
- `.dockerignore`
- `.github/workflows/web-ci.yml`

Nginx มี SPA fallback, immutable cache สำหรับ `/assets/`, no-cache สำหรับ `index.html`, security headers, CSP และ healthcheck

## Session และ privacy

Session layer อยู่ที่ `src/session/useBmsSession.ts` จุดเดียว ใช้ memory state และ secure SameSite cookie เมื่อ deploy ผ่าน HTTPS; ไม่เก็บ raw query result, ชื่อ หรือ HN ใน localStorage/sessionStorage และไม่ log case/usage/identity

MOPH Grouper ยิงตรงไป `https://had-api.moph.go.th/cmi/drg/calculate` พร้อม timeout และตรวจสอบ HTTP/JSON/status/data/DRG ก่อนใช้งาน ผลที่ล้มเหลวจะเป็น error/retry หรือรายงานระดับ candidate ไม่ถูกแทนด้วยคำแนะนำปลอม

## โครงสร้างหลัก

```text
src/
├── audit/clinicalAuditEngine.ts       # Clinical rules, WtLOS/OT และ reimbursement
├── cmi/caseContract.ts                # Case/page/cursor/query contracts
├── cmi/caseAdapter.ts                 # strict mapping ไป Grouper
├── config/reimbursementRates.ts       # runtime payer/effective-date rates
├── drg/grouperClient.ts               # direct MOPH client + validation/timeout
├── pages/WorklistPage.tsx             # responsive table/card worklist
├── pages/OptimizerPage.tsx            # evidence-first optimizer workbench
├── services/cmiApi.ts                 # BMS session, query registry, masking, export
├── session/useBmsSession.ts           # central session lifecycle
├── suggest/suggestEngine.ts            # sequential candidate/progress/cancel
└── styles/design-system.css           # clinical operations console tokens/layout
```

ระบบนี้ใช้ `CMI-Dashboard` และ `DRGSeekerAPI/DRG` เป็น reference architecture เท่านั้น และไม่แก้ไขไฟล์ในสอง repository ดังกล่าว
