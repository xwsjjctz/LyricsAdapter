import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsManager, type OnlineSource } from '@/services/settingsManager';
import { qqCredentialManager } from '@/services/qqCredentialManager';
import { cookieStoreFor, sourceLogin, syncOnlineCookiesToMain, type MusicSourceLogin } from '@/services/musicSources';
import { useTranslation } from 'react-i18next';
import { logger } from '@/services/logger';

// Owns provider login and download-path state independently from panel layout.
import {
  startQQLogin,
  pollQQLogin,
  startNetEaseQR,
  pollNetEaseQR,
  type QRLoginStatus,
  type QRPollResult,
} from '@/services/qrLogin';

interface UseOnlineMusicSettingsOptions {
  /** When true, the section is mounted (experimental toggle enabled). Drives QR
   *  scan startup. */
  enabled: boolean;
  sources?: OnlineSource[];
}

interface UseOnlineMusicSettingsResult {
  onlineSource: OnlineSource;
  /** How the selected source signs in; QR scanning exists only for the official sources. */
  login: MusicSourceLogin;
  /** Cookie draft for the selected source. */
  cookie: string;
  /** The draft differs from the stored cookie. */
  cookieDirty: boolean;
  downloadPath: string;
  qrState: 'idle' | 'loading' | QRLoginStatus;
  qrImage: string | null;
  qrMsg: string;
  isQrLoggedIn: boolean;
  qrScanning: boolean;
  isSaving: boolean;
  message: string | null;
  messageType: 'success' | 'error' | null;
  setOnlineSource: (source: OnlineSource) => void;
  setCookie: (v: string) => void;
  setDownloadPath: (v: string) => void;
  /** Validates and stores the cookie draft; the source and download path apply as they change. */
  saveCookie: () => Promise<void>;
  startQr: (source: OnlineSource) => Promise<void>;
  handleQrLogout: () => Promise<void>;
}

const supportsQr = (login: MusicSourceLogin) => login === 'qq-qr' || login === 'netease-qr';

const QR_FLOWS = {
  'qq-qr': { start: startQQLogin, poll: pollQQLogin },
  'netease-qr': { start: startNetEaseQR, poll: pollNetEaseQR },
} as const;

/**
 * Owns online music settings: the selected source, its cookie, the QR
 * scan-login lifecycle for sources that support it, and the download path.
 * Each source's cookie lives in its own store (musicSources.cookieStoreFor).
 */
