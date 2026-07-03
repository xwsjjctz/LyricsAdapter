import { ipcMain } from 'electron';
import crypto from 'node:crypto';
import { CookieJar } from 'tough-cookie';
import { logger } from '../logger';

/**
 * QQ Music (QQ音乐) two-step scan-login, main-process implementation.
 *
 * QQ Music's web API does NOT accept the generic QQ "scan" QR directly — the
 * working path is the QQ-Connect OAuth flow: ptlogin2 issues a QR, the user
 * scans with the QQ app, we exchange the resulting OAuth `code` for the final
 * QQ Music cookies (`uin`, `qqmusic_key`, …) via `QQConnectLogin.LoginServer`.
 *
 * Ported from the community two-step implementation (qqmusic-qr-two-step),
 * rewritten on top of Node's native `fetch` + `tough-cookie` (no `got`).
 *
 *   1) startLogin()  -> { token, qrcode (dataURL), expiresIn }
 *   2) pollLogin(token) -> waiting | confirming | done | expired | error
 *      (on `done` returns the final QQ Music cookie string)
 */

// ===== 配置 =====
const APPID = 716027609;
const DAID = 383;
const PT_3RD_AID = 100497308; // QQ Music QQ-Connect appid
const S_URL = 'https://graph.qq.com/oauth2.0/login_jump';
const YQQ_REDIRECT_URI =
  'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=' +
  encodeURIComponent('https://y.qq.com/?ADTAG=myqq#type=index');

const XLOGIN_URL =
  `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=${APPID}&daid=${DAID}` +
  `&style=33&login_text=%E7%99%BB%E5%BD%95&hide_title_bar=1&hide_border=1&target=self` +
  `&s_url=${encodeURIComponent(S_URL)}&pt_3rd_aid=${PT_3RD_AID}` +
  `&pt_feedback_link=${encodeURIComponent(
    'https://support.qq.com/products/77942?customInfo=.appid' + PT_3RD_AID
  )}&theme=2&verify_theme=`;

const ptqrShowUrl = (t: number): string =>
  `https://xui.ptlogin2.qq.com/ssl/ptqrshow?appid=${APPID}` +
  `&e=2&l=M&s=3&d=72&v=4&t=${t}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}` +
  `&u1=${encodeURIComponent(S_URL)}`;

const PTQRLOGIN_URL = 'https://xui.ptlogin2.qq.com/ssl/ptqrlogin';
const graphShowUrl = (state: string): string =>
  'https://graph.qq.com/oauth2.0/show?' +
  new URLSearchParams({
    which: 'Login',
    display: 'pc',
    response_type: 'code',
    client_id: String(PT_3RD_AID),
    redirect_uri: YQQ_REDIRECT_URI,
    state,
    scope: 'get_user_info,get_app_friends',
  }).toString();

const GRAPH_AUTHORIZE_URL = 'https://graph.qq.com/oauth2.0/authorize';

const YQQ_HOME = 'https://y.qq.com/';
const U_YQQ_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';

// ===== 工具函数 =====
function hash33(str: string): number {
  let e = 0;
  for (let i = 0; i < str.length; i++) {
    e += (e << 5) + str.charCodeAt(i);
    e &= 0x7fffffff;
  }
  return e;
}

