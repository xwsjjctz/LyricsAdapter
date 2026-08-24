import { useCallback, useEffect, useRef, useState } from 'react';
import { cookieManager, neteaseCookieManager, syncOnlineCookiesToMain } from '@/services/cookieManager';
import { settingsManager, type OnlineSource } from '@/services/settingsManager';
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
}

interface UseOnlineMusicSettingsResult {
  onlineSource: OnlineSource;
  cookie: string;
  neteaseCookie: string;
  downloadPath: string;
  qqLoggedIn: boolean;
  neteaseLoggedIn: boolean;
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
  setNeteaseCookie: (v: string) => void;
  setDownloadPath: (v: string) => void;
  handleSave: () => Promise<void>;
  startQr: (source: OnlineSource) => Promise<void>;
  handleQrLogout: () => Promise<void>;
}

/**
 * Owns third-party online music settings: cookie storage, QR scan-login
 * lifecycle, and source/download-path persistence. This was by far the most
 * state-heavy part of the monolithic SettingsPanel (~15 useState + 3 refs + a
 * polling timer); isolating it keeps the QR polling lifecycle explicit and
 * scoped to the section that renders it.
 */
export function useOnlineMusicSettings({ enabled }: UseOnlineMusicSettingsOptions): UseOnlineMusicSettingsResult {
  const { t } = useTranslation();
  const [onlineSource, setOnlineSourceState] = useState<OnlineSource>('qq');
  const [cookie, setCookie] = useState('');
  const [neteaseCookie, setNeteaseCookie] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [qqLoggedIn, setQqLoggedIn] = useState(false);
  const [neteaseLoggedIn, setNeteaseLoggedIn] = useState(false);
  const [qrState, setQrState] = useState<'idle' | 'loading' | QRLoginStatus>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrMsg, setQrMsg] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);

  const sessionRef = useRef<{ source: OnlineSource; key: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Initial load of persisted values.
  useEffect(() => {
    (async () => {
      await cookieManager.ensureLoaded();
      await neteaseCookieManager.ensureLoaded();
      await settingsManager.ensureLoaded();
      setCookie(cookieManager.getCookie());
      setNeteaseCookie(neteaseCookieManager.getCookie());
      setOnlineSourceState(settingsManager.getOnlineSource());
      setQqLoggedIn(cookieManager.hasCookie());
      setNeteaseLoggedIn(neteaseCookieManager.hasCookie());
      setDownloadPath(settingsManager.getDownloadPath());
    })();
  }, []);

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
        if (source === 'qq') {
          await cookieManager.setCookie(res.cookie);
          setCookie(cookieManager.getCookie());
          setQqLoggedIn(true);
          void syncOnlineCookiesToMain('qq');
        } else if (source === 'netease') {
          await neteaseCookieManager.setCookie(res.cookie);
          setNeteaseCookie(neteaseCookieManager.getCookie());
          setNeteaseLoggedIn(true);
          void syncOnlineCookiesToMain('netease');
        }
        showMessage(t('settingsDialog.qrLoggedIn'), 'success');
      }
    } else if (res.status === 'expired') {
      stopQrPolling();
      setQrImage(null);
    }
    // 'waiting' | 'confirming' | 'error' → keep polling (error is treated as soft)
  }, [showMessage, stopQrPolling]);

  // beginQrPolling/startQr reference the latest handleQrPollResult via ref-free
  // closure: they are recreated whenever their deps change, and the effect below
  // restarts the scan when enabled/source changes.
  const beginQrPolling = useCallback((source: OnlineSource, key: string): void => {
    stopQrPolling();
    const tick = async (): Promise<void> => {
      if (!mountedRef.current) return;
      const sess = sessionRef.current;
      if (!sess || sess.key !== key) return; // superseded by a newer session
      try {
        const res = source === 'qq' ? await pollQQLogin(key) : await pollNetEaseQR(key);
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
    setQrState('loading');
    try {
      const res = source === 'qq' ? await startQQLogin() : await startNetEaseQR();
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
    if (onlineSource === 'qq') {
      await cookieManager.clearCookie();
      setCookie('');
      setQqLoggedIn(false);
    } else {
      await neteaseCookieManager.clearCookie();
      setNeteaseCookie('');
      setNeteaseLoggedIn(false);
    }
    resetQr();
    await startQr(onlineSource);
  }, [onlineSource, resetQr, startQr]);

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
    if (!enabled) {
      resetQr();
      return;
    }
    resetQr();
    const loggedIn =
      onlineSource === 'qq' ? cookieManager.hasCookie() : neteaseCookieManager.hasCookie();
    if (!loggedIn) {
      void startQr(onlineSource);
    }
    return () => {
      stopQrPolling();
      sessionRef.current = null;
    };
    // startQr/resetQr are stable in behavior (only refs + setters); omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onlineSource]);

  const setOnlineSource = useCallback((source: OnlineSource) => {
    setOnlineSourceState(source);
    settingsManager.setOnlineSource(source);
    setMessage(null);
    setMessageType(null);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      if (!await settingsManager.setOnlineSource(onlineSource)) {
        throw new Error('Failed to persist online music source');
      }
      const cookieStore = onlineSource === 'netease'
        ? neteaseCookieManager
        : cookieManager;
      const cookieValue = (onlineSource === 'netease'
        ? neteaseCookie
        : cookie).trim();
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
      if (!await settingsManager.setDownloadPath(downloadPath.trim())) {
        throw new Error('Failed to persist download path');
      }
      showMessage(t('settingsDialog.saved'), 'success');
    } catch (err) {
      showMessage(t('settingsDialog.saveFailed'), 'error');
      logger.error('[SettingsPanel] Online Music save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [cookie, downloadPath, neteaseCookie, onlineSource, showMessage]);

  const isQrLoggedIn = onlineSource === 'qq'
    ? qqLoggedIn
    : neteaseLoggedIn;
  const qrScanning = qrState === 'loading' || qrState === 'waiting' || qrState === 'confirming';

  return {
    onlineSource,
    cookie,
    neteaseCookie,
    downloadPath,
    qqLoggedIn,
    neteaseLoggedIn,
    qrState,
    qrImage,
    qrMsg,
    isQrLoggedIn,
    qrScanning,
    isSaving,
    message,
    messageType,
    setOnlineSource,
    setCookie,
    setNeteaseCookie,
    setDownloadPath,
    handleSave,
    startQr,
    handleQrLogout,
  };
}
