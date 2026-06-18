/**
 * WebDAV 云存储厂家策略配置
 *
 * 不同云存储的 WebDAV 实现有各自的行为差异（CDN 重定向策略、写入权限、限制等）。
 * 本模块按域名自动检测并返回对应的策略配置，方便按需启用优化功能。
 *
 * 拓展方式：在 PROVIDER_CONFIGS 中新增条目，detectProvider 中增加域名匹配。
 */

export interface WebDAVProviderConfig {
  /** 厂家显示名称 */
  name: string;
  /** 是否允许写入操作（PUT） */
  allowWrite: boolean;
  /** 慢路径解析后自动上传 .meta.json 副产物文件（仅通用 WebDAV sidecar 模式用） */
  autoUploadMetaJson: boolean;
  /** 使用 Metadata/ 文件夹统一缓存元数据+封面（替代零散的 .meta.json） */
  useMetadataFolder: boolean;
  /** 文件头 Range 读取是否直连服务器（不走 CDN 重定向），减少首载请求数 */
  skipCdnForHeaderRead: boolean;
  /** 批量拉取文件头的并发数 */
  batchSize: number;
}

const PROVIDER_CONFIGS: Record<string, WebDAVProviderConfig> = {
  '123pan': {
    name: '123云盘',
    allowWrite: true,
    autoUploadMetaJson: false,
    useMetadataFolder: true,          // 统一使用 Metadata/ 文件夹缓存（含内联封面）
    skipCdnForHeaderRead: true,       // 文件头读取直连服务器，不走 CDN 重定向
    batchSize: 4,                     // 123pan 并发极低，设小并发避免请求排队超时
  },
};

const GENERIC_CONFIG: WebDAVProviderConfig = {
  name: '通用 WebDAV',
  allowWrite: false,
  autoUploadMetaJson: false,
  useMetadataFolder: false,
  skipCdnForHeaderRead: false,
  batchSize: 10,
};

/**
 * 根据服务器 URL 检测云存储厂家，返回对应策略配置。
 * 未匹配的 URL 返回通用只读配置，安全兜底。
 */
export function detectProvider(serverUrl: string): WebDAVProviderConfig {
  const url = serverUrl.toLowerCase();
  if (url.includes('123pan.cn')) {
    return { ...PROVIDER_CONFIGS['123pan']! } as WebDAVProviderConfig;
  }
  return { ...GENERIC_CONFIG } as WebDAVProviderConfig;
}

/**
 * 结合用户设置的 readonly 标志，返回最终生效的配置。
 * 即使厂家支持写入，用户勾选了只读也不执行写入操作。
 */
export function getEffectiveConfig(
  serverUrl: string,
  userReadonly: boolean | undefined,
): WebDAVProviderConfig {
  const base: WebDAVProviderConfig = detectProvider(serverUrl);
  if (userReadonly) {
    return {
      ...base,
      allowWrite: false,
      autoUploadMetaJson: false,
      useMetadataFolder: false,
    };
  }
  return base;
}