function calcGTK(pskey: string): number {
  let hash = 5381;
  for (let i = 0; i < pskey.length; i++) {
    hash += (hash << 5) + pskey.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

interface PtuiCB {
  code: string;
  url: string;
  msg: string;
  nickname: string;
}

function parsePtuiCB(body: string): PtuiCB {
  const m = [...String(body).matchAll(/'([^']*)'/g)].map((x) => x[1]);
  if (!m.length) throw new Error('无法解析 ptuiCB 返回: ' + String(body).slice(0, 200));
  return { code: m[0] ?? '', url: m[2] ?? '', msg: m[4] ?? '', nickname: m[5] ?? '' };
}

function uuidUpper(): string {
  return crypto.randomUUID().toUpperCase();
}

async function cookieMapFor(jar: CookieJar, url: string): Promise<Record<string, string>> {
  const list = await jar.getCookies(url);
  const map: Record<string, string> = {};
  for (const c of list) map[c.key] = c.value;
  return map;
}

// ===== 会话管理 =====
interface QQSession {
  token: string;
  jar: CookieJar;
  createdAt: number;
  lastPollAt: number;
  hardExpireAt: number;
  status: 'init' | 'waiting' | 'confirming' | 'authed' | 'done' | 'expired' | 'error';
  lock: boolean;
  qrsig: string | null;
  ptqrtoken: number | null;
  checkSigUrl: string | null;
  msg: string;
}

const store = new Map<string, QQSession>();
const QR_HARD_TTL = 130_000; // 130s hard expiry
const IDLE_TTL = 15_000; // 15s idle expiry
const GC_INTERVAL_MS = 30_000;

let lastGc = 0;
function gcSessions(): void {
  const now = Date.now();
  if (now - lastGc < GC_INTERVAL_MS) return;
  lastGc = now;
  for (const [k, s] of store) {
    const hardExpired = now > s.hardExpireAt;
    const idleExpired = now - s.lastPollAt > IDLE_TTL;
    const terminal = s.status === 'done' || s.status === 'expired' || s.status === 'error';
    if (hardExpired || idleExpired || terminal) store.delete(k);
  }
}

function safeDelete(token: string): void {
  store.delete(token);
}

// ===== HTTP + Cookie Jar =====
async function saveCookies(jar: CookieJar, url: string, res: Response): Promise<void> {
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of sc) {
    if (!c) continue;
    try {
      await jar.setCookie(c, url);
    } catch {
      // tolerant: ignore malformed cookies
    }
  }
}

interface FetchOpts {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  maxRedirects?: number;
}

/** Fetch with a cookie jar, following redirects manually so Set-Cookie is captured. */
async function fetchWithJar(
  jar: CookieJar,
  url: string,
  opts: FetchOpts = {}
): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(opts.headers ?? {}),
  };
  const cookieStr = await jar.getCookieString(url);
  if (cookieStr) baseHeaders['Cookie'] = cookieStr;

  // Build RequestInit conditionally so we never pass `body: undefined`
  // (exactOptionalPropertyTypes rejects assigning undefined to optional props).
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: baseHeaders,
    redirect: 'manual',
  };
  if (opts.body !== undefined) init.body = opts.body;
  let res = await fetch(url, init);
  await saveCookies(jar, url, res);

  let redirects = opts.maxRedirects ?? 5;
  let currentUrl = url;
  while (redirects > 0 && [301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc) break;
    const nextUrl = new URL(loc, currentUrl).toString();
    let method = opts.method ?? 'GET';
    let body = opts.body;
    if (res.status === 302 || res.status === 303) {
      method = 'GET';
      body = undefined;
    }
    const nextHeaders: Record<string, string> = {
      ...baseHeaders,
      Cookie: await jar.getCookieString(nextUrl),
    };
    const nextInit: RequestInit = { method, headers: nextHeaders, redirect: 'manual' };
    if (body !== undefined) nextInit.body = body;
    res = await fetch(nextUrl, nextInit);
    await saveCookies(jar, nextUrl, res);
    currentUrl = nextUrl;
    redirects -= 1;
  }
  return res;
}

async function ensureUiCookie(session: QQSession): Promise<string> {
  const existed = (await cookieMapFor(session.jar, 'https://graph.qq.com/'))['ui'];
  if (existed) return existed;
  const val = uuidUpper();
  try {
    await session.jar.setCookie(`ui=${val}; Path=/; Domain=graph.qq.com;`, 'https://graph.qq.com/');
  } catch {
    // ignore
  }
  return val;
}

