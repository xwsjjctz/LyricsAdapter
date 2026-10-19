import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OnlineSource } from '@/services/settingsManager';
import { qqCredentialManager } from '@/services/qqCredentialManager';
import { cookieStoreFor, sourceLogin, syncOnlineCookiesToMain, type MusicSourceLogin } from '@/services/musicSources';
import { logger } from '@/services/logger';
import { useSettingsMessage, type SettingsMessageState } from './useSettingsMessage';
import {
  startQQLogin,
  pollQQLogin,
  startNetEaseQR,
  pollNetEaseQR,
  type QRLoginStatus,
  type QRPollResult,
} from '@/services/qrLogin';

// Owns one music source's sign-in: its cookie and, for sources that support it, QR login.

export type QrState = 'idle' | 'loading' | QRLoginStatus;

export interface SourceLogin {
  login: MusicSourceLogin;
  qrSupported: boolean;
  /** Cookie draft for the source. */
  cookie: string;
  /** The draft differs from the stored cookie. */
  cookieDirty: boolean;
  signedIn: boolean;
  qrState: QrState;
  qrImage: string | null;
  qrMsg: string;
  qrScanning: boolean;
  isSaving: boolean;
  /** The last sign-in or cookie result; errors stay until the next attempt. */
  message: SettingsMessageState | null;
  setCookie: (value: string) => void;
  /** Validates and stores the cookie draft. */
  saveCookie: () => Promise<void>;
  startQr: () => Promise<void>;
  logout: () => Promise<void>;
}

const QR_POLL_INTERVAL_MS = 2000;

export const supportsQr = (login: MusicSourceLogin): login is 'qq-qr' | 'netease-qr' => login === 'qq-qr' || login === 'netease-qr';

const QR_FLOWS = {
  'qq-qr': { start: startQQLogin, poll: pollQQLogin },
  'netease-qr': { start: startNetEaseQR, poll: pollNetEaseQR },
} as const;

/** Whether the source has a stored cookie; follows silent refreshes and other windows. */
export function useSourceSignedIn(source: OnlineSource): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const store = cookieStoreFor(source);
    let active = true;
    const read = () => { if (active) setSignedIn(store.hasCookie()); };
    void store.ensureLoaded().then(read);
    const unsubscribe = store.subscribe(read);
    return () => { active = false; unsubscribe(); };
  }, [source]);
  return signedIn;
}

/**
 * Sign-in state for one source while its settings are open. QR login starts on its own
 * when the source supports it and has no cookie; polling stops when the settings close.
 * Each source's cookie lives in its own store (musicSources.cookieStoreFor).
 */
