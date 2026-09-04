import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  extractConnectionConfig,
  getStoredBmsSessionId,
  persistBmsSessionId,
  removeStoredBmsSessionId,
  retrieveBmsSession,
  type BmsConnectionConfig,
} from '@/services/cmiApi';

export type SessionStatus = 'idle' | 'loading' | 'connected' | 'demo' | 'unsupported' | 'error';

export interface SessionState {
  sessionId: string;
  config: BmsConnectionConfig | null;
  status: SessionStatus;
  error: string | null;
}

type SessionAction =
  | { type: 'loading'; sessionId: string }
  | { type: 'connected'; sessionId: string; config: BmsConnectionConfig }
  | { type: 'error'; message: string }
  | { type: 'clear' };

const initialState: SessionState = {
  sessionId: '',
  config: null,
  status: 'idle',
  error: null,
};

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'loading':
      return { ...state, sessionId: action.sessionId, status: 'loading', error: null };
    case 'connected':
      return {
        sessionId: action.sessionId,
        config: action.config,
        status: action.config.databaseSupportStatus === 'supported' ? 'connected' : 'unsupported',
        error: action.config.databaseSupportStatus === 'supported' ? null : 'BMS Session นี้ไม่ใช่ PostgreSQL หรือไม่มี API URL หรือ Hospital Code ที่รองรับ',
      };
    case 'error':
      return { ...state, config: null, status: 'error', error: action.message };
    case 'clear':
      return initialState;
    default:
      return state;
  }
}

function friendlySessionError(error: unknown): string {
  if ((error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) return 'การเชื่อมต่อถูกยกเลิกหรือหมดเวลา';
  if (error instanceof Error && !/https?:\/\/|SELECT|WITH|patient|ipt|hn|an/i.test(error.message)) return error.message;
  return 'ไม่สามารถเชื่อมต่อ BMS Session ได้';
}

function clearSessionFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('bms-session-id') && !url.searchParams.has('sessionId')) return;
  url.searchParams.delete('bms-session-id');
  url.searchParams.delete('sessionId');
  window.history.replaceState(window.history.state, '', url.toString());
}

export function useBmsSession(): {
  state: SessionState;
  connect: (sessionId: string) => Promise<void>;
  disconnect: () => void;
} {
  const [firstSessionId] = useState(getStoredBmsSessionId);
  const [state, dispatch] = useReducer(reducer, { ...initialState, sessionId: firstSessionId });

  const connect = useCallback(async (sessionId: string) => {
    const clean = sessionId.trim();
    if (!clean) {
      removeStoredBmsSessionId();
      dispatch({ type: 'clear' });
      return;
    }

    dispatch({ type: 'loading', sessionId: clean });
    try {
      const raw = await retrieveBmsSession(clean);
      const config = extractConnectionConfig(raw);
      persistBmsSessionId(clean);
      clearSessionFromUrl();
      dispatch({ type: 'connected', sessionId: clean, config });
    } catch (error) {
      removeStoredBmsSessionId();
      const safeMessage = friendlySessionError(error);
      dispatch({ type: 'error', message: safeMessage });
      throw new Error(safeMessage, { cause: error });
    }
  }, []);

  useEffect(() => {
    if (!firstSessionId) return undefined;
    const controller = new AbortController();
    retrieveBmsSession(firstSessionId, controller.signal)
      .then((raw) => {
        const config = extractConnectionConfig(raw);
        persistBmsSessionId(firstSessionId);
        clearSessionFromUrl();
        dispatch({ type: 'connected', sessionId: firstSessionId, config });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          clearSessionFromUrl();
          removeStoredBmsSessionId();
          dispatch({ type: 'error', message: friendlySessionError(error) });
        }
      });
    return () => controller.abort();
  }, [firstSessionId]);

  const disconnect = useCallback(() => {
    removeStoredBmsSessionId();
    dispatch({ type: 'clear' });
  }, []);

  return { state, connect, disconnect };
}
