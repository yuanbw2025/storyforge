/**
 * 高危操作前强制备份(数据安全红线)
 *
 * 设计原则:任何可能丢用户数据的操作都必须经此入口,要么强制备份要么二次确认。
 *
 * 适用场景:
 *   - 删项目(deleteProject)
 *   - 删世界组(deleteGroup)
 *   - 启用多世界(migrateToMultiWorld,因为它会修改 schema 归属)
 *   - 覆盖式导入(importProjectJSON 时若目标项目已存在)
 *   - 还原快照(restoreSnapshot)
 *   - 其它任何"不可逆"操作
 *
 * 用法:
 *   const proceed = await requireBackupBefore({
 *     operation: '删除项目',
 *     projectId: 123,
 *     details: '删除后所有数据不可恢复',
 *   })
 *   if (!proceed) return  // 用户取消,不执行
 *   await deleteProject(123)  // 用户已备份或显式跳过备份
 */

import { exportProjectJSON } from '../export/json-export'

export interface RequireBackupOptions {
  /** 操作名称(显示给用户) */
  operation: string
  /** 项目 ID(为 null/undefined 时不做"立即备份本项目",仅二次确认) */
  projectId?: number | null
  /** 详细说明(显示在弹窗) */
  details?: string
  /** 自定义确认按钮文案(默认"我已备份,继续") */
  confirmLabel?: string
  /** 自定义取消按钮文案(默认"取消") */
  cancelLabel?: string
}

export type BackupChoice =
  | 'proceed-already-backed-up'  // 用户声明已备份,继续
  | 'proceed-backup-now'          // 用户选择立即备份后继续(已下载 JSON)
  | 'cancel'                       // 用户取消

/**
 * 显示弹窗并返回用户选择。
 *
 * 当前实现:浏览器原生 confirm(简单可靠,纯前端 0 依赖)。
 * Phase 2/3 可替换为更友好的模态框 UI(BackupConfirmModal 组件)。
 */
export async function requireBackupBefore(
  options: RequireBackupOptions,
): Promise<boolean> {
  // 测试环境:自动放行(不阻塞反例测试)
  if (isTestEnv()) {
    return true
  }
  const choice = await promptUserChoice(options)

  switch (choice) {
    case 'cancel':
      console.info(`[Safety] 用户取消高危操作: ${options.operation}`)
      return false

    case 'proceed-backup-now':
      if (options.projectId != null) {
        try {
          await downloadProjectBackup(options.projectId, options.operation)
          console.info(`[Safety] 已下载备份,继续高危操作: ${options.operation}`)
        } catch (err) {
          console.error('[Safety] 备份下载失败,中止操作', err)
          // 备份失败时拒绝操作,保护用户数据
          const proceedAnyway = window.confirm(
            `备份下载失败:${(err as Error).message}\n\n仍要继续高危操作"${options.operation}"吗?(强烈不建议)`
          )
          if (!proceedAnyway) return false
        }
      }
      return true

    case 'proceed-already-backed-up':
      console.info(`[Safety] 用户声明已备份,继续高危操作: ${options.operation}`)
      return true
  }
}

/**
 * 弹窗交互(三选项)。
 *
 * 浏览器原生 confirm 只支持两选项,所以拆成两步:
 *   第一步:显示"是否已备份?"(确认 / 取消)
 *     取消 → cancel
 *     确认 → 第二步
 *   第二步:显示"立即下载备份 还是 跳过?"(确认 / 取消)
 *     确认 → proceed-backup-now
 *     取消 → proceed-already-backed-up(用户声明已自己备份了)
 *
 * 更友好的 UI 见 Phase 2/3 替换。
 */
async function promptUserChoice(options: RequireBackupOptions): Promise<BackupChoice> {
  const banner = `⚠️ 危险操作:${options.operation}`
  const detail = options.details ? `\n\n${options.details}` : ''

  const proceed = window.confirm(
    `${banner}${detail}\n\n` +
    `此操作不可恢复。是否继续?\n\n` +
    `✅ 确定 = 继续(下一步会询问是否立即备份)\n` +
    `❌ 取消 = 终止本次操作`
  )
  if (!proceed) return 'cancel'

  if (options.projectId == null) {
    // 不绑项目的高危操作(如全局清理),只做二次确认
    return 'proceed-already-backed-up'
  }

  const wantBackup = window.confirm(
    `📦 是否立即下载备份(JSON 文件到本地)?\n\n` +
    `✅ 确定 = 立即下载备份,然后继续\n` +
    `❌ 取消 = 我已经备份过,直接继续`
  )

  return wantBackup ? 'proceed-backup-now' : 'proceed-already-backed-up'
}

/**
 * 导出项目 JSON 并触发浏览器下载。
 */
async function downloadProjectBackup(projectId: number, operation: string): Promise<void> {
  const data = await exportProjectJSON(projectId)
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeOp = operation.replace(/[^\w一-龥-]/g, '_')
  a.download = `storyforge-backup-before-${safeOp}-${timestamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // 释放内存(下个 tick,确保下载已触发)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/**
 * 简化辅助:仅做"是否继续"二次确认(不强制备份)。
 *
 * 适用于"风险较低但不可逆"的操作。
 */
export async function requireConfirmation(message: string): Promise<boolean> {
  if (isTestEnv()) return true
  return Promise.resolve(window.confirm(message))
}

/**
 * 测试环境检测(vitest 自动设置 NODE_ENV=test;happy-dom 中 process 可用)。
 */
function isTestEnv(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
  } catch {
    return false
  }
}
