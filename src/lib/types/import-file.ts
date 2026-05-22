/**
 * 导入文件 Blob 持久化记录（Phase 18 方案 A）
 *
 * 2026-05-12 新增。
 *
 * 把用户上传的原文以 Blob 形式存到 IndexedDB，解决「浏览器关了就要重新上传」的糙点。
 * 每个未完成 session 对应一个 blob；session 完成 / 被放弃后会被清理。
 *
 * 容量评估：
 *   · 1.6M 字 ≈ 3 MB UTF-8 → 忽略
 *   · 1000 万字 ≈ 20-30 MB → 仍在 IndexedDB 默认额度内
 *   · 启动时会调 navigator.storage.persist() 让浏览器不随便回收
 */
export interface ImportFileBlob {
  /** 主键 = ImportSession.id */
  sessionId: number
  filename: string
  fileSize: number
  /** 文件 SHA256 短 hash（冗余存一份，和 session.fileHash 同步） */
  fileHash: string
  /** 原始文件内容 */
  blob: Blob
  createdAt: number
}
