/**
 * WebDAV Provider 抽象接口
 *
 * 定义各云存储厂家 WebDAV 实现的行为差异。
 * 每个 provider 只需实现自己的策略，由 providerConfig.ts 根据 URL 自动匹配。
 *
 * 拓展方式：在 providers/ 目录下新建文件实现该接口，
 * 然后在 providerConfig.ts 的 detectProvider 中增加域名匹配。
 */

export interface WebDAVProvider {
  /** 厂家显示名称 */
  readonly name: string;

  /** 文件头 Range 读取是否直连服务器（不走 CDN 重定向），减少首载请求数 */
  useDirectHeaderRead(): boolean;

  /** 是否使用 Metadata/ 文件夹统一缓存元数据+封面 */
  useMetadataFolder(): boolean;

  /** 是否允许写入操作（PUT） */
  allowWrite(): boolean;

  /** 慢路径解析后是否自动上传 .meta.json 副产物文件 */
  autoUploadMetaJson(): boolean;

  /** 批量拉取文件头的并发数 */
  batchSize(): number;
}