export function useSourceLogin(source: OnlineSource): SourceLogin {
  const { t } = useTranslation();
  const login = sourceLogin(source);
  const qrSupported = supportsQr(login);
  const [cookie, setCookie] = useState('');
  const [savedCookie, setSavedCookie] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [qrState, setQrState] = useState<QrState>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrMsg, setQrMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { message, show: showMessage, clear: clearMessage } = useSettingsMessage();
  const sessionRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Follow the cookie store. A silent QQ musickey refresh rewrites the cookie, so the
  // draft must stay in step or Save would write the stale value back.
  useEffect(() => {
    const store = cookieStoreFor(source);
    let active = true;
    const read = () => {
      if (!active) return;
      setCookie(store.getCookie());
      setSavedCookie(store.getCookie());
      setSignedIn(store.hasCookie());
    };
    void store.ensureLoaded().then(read);
    const unsubscribe = store.subscribe(read);
    return () => { active = false; unsubscribe(); };
  }, [source]);

  const stopQrPolling = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const handleQrPollResult = useCallback(async (result: QRPollResult) => {
    setQrState(result.status);
    if (result.status === 'confirming') setQrMsg(t('settingsDialog.qrConfirming'));
    else if (result.status === 'waiting') setQrMsg(result.msg || t('settingsDialog.qrWaiting'));
    else if (result.msg) setQrMsg(result.msg);

    if (result.status === 'done') {
      stopQrPolling();
      setQrImage(null);
      if (result.cookie) {
        if (login === 'qq-qr') {
          if (result.credential) await qqCredentialManager.setCredential(result.credential);
          else await qqCredentialManager.clearCredential();
        }
        await cookieStoreFor(source).setCookie(result.cookie);
        void syncOnlineCookiesToMain(source);
        showMessage(t('settingsDialog.qrLoggedIn'), 'success');
      }
    } else if (result.status === 'expired') {
      stopQrPolling();
      setQrImage(null);
    }
    // 'waiting' | 'confirming' | 'error' → keep polling (error is treated as soft)
  }, [login, showMessage, source, stopQrPolling, t]);

  const startQr = useCallback(async () => {
    stopQrPolling();
    sessionRef.current = null;
    setQrImage(null);
    setQrMsg('');
    if (!supportsQr(login)) { setQrState('idle'); return; }
    const flow = QR_FLOWS[login];
    setQrState('loading');
    try {
      const started = await flow.start();
      if (!mountedRef.current) return;
      const key = started.sessionKey;
      sessionRef.current = key;
      setQrImage(started.qrcode);
      setQrState('waiting');
      setQrMsg(t('settingsDialog.qrWaiting'));
      pollTimerRef.current = setInterval(() => {
        void (async () => {
          if (!mountedRef.current || sessionRef.current !== key) return; // superseded by a newer session
          try {
            const result = await flow.poll(key);
            if (mountedRef.current && sessionRef.current === key) await handleQrPollResult(result);
          } catch (error) {
            if (!mountedRef.current) return;
            logger.error('[SettingsPanel] QR poll failed:', error);
            setQrMsg((error as Error).message || t('settingsDialog.qrError'));
            setQrState('error');
          }
        })();
      }, QR_POLL_INTERVAL_MS);
    } catch (error) {
      if (!mountedRef.current) return;
      logger.error('[SettingsPanel] startQr failed:', error);
      setQrMsg((error as Error).message || t('settingsDialog.qrError'));
      setQrState('error');
    }
  }, [handleQrPollResult, login, stopQrPolling, t]);

  const logout = useCallback(async () => {
    if (login === 'qq-qr') await qqCredentialManager.clearCredential();
    await cookieStoreFor(source).clearCookie();
    await startQr();
  }, [login, source, startQr]);

  // Tear down polling and timers when the settings close.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopQrPolling();
      sessionRef.current = null;
    };
  }, [stopQrPolling]);

  // Offer the QR code straight away when the source is not signed in yet.
  useEffect(() => {
    if (!qrSupported) return;
    const store = cookieStoreFor(source);
    let cancelled = false;
    void store.ensureLoaded().then(() => {
      if (!cancelled && !store.hasCookie()) void startQr();
    });
    return () => { cancelled = true; };
    // Only when the source opens; startQr changes with the translation function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, qrSupported]);

  const saveCookie = useCallback(async () => {
    setIsSaving(true);
    clearMessage();
    try {
      const store = cookieStoreFor(source);
      const value = cookie.trim();
      // A hand-edited QQ cookie no longer matches the stored refresh credential.
      if (login === 'qq-qr' && value !== store.getCookie()) await qqCredentialManager.clearCredential();
      if (value) {
        await store.setCookie(value);
        const status = await store.validateCookie();
        if (!status.valid) {
          showMessage(t('settingsDialog.cookieInvalid'), 'error');
          await store.clearCookie();
          return;
        }
        void syncOnlineCookiesToMain(source);
      } else {
        await store.clearCookie();
      }
      showMessage(t('settingsDialog.saved'), 'success');
    } catch (error) {
      showMessage(t('settingsDialog.saveFailed'), 'error');
      logger.error('[SettingsPanel] Cookie save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [cookie, clearMessage, login, showMessage, source, t]);

  return {
    login,
    qrSupported,
    cookie,
    cookieDirty: cookie.trim() !== savedCookie,
    signedIn,
    qrState,
    qrImage,
    qrMsg,
    qrScanning: qrState === 'loading' || qrState === 'waiting' || qrState === 'confirming',
    isSaving,
    message,
    setCookie,
    saveCookie,
    startQr,
    logout,
  };
}
