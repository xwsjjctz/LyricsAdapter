/**
 * WebDAV 云存储厂家策略配置
 *
 * 不同云存储的 WebDAV 实现有各自的行为差异（CDN 重定向策略、写入权限、限制等）。
 * 本模块按域名自动检测并返回对应的 Provider 实例，方便按需启用优化功能。
 *
 * 拓展方式：在 providers/ 目录下新增文件实现 WebDAVProvider 接口，
 * 在本文件的 PROVIDER_MAP 中注册。
 */

import { WebDAVProvider } from './baseProvider';
import { createGenericProvider } from './providers/generic';
import { createPan123Provider } from './providers/pan123';

const GENERIC_PROVIDER = createGenericProvider();

const PROVIDER_MAP: Record<string, () => WebDAVProvider> = {
  '123pan': () => createPan123Provider(),
};

/**
 * 根据服务器 URL 检测云存储厂家，返回对应 Provider 实例。
 * 未匹配的 URL 返回通用 Provider，安全兜底。
 */
export function detectProvider(serverUrl: string): WebDAVProvider {
  const url = serverUrl.toLowerCase();
  if (url.includes('123pan.cn')) {
    return PROVIDER_MAP['123pan']!();
  }
  return GENERIC_PROVIDER;
}

/**
 * 结合用户设置的 readonly 标志，返回最终生效的配置。
 * 即使厂家支持写入，用户勾选了只读也不执行写入操作。
 */
export function getEffectiveConfig(
  serverUrl: string,
  userReadonly: boolean | undefined,
): WebDAVProvider {
  const base = detectProvider(serverUrl);
  if (userReadonly) {
    return {
      ...base,
      allowWrite: () => false,
      autoUploadMetaJson: () => false,
    };
  }
  return base;
}