export function useOnlineMusicSettings({ enabled, sources }: UseOnlineMusicSettingsOptions): UseOnlineMusicSettingsResult {
  const { t } = useTranslation();
  const [onlineSource, setOnlineSourceState] = useState<OnlineSource>(() => settingsManager.getOnlineSource());
  const [cookie, setCookie] = useState('');
  const [savedCookie, setSavedCookie] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [downloadPath, setDownloadPath] = useState('');
  const [qrState, setQrState] = useState<'idle' | 'loading' | QRLoginStatus>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrMsg, setQrMsg] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);

  const sessionRef = useRef<{ source: OnlineSource; key: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const login = sourceLogin(onlineSource);

  // Initial load of persisted values.
  useEffect(() => {
    (async () => {
      await settingsManager.ensureLoaded();
      const selected = settingsManager.getOnlineSource();
      setOnlineSourceState(sources?.length && !sources.includes(selected) ? sources[0]! : selected);
      setDownloadPath(settingsManager.getDownloadPath());
    })();
  }, []);
  const availableSource = sources?.includes(onlineSource) ? onlineSource : sources?.[0];
  useEffect(() => {
    if (availableSource && availableSource !== onlineSource) setOnlineSourceState(availableSource);
  }, [availableSource, onlineSource]);

  // Follow the selected source's cookie store. A silent QQ musickey refresh
  // rewrites the cookie, so the draft must stay in step or Save would write
  // the stale value back.
  useEffect(() => {
    const store = cookieStoreFor(onlineSource);
    let active = true;
    const read = () => {
      if (!active) return;
      setCookie(store.getCookie());
      setSavedCookie(store.getCookie());
      setLoggedIn(store.hasCookie());
    };
    void store.ensureLoaded().then(read);
    const unsubscribe = store.subscribe(read);
    return () => { active = false; unsubscribe(); };
  }, [onlineSource]);

  const showMessage = useCallback((msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => { setMessage(null); setMessageType(null); }, 3000);
  }, []);

  const stopQrPolling = useCallback((): void => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const resetQr = useCallback((): void => {
    stopQrPolling();
    sessionRef.current = null;
    setQrImage(null);
    setQrMsg('');
    setQrState('idle');
  }, [stopQrPolling]);

  const handleQrPollResult = useCallback(async (source: OnlineSource, res: QRPollResult): Promise<void> => {
    setQrState(res.status);
    if (res.status === 'confirming') {
      setQrMsg(t('settingsDialog.qrConfirming'));
    } else if (res.status === 'waiting') {
      setQrMsg(res.msg || t('settingsDialog.qrWaiting'));
    } else if (res.msg) {
      setQrMsg(res.msg);
    }

    if (res.status === 'done') {
      stopQrPolling();
      setQrImage(null);
      if (res.cookie) {
        if (sourceLogin(source) === 'qq-qr') {
          if (res.credential) await qqCredentialManager.setCredential(res.credential);
          else await qqCredentialManager.clearCredential();
        }
        await cookieStoreFor(source).setCookie(res.cookie);
        void syncOnlineCookiesToMain(source);
        showMessage(t('settingsDialog.qrLoggedIn'), 'success');
      }
    } else if (res.status === 'expired') {
      stopQrPolling();
      setQrImage(null);
    }
    // 'waiting' | 'confirming' | 'error' → keep polling (error is treated as soft)
  }, [showMessage, stopQrPolling]);

  const beginQrPolling = useCallback((source: OnlineSource, key: string): void => {
    stopQrPolling();
    const flow = sourceLogin(source);
    if (!supportsQr(flow)) return;
    const tick = async (): Promise<void> => {
      if (!mountedRef.current) return;
      const sess = sessionRef.current;
      if (!sess || sess.key !== key) return; // superseded by a newer session
      try {
        const res = await QR_FLOWS[flow].poll(key);
        if (!mountedRef.current) return;
        if (!sessionRef.current || sessionRef.current.key !== key) return;
        await handleQrPollResult(source, res);
      } catch (e) {
        if (!mountedRef.current) return;
        logger.error('[SettingsPanel] QR poll failed:', e);
        setQrMsg((e as Error).message || t('settingsDialog.qrError'));
        setQrState('error');
      }
    };
    pollTimerRef.current = setInterval(tick, 2000);
  }, [handleQrPollResult, stopQrPolling]);

  const startQr = useCallback(async (source: OnlineSource): Promise<void> => {
    stopQrPolling();
    sessionRef.current = null;
    setQrImage(null);
    setQrMsg('');
    const flow = sourceLogin(source);
    if (!supportsQr(flow)) {
      setQrState('idle');
      return;
    }
    setQrState('loading');
    try {
      const res = await QR_FLOWS[flow].start();
      if (!mountedRef.current) return;
      sessionRef.current = { source, key: res.sessionKey };
      setQrImage(res.qrcode);
      setQrState('waiting');
      setQrMsg(t('settingsDialog.qrWaiting'));
      beginQrPolling(source, res.sessionKey);
    } catch (e) {
      if (!mountedRef.current) return;
      logger.error('[SettingsPanel] startQr failed:', e);
      setQrMsg((e as Error).message || t('settingsDialog.qrError'));
      setQrState('error');
    }
  }, [beginQrPolling, stopQrPolling]);

  const handleQrLogout = useCallback(async (): Promise<void> => {
    if (login === 'qq-qr') await qqCredentialManager.clearCredential();
    await cookieStoreFor(onlineSource).clearCookie();
    resetQr();
    await startQr(onlineSource);
  }, [login, onlineSource, resetQr, startQr]);

  // Mark mounted; tear down polling on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopQrPolling();
      sessionRef.current = null;
    };
  }, [stopQrPolling]);

  // (Re)start QR whenever the section is shown or the source changes.
  useEffect(() => {
    resetQr();
    if (!enabled || (sources && !sources.includes(onlineSource)) || !supportsQr(login)) return;
    const store = cookieStoreFor(onlineSource);
    let cancelled = false;
    void store.ensureLoaded().then(() => {
      if (!cancelled && !store.hasCookie()) void startQr(onlineSource);
    });
    return () => {
      cancelled = true;
      stopQrPolling();
      sessionRef.current = null;
    };
    // startQr/resetQr are stable in behavior (only refs + setters); omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onlineSource, availableSource, login]);

  const setOnlineSource = useCallback((source: OnlineSource) => {
    setOnlineSourceState(source);
    settingsManager.setOnlineSource(source);
    setMessage(null);
    setMessageType(null);
  }, []);

  const saveCookie = useCallback(async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const cookieStore = cookieStoreFor(onlineSource);
      const cookieValue = cookie.trim();
      // A hand-edited QQ cookie no longer matches the stored refresh credential.
      if (login === 'qq-qr' && cookieValue !== cookieStore.getCookie()) {
        await qqCredentialManager.clearCredential();
      }
      if (cookieValue) {
        await cookieStore.setCookie(cookieValue);
        const status = await cookieStore.validateCookie();
        if (!status.valid) {
          showMessage(t('settingsDialog.cookieInvalid'), 'error');
          await cookieStore.clearCookie();
          return;
        }
        void syncOnlineCookiesToMain(onlineSource);
      } else {
        await cookieStore.clearCookie();
      }
      showMessage(t('settingsDialog.saved'), 'success');
    } catch (err) {
      showMessage(t('settingsDialog.saveFailed'), 'error');
      logger.error('[SettingsPanel] Online Music save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [cookie, login, onlineSource, showMessage]);

  const qrScanning = qrState === 'loading' || qrState === 'waiting' || qrState === 'confirming';

  return {
    onlineSource,
    login,
    cookie,
    cookieDirty: cookie.trim() !== savedCookie,
    downloadPath,
    qrState,
    qrImage,
    qrMsg,
    isQrLoggedIn: loggedIn,
    qrScanning,
    isSaving,
    message,
    messageType,
    setOnlineSource,
    setCookie,
    setDownloadPath,
    saveCookie,
    startQr,
    handleQrLogout,
  };
}
