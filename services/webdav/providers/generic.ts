/**
 * 通用 WebDAV Provider
 *
 * 默认实现：CDN 重定向后读 Range，不支持写入，不使用 Metadata/ 文件夹。
 * 当无法识别具体云存储厂家时使用此配置，安全兜底。
 */

import { WebDAVProvider } from '../baseProvider';

export function createGenericProvider(): WebDAVProvider {
  return {
    name: '通用 WebDAV',
    useDirectHeaderRead: () => false,
    useMetadataFolder: () => false,
    allowWrite: () => false,
    autoUploadMetaJson: () => false,
    batchSize: () => 10,
  };
}
