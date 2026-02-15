import React, { useState, useEffect } from 'react';
import { cookieManager } from '../services/cookieManager';
import { logger } from '../services/logger';

interface CookieDialogProps {
  isOpen: boolean;
  onClose: (success: boolean) => void;
}

const CookieDialog: React.FC<CookieDialogProps> = ({ isOpen, onClose }) => {
  const [cookie, setCookie] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCookie(cookieManager.getCookie());
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!cookie.trim()) {
      setError('请输入Cookie');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // Save cookie temporarily for validation
      cookieManager.setCookie(cookie.trim());
      
      // Validate cookie
      const status = await cookieManager.validateCookie();
      
      if (status.valid) {
        logger.debug('[CookieDialog] Cookie validated successfully');
        onClose(true);
      } else {
        setError(status.message || 'Cookie验证失败，请检查Cookie是否正确');
        cookieManager.clearCookie();
      }
    } catch (err) {
      setError('验证过程中发生错误，请检查网络连接');
      cookieManager.clearCookie();
    } finally {
      setIsValidating(false);
    }
  };

  const handleClose = () => {
    if (!isValidating) {
      onClose(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a2533] border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">设置访问凭证</h2>
          <button
            onClick={handleClose}
            className="text-white/40 hover:text-white transition-colors"
            disabled={isValidating}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="text-white/60 text-sm mb-4">
          为了使用浏览功能，需要提供访问凭证。凭证每24小时需要重新验证一次。
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-white/80 mb-2">
              Cookie
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="粘贴你的访问凭证..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 focus:bg-white/[0.07] transition-all resize-none"
              disabled={isValidating}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">error</span>
                {error}
              </div>
            </div>
          )}

          <div className="bg-white/5 rounded-xl p-3 mb-4">
            <p className="text-xs text-white/50">
              <span className="material-symbols-outlined text-sm align-text-bottom mr-1">info</span>
              获取Cookie方法：
            </p>
            <ol className="text-xs text-white/50 mt-2 ml-5 list-decimal space-y-1">
              <li>在浏览器中打开 y.qq.com 并登录</li>
              <li>按 F12 打开开发者工具</li>
              <li>切换到 Network/网络 标签</li>
              <li>刷新页面，找到任意请求</li>
              <li>复制请求头中的 Cookie 字段</li>
            </ol>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-4">
            <p className="text-xs text-yellow-400/80">
              <span className="material-symbols-outlined text-sm align-text-bottom mr-1">warning</span>
              浏览器环境限制：
            </p>
            <p className="text-xs text-yellow-400/60 mt-1 ml-5">
              由于浏览器跨域安全限制，浏览功能<strong>只能在桌面端</strong>使用。
            </p>
            <p className="text-xs text-yellow-400/40 mt-1 ml-5">
              构建桌面版：npm run electron:build
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 transition-all disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl bg-primary text-white hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isValidating ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                  验证中...
                </>
              ) : (
                '保存'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CookieDialog;
