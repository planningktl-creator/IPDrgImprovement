import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Activity, ClipboardList, Database, Menu, Sparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { WorklistPage } from '@/pages/WorklistPage';
import { OptimizerPage } from '@/pages/OptimizerPage';
import { useBmsSession } from '@/session/useBmsSession';

function statusLabel(status: ReturnType<typeof useBmsSession>['state']['status']): string {
  if (status === 'connected') return 'HIS เชื่อมต่อแล้ว';
  if (status === 'loading') return 'กำลังเชื่อมต่อ';
  if (status === 'unsupported') return 'Session ไม่รองรับ';
  if (status === 'error') return 'เชื่อมต่อไม่สำเร็จ';
  return 'HIS Offline';
}

function Shell({ children, session }: { children: ReactNode; session: ReturnType<typeof useBmsSession> }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const activeOptimizer = location.pathname.startsWith('/optimizer');
  const hospitalName = session.state.config?.hospitalName || 'โรงพยาบาลกันทรลักษ์';
  const hospitalCode = session.state.config?.hospitalCode || '10929';

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileNavOpen ? 'is-open' : ''}`} aria-label="เมนูหลัก">
        <div className="brand-block">
          <div className="brand-mark">DRG</div>
          <div className="brand-copy">
            <span className="brand-name">IPTImprove</span>
            <span className="brand-meta">CMI workbench · v3</span>
          </div>
          <button className="icon-button sidebar-close" type="button" onClick={() => setMobileNavOpen(false)} aria-label="ปิดเมนู">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-context">
          <span className="eyebrow">โรงพยาบาล</span>
          <strong>{hospitalName}</strong>
          <span>HCODE {hospitalCode}</span>
        </div>

        <nav className="primary-nav">
          <span className="nav-section-label">พื้นที่ทำงาน</span>
          <NavLink className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`} to="/worklist" onClick={() => setMobileNavOpen(false)}>
            <ClipboardList size={18} />
            <span>ทะเบียนเคส</span>
            <span className="nav-kicker">01</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`} to="/optimizer" onClick={() => setMobileNavOpen(false)}>
            <Sparkles size={18} />
            <span>วิเคราะห์ DRG</span>
            <span className="nav-kicker">02</span>
          </NavLink>
        </nav>

        <div className="sidebar-footnote">
          <Activity size={16} />
          <div>
            <strong>Clinical signal rail</strong>
            <span>ตรวจรหัสด้วยหลักฐานก่อนตัดสินใจ</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button className="sidebar-scrim" type="button" aria-label="ปิดเมนู" onClick={() => setMobileNavOpen(false)} />}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu-button" type="button" onClick={() => setMobileNavOpen(true)} aria-label="เปิดเมนู">
              <Menu size={20} />
            </button>
            <div>
              <span className="topbar-kicker">{activeOptimizer ? 'CASE ANALYSIS' : 'INPATIENT REGISTRY'}</span>
              <h1>{activeOptimizer ? 'วิเคราะห์และยืนยัน DRG' : 'ทะเบียนเคสผู้ป่วยใน'}</h1>
            </div>
          </div>
          <div className="topbar-right">
            <div className={`connection-pill status-${session.state.status}`}>
              <Database size={15} />
              <span>{statusLabel(session.state.status)}</span>
            </div>
            {session.state.status === 'connected' && (
              <button className="button button-quiet topbar-disconnect" type="button" onClick={session.disconnect}>
                ตัดการเชื่อมต่อ
              </button>
            )}
          </div>
        </header>

        <main className="app-content">{children}</main>
        <footer className="app-footer">
          <span>ข้อมูลใช้เพื่อการทบทวนโดยผู้มีหน้าที่ให้รหัสเท่านั้น</span>
          <span>ไม่เขียนข้อมูลกลับ HIS · TDRG V6 Grouper</span>
        </footer>
      </div>
    </div>
  );
}

function OptimizerRoute({
  session,
  onBackToWorklist,
  onConnectSession,
  onSessionError,
}: {
  session: ReturnType<typeof useBmsSession>;
  onBackToWorklist: () => void;
  onConnectSession: (sid: string) => Promise<void>;
  onSessionError: () => void;
}) {
  const { an } = useParams<{ an: string }>();

  return (
    <OptimizerPage
      initialAn={an ? decodeURIComponent(an) : undefined}
      externalConfig={session.state.config}
      externalStatus={session.state.status}
      onBackToWorklist={onBackToWorklist}
      onConnectSession={onConnectSession}
      onSessionError={onSessionError}
    />
  );
}

function RoutedApp() {
  const session = useBmsSession();
  const navigate = useNavigate();

  return (
    <Shell session={session}>
      <Routes>
        <Route path="/" element={<Navigate to="/worklist" replace />} />
        <Route
          path="/worklist"
          element={
            <WorklistPage
              onSelectCaseForOptimization={(selectedAn) => navigate(`/optimizer/${encodeURIComponent(selectedAn)}`)}
              connectionConfig={session.state.config}
              sessionStatus={session.state.status}
              onConnectSession={session.connect}
              onSessionError={session.disconnect}
            />
          }
        />
        <Route
          path="/optimizer"
          element={
            <OptimizerPage
              externalConfig={session.state.config}
              externalStatus={session.state.status}
              onBackToWorklist={() => navigate('/worklist')}
              onConnectSession={session.connect}
              onSessionError={session.disconnect}
            />
          }
        />
        <Route
          path="/optimizer/:an"
          element={
            <OptimizerRoute
              session={session}
              onBackToWorklist={() => navigate('/worklist')}
              onConnectSession={session.connect}
              onSessionError={session.disconnect}
            />
          }
        />
        <Route path="*" element={<Navigate to="/worklist" replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  );
}

export default App;
