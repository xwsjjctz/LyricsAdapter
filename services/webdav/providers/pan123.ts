/**
 * 123云盘 (123pan) WebDAV Provider
 *
 * 123pan 的特点：
 * - 文件头读取直连服务器，不走 CDN 重定向（减少请求次数）
 * - 使用 Metadata/ 文件夹统一缓存（与 123pan 的限制兼容）
 * - 并发限制极低（batchSize=4）
 */

import { WebDAVProvider } from '../baseProvider';

export function createPan123Provider(): WebDAVProvider {
  return {
    name: '123云盘',
    useDirectHeaderRead: () => true,
    useMetadataFolder: () => true,
    allowWrite: () => true,
    autoUploadMetaJson: () => false,
    batchSize: () => 4,
  };
}
