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
  const [selectedAn, setSelectedAn] = useState<string>('');

  // Shared BMS Session state
  const [bmsSessionId, setBmsSessionId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('bms-session-id')?.trim() || '';
    }
    return '';
  });
  const [connectionConfig, setConnectionConfig] = useState<BmsConnectionConfig | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'connected' | 'demo' | 'error'>('idle');

  const handleConnectSession = async (sid: string) => {
    const trimmed = sid.trim();
    if (!trimmed) {
      setConnectionConfig(null);
      setSessionStatus('idle');
      return;
    }

    try {
      const raw = await retrieveBmsSession(trimmed);
      const conf = extractConnectionConfig(raw);
      setConnectionConfig(conf);
      setBmsSessionId(trimmed);
      setSessionStatus('connected');
    } catch {
      setSessionStatus('error');
      throw new Error('ไม่สามารถดึงการเชื่อมต่อจาก BMS Session ได้');
    }
  };

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
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a' }}>
      {/* Top Modern Application Bar */}
      <header className="app-header">
        <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
            {/* Hospital Branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                color: '#ffffff',
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: '900',
                fontSize: '15px',
                letterSpacing: '-0.02em',
                boxShadow: '0 4px 10px rgba(37, 99, 235, 0.3)',
              }}>
                DRG
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: '800', fontSize: '17px', color: '#0f172a', letterSpacing: '-0.02em' }}>
                    IPDrgImprovement
                  </span>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: '700',
                    backgroundColor: '#dbeafe',
                    color: '#1e40af',
                    padding: '2px 6px',
                    borderRadius: '6px',
                  }}>
                    v2.0 PRO
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>รพ.กันทรลักษ์ (HCODE: 10929)</span>
                </div>
              </div>
            </div>

            {/* Segmented Navigation Control */}
            <nav style={{
              display: 'flex',
              backgroundColor: '#f1f5f9',
              padding: '3px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              gap: '2px',
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('worklist')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '7px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: activeTab === 'worklist' ? '700' : '500',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: activeTab === 'worklist' ? '#ffffff' : 'transparent',
                  color: activeTab === 'worklist' ? '#1d4ed8' : '#64748b',
                  boxShadow: activeTab === 'worklist' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <ClipboardList size={16} color={activeTab === 'worklist' ? '#2563eb' : '#64748b'} />
                ทะเบียนเคสผู้ป่วยใน (Worklist)
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('optimizer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '7px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: activeTab === 'optimizer' ? '700' : '500',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: activeTab === 'optimizer' ? '#ffffff' : 'transparent',
                  color: activeTab === 'optimizer' ? '#1d4ed8' : '#64748b',
                  boxShadow: activeTab === 'optimizer' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Sparkles size={16} color={activeTab === 'optimizer' ? '#2563eb' : '#64748b'} />
                วิเคราะห์ DRG รายเคส (Optimizer)
              </button>
            </nav>
          </div>

          {/* Right Status Cluster */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Base Rate Pill */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '5px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '500',
              color: '#475569',
            }}>
              <span style={{ color: '#64748b' }}>Base Rate:</span>
              <strong style={{ color: '#0f172a' }}>8,350 ฿/AdjRW</strong>
            </div>

            {/* BMS Status Badge */}
            <div style={{
              padding: '5px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: sessionStatus === 'connected' ? '#ecfdf5' : '#f8fafc',
              color: sessionStatus === 'connected' ? '#047857' : '#64748b',
              border: sessionStatus === 'connected' ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: sessionStatus === 'connected' ? '#10b981' : '#94a3b8',
                display: 'inline-block',
              }} />
              <Database size={13} />
              {sessionStatus === 'connected' ? 'HIS เชื่อมต่อแล้ว' : 'HIS ยังไม่ได้เชื่อมต่อ'}
            </div>
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
            onConnectSession={handleConnectSession}
          />
        ) : (
          <OptimizerPage
            initialAn={selectedAn}
            onBackToWorklist={() => setActiveTab('worklist')}
            externalSessionId={bmsSessionId}
            externalConfig={connectionConfig}
            externalStatus={sessionStatus}
            onConnectSession={handleConnectSession}
          />
        )}
      </main>
    </div>
  );
};

export default App;