async function ensureYqqContextCookies(session: QQSession): Promise<void> {
  const qqCom = await cookieMapFor(session.jar, 'https://qq.com/');
  const yqq = await cookieMapFor(session.jar, 'https://y.qq.com/');
  const rnd = (): string => String(Math.floor(Math.random() * 9e9 + 1e9));
  const set = async (raw: string, url: string): Promise<void> => {
    try {
      await session.jar.setCookie(raw, url);
    } catch {
      // ignore
    }
  };
  if (!qqCom['pgv_pvid']) await set(`pgv_pvid=${rnd()}; Path=/; Domain=qq.com;`, 'https://qq.com/');
  if (!qqCom['pgv_info']) await set(`pgv_info=ssid=s${rnd()}; Path=/; Domain=qq.com;`, 'https://qq.com/');
  if (!yqq['ts_uid']) await set(`ts_uid=${rnd()}; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/');
  if (!yqq['ts_last']) await set(`ts_last=y.qq.com/; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/');
  if (!yqq['ts_refer']) await set(`ts_refer=i.y.qq.com/; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/');
  await set(`login_type=1; Path=/; Domain=qq.com;`, 'https://qq.com/');
  await set(`login_type=1; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/');
}

/**
 * Build the final QQ Music cookie string.
 *
 * Collects cookies from a broad set of domains and de-dupes by name (first
 * domain wins). Critically includes ptlogin2 / graph domains so the QQ-login
 * `p_skey` / `skey` (required by g_tk-validated modules like MinePlaylist) are
 * captured even when set host-only on ptlogin2.qq.com.
 */
async function buildFinalCookie(session: QQSession): Promise<string> {
  // Order matters: qq.com first so its p_skey takes priority over graph's.
  const urls = [
    'https://qq.com/',
    'https://ptlogin2.qq.com/',
    'https://ssl.ptlogin2.qq.com/',
    'https://xui.ptlogin2.qq.com/',
    'https://graph.qq.com/',
    'https://y.qq.com/',
    'https://u.y.qq.com/',
  ];
  const map = new Map<string, string>();
  for (const url of urls) {
    const list = await session.jar.getCookies(url);
    if (list.length > 0) {
      logger.info(
        `[QQLogin] cookies @ ${url}:`,
        list.map((c) => c.key).join(',')
      );
    }
    for (const c of list) {
      if (c.key && !map.has(c.key)) map.set(c.key, c.value);
    }
  }
  logger.info(
    `[QQLogin] final cookie keys:`,
    [...map.keys()].join(','),
    '| has p_skey:',
    map.has('p_skey'),
    '| has skey:',
    map.has('skey')
  );
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ===== Step 1：获取二维码 =====
async function startLogin(): Promise<{ token: string; qrcode: string; expiresIn: number }> {
  gcSessions();

  const now = Date.now();
  const session: QQSession = {
    token: uuidUpper(),
    jar: new CookieJar(undefined, { looseMode: true }),
    createdAt: now,
    lastPollAt: now,
    hardExpireAt: now + QR_HARD_TTL,
    status: 'init',
    lock: false,
    qrsig: null,
    ptqrtoken: null,
    checkSigUrl: null,
    msg: '',
  };
  store.set(session.token, session);

  // 1) open the login page → pre-cookies (pt_login_sig, …)
  await fetchWithJar(session.jar, XLOGIN_URL, {
    headers: {
      Referer: 'https://xui.ptlogin2.qq.com/',
      'Upgrade-Insecure-Requests': '1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
    },
  });

  // 2) fetch the QR image
  const res = await fetchWithJar(session.jar, ptqrShowUrl(Math.random()), {
    headers: {
      Referer: XLOGIN_URL,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });
  if (res.status !== 200) {
    safeDelete(session.token);
    throw new Error(`获取二维码失败，HTTP ${res.status}`);
  }

  const ptCookies = await cookieMapFor(session.jar, 'https://ptlogin2.qq.com/');
  const qrsig = ptCookies['qrsig'];
  if (!qrsig) {
    safeDelete(session.token);
    throw new Error('未获取到 qrsig');
  }
  session.qrsig = qrsig;
  session.ptqrtoken = hash33(qrsig);
  session.status = 'waiting';

  const buf = Buffer.from(await res.arrayBuffer());
  const dataURL = `data:image/png;base64,${buf.toString('base64')}`;

  return { token: session.token, qrcode: dataURL, expiresIn: 120 };
}

interface PollResult {
  status: 'waiting' | 'confirming' | 'done' | 'expired' | 'error';
  msg: string;
  cookie?: string;
}

// ===== Step 2：轮询（直到拿到最终 Cookie）=====
async function pollLogin(token: string): Promise<PollResult> {
  gcSessions();
  const session = store.get(token);
  if (!session) return { status: 'error', msg: 'invalid token' };

  const now = Date.now();
  if (now > session.hardExpireAt) {
    session.status = 'expired';
    session.msg = '二维码已超时';
    safeDelete(token);
    return { status: 'expired', msg: session.msg };
  }
  if (now - session.lastPollAt > IDLE_TTL) {
    session.status = 'expired';
    session.msg = '会话已空闲过久';
    safeDelete(token);
    return { status: 'expired', msg: session.msg };
  }
  session.lastPollAt = now;

  if (session.ptqrtoken == null) {
    safeDelete(token);
    return { status: 'error', msg: '请先获取二维码' };
  }

  // Still polling ptqrlogin until we capture the check_sig URL.
  if (!session.checkSigUrl) {
    const xuiCookies = await session.jar.getCookies('https://xui.ptlogin2.qq.com/');
    const loginSig = xuiCookies.find((c) => c.key === 'pt_login_sig')?.value ?? '';

    const params = new URLSearchParams({
      u1: S_URL,
      ptqrtoken: String(session.ptqrtoken),
      ptredirect: '0',
      h: '1',
      t: '1',
      g: '1',
      from_ui: '1',
      ptlang: '2052',
      js_ver: '25100115',
      js_type: '1',
      login_sig: loginSig,
      pt_uistyle: '40',
      aid: String(APPID),
      daid: String(DAID),
      pt_3rd_aid: String(PT_3RD_AID),
      pt_js_version: '28d22679',
      action: `0-0-${Date.now()}`,
    });

    const res = await fetchWithJar(session.jar, `${PTQRLOGIN_URL}?${params.toString()}`, {
      headers: { Referer: XLOGIN_URL, Accept: '*/*' },
    });
    if (res.status !== 200) {
      return { status: 'error', msg: `轮询失败 HTTP ${res.status}` };
    }

    let parsed: PtuiCB;
    try {
      parsed = parsePtuiCB(await res.text());
    } catch (e) {
      return { status: 'error', msg: '解析轮询失败: ' + (e as Error).message };
    }

    if (parsed.code === '66') {
      session.status = 'waiting';
      return { status: 'waiting', msg: parsed.msg || '二维码未失效' };
    }
    if (parsed.code === '67') {
      session.status = 'confirming';
      return { status: 'confirming', msg: parsed.msg || '二维码认证中' };
    }
    if (parsed.code !== '0') {
      session.status = 'expired';
      session.msg = parsed.msg || '二维码已失效或被取消';
      safeDelete(token);
      return { status: 'expired', msg: session.msg };
    }

    session.status = 'authed';
    session.checkSigUrl = parsed.url;
    // fall through to finalize
  }

  if (session.lock) {
    return { status: 'confirming', msg: '登录确认中，请稍后重试' };
  }
  session.lock = true;

  try {
    // 3) complete graph cookie landing
    await fetchWithJar(session.jar, session.checkSigUrl!, {
      headers: {
        Referer: 'https://xui.ptlogin2.qq.com/',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
      maxRedirects: 8,
    });

    // 4) authorize → OAuth code
    const graphCookies = await cookieMapFor(session.jar, 'https://graph.qq.com/');
    const p_skey = graphCookies['p_skey'] ?? '';
    const g_tk = p_skey ? calcGTK(p_skey) : 5381;
    const uiVal = await ensureUiCookie(session);
    const state = Math.random().toString(36).slice(2);
    const showUrl = graphShowUrl(state);

    await fetchWithJar(session.jar, showUrl, {
      headers: {
        Referer: 'https://graph.qq.com/',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
    });

    const form = new URLSearchParams({
      response_type: 'code',
      client_id: String(PT_3RD_AID),
      redirect_uri: YQQ_REDIRECT_URI,
      scope: 'get_user_info,get_app_friends',
      state,
      switch: '',
      from_ptlogin: '1',
      src: '1',
      update_auth: '1',
      openapi: '1010_1030',
      g_tk: String(g_tk),
      auth_time: String(Date.now()),
      ui: uiVal,
    }).toString();

    const authRes = await fetchWithJar(session.jar, GRAPH_AUTHORIZE_URL, {
      method: 'POST',
      body: form,
      headers: {
        Origin: 'https://graph.qq.com',
        Referer: showUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
      maxRedirects: 0,
    });

    if (![301, 302].includes(authRes.status)) {
      session.status = 'error';
      session.msg = `authorize 非302: ${authRes.status}`;
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }
    const loc = authRes.headers.get('location') ?? '';
    const redirectUrl = new URL(loc, 'https://graph.qq.com').toString();
    const code = new URL(redirectUrl).searchParams.get('code');
    if (!code) {
      session.status = 'error';
      session.msg = '未获取到 code';
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    // 5) follow the y.qq.com redirect, establish site context
    await ensureYqqContextCookies(session);
    await fetchWithJar(session.jar, redirectUrl, {
      headers: {
        Referer: 'https://graph.qq.com/',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
      maxRedirects: 5,
    });

    // 6) exchange the code for the final QQ Music cookies
    await ensureYqqContextCookies(session);
    const payload = {
      comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
    };
    const resMusic = await fetchWithJar(session.jar, U_YQQ_MUSICU, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Origin: YQQ_HOME,
        Referer: YQQ_HOME,
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      maxRedirects: 0,
    });

    if (resMusic.status !== 200) {
      session.status = 'error';
      session.msg = `u.y.qq.com HTTP ${resMusic.status}`;
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    let musicJson: { code?: number; req?: { code?: number; data?: unknown } };
    try {
      musicJson = JSON.parse(await resMusic.text()) as typeof musicJson;
    } catch {
      session.status = 'error';
      session.msg = '解析音乐登录返回失败';
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    if (!(musicJson.code === 0 && musicJson.req?.code === 0)) {
      session.status = 'error';
      session.msg = 'QQ音乐登录返回非0';
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    const cookie = await buildFinalCookie(session);
    session.status = 'done';
    safeDelete(token);
    return { status: 'done', msg: '登录成功', cookie };
  } catch (e) {
    session.status = 'error';
    session.msg = (e as Error).message || 'unknown';
    safeDelete(token);
    return { status: 'error', msg: session.msg };
  } finally {
    const s = store.get(token);
    if (s) s.lock = false;
  }
}

export function registerQQLoginHandlers(): void {
  ipcMain.handle('qq-login-qr-start', async () => {
    try {
      const result = await startLogin();
      logger.info('[QQLogin] QR issued, token:', result.token);
      return { success: true, ...result };
    } catch (error) {
      logger.error('[QQLogin] startLogin failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('qq-login-qr-poll', async (_event, token: string) => {
    if (typeof token !== 'string' || !token) {
      return { success: false, error: 'Invalid token' };
    }
    try {
      const result = await pollLogin(token);
      if (result.status === 'done') {
        logger.info('[QQLogin] login success');
      } else if (result.status === 'expired' || result.status === 'error') {
        logger.warn('[QQLogin] poll terminal:', result.status, result.msg);
      }
      return { success: true, ...result };
    } catch (error) {
      logger.error('[QQLogin] pollLogin failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
