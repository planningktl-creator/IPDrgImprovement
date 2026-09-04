import React, { useState, useEffect } from 'react';
import { WorklistPage } from './pages/WorklistPage';
import { OptimizerPage } from './pages/OptimizerPage';
import {
  retrieveBmsSession,
  extractConnectionConfig,
  type BmsConnectionConfig,
} from './services/cmiApi';
import { ClipboardList, Sparkles, Database } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'worklist' | 'optimizer'>('worklist');
  const [selectedAn, setSelectedAn] = useState<string>('1001');

  // Shared BMS Session state
  const [bmsSessionId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('bms-session-id')?.trim() || '';
    }
    return '';
  });
  const [connectionConfig, setConnectionConfig] = useState<BmsConnectionConfig | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'connected' | 'demo' | 'error'>('demo');

  useEffect(() => {
    let ignore = false;
    if (bmsSessionId) {
      retrieveBmsSession(bmsSessionId)
        .then((raw) => {
          if (!ignore) {
            const conf = extractConnectionConfig(raw);
            setConnectionConfig(conf);
            setSessionStatus('connected');
          }
        })
        .catch(() => {
          if (!ignore) {
            setSessionStatus('error');
          }
        });

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('bms-session-id');
      window.history.replaceState(window.history.state, '', cleanUrl.toString());
    }

    return () => {
      ignore = true;
    };
  }, [bmsSessionId]);

  const handleSelectCaseForOptimization = (an: string) => {
    setSelectedAn(an);
    setActiveTab('optimizer');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Application Bar */}
      <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 30 }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: '800',
                fontSize: '16px',
              }}>
                DRG
              </div>
              <div>
                <span style={{ fontWeight: '800', fontSize: '16px', color: '#0f172a' }}>IPDrgImprovement</span>
                <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px' }}>รพ.กันทรลักษ์ (10929)</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('worklist')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: activeTab === 'worklist' ? '#eff6ff' : 'transparent',
                  color: activeTab === 'worklist' ? '#1d4ed8' : '#64748b',
                }}
              >
                <ClipboardList size={16} />
                ทะเบียนเคสผู้ป่วยใน (Worklist)
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('optimizer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: activeTab === 'optimizer' ? '#eff6ff' : 'transparent',
                  color: activeTab === 'optimizer' ? '#1d4ed8' : '#64748b',
                }}
              >
                <Sparkles size={16} />
                วิเคราะห์ DRG รายเคส (Optimizer)
              </button>
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              padding: '4px 10px',
              borderRadius: '16px',
              fontSize: '12px',
              fontWeight: '500',
              backgroundColor: sessionStatus === 'connected' ? '#dcfce7' : '#e0f2fe',
              color: sessionStatus === 'connected' ? '#166534' : '#0369a1',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <Database size={13} />
              {sessionStatus === 'connected' ? 'BMS เชื่อมต่อแล้ว' : 'โหมดจำลอง (Demo Mode)'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main>
        {activeTab === 'worklist' ? (
          <WorklistPage
            onSelectCaseForOptimization={handleSelectCaseForOptimization}
            connectionConfig={connectionConfig}
            sessionStatus={sessionStatus}
          />
        ) : (
          <OptimizerPage
            initialAn={selectedAn}
            onBackToWorklist={() => setActiveTab('worklist')}
            externalSessionId={bmsSessionId}
            externalConfig={connectionConfig}
            externalStatus={sessionStatus}
          />
        )}
      </main>
    </div>
  );
};

export default App;
