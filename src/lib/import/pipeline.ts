/**
 * 大文档分块导入流水线（Phase 18）
 *
 * 设计目标：让百万字～千万字小说也能稳定解析入库，并保证：
 *   · 每块即时写库（标签切走、刷新页面、断电都不丢已解析数据）
 *   · 单块失败自动重试 3 次，全失败后整体失败仍可手动重试
 *   · 支持暂停 / 恢复 / 取消
 *   · 状态、进度、日志全程通过 useImportStatusStore 暴露给 UI
 *   · 每 N 块 + 终末跑一次 AI 跨块角色合并，避免"一个人多个名"
 *
 * 严格串行（用户授权："慢点就慢点，保证不断就行"）。
 *
 * 本文件只负责"总控流"：
 *   · 持久化到单块 DB（chunk-writer.ts）
 *   · 结果累积 / 规范化 / 报告（unified-merge.ts）
 *   · AbortSignal 包装的 chat（chat-with-abort.ts）
 *   · AI 跨块角色合并（character-merge.ts）
 */

import { renderPrompt } from '../ai/prompt-engine'
import { usePromptStore } from '../../stores/prompt'
import { useAIConfigStore } from '../../stores/ai-config'
import { useImportSessionStore } from '../../stores/import-session'
import { useImportStatusStore } from '../../stores/import-status'
import { extractJSON, IMPORT_MAX_TOKENS } from '../ai/adapters/import-adapter'
import type { UnifiedParseResult } from '../types'
import type { AIConfig } from '../types'
import type { ImportSession, ChunkState } from '../types'
import {
  registerChunkTexts as _registerChunkTexts,
  hasChunkTexts as _hasChunkTexts,
  clearChunkTexts as _clearChunkTexts,
  getChunkText,
} from './chunk-text-registry'
import {
  mergeUnified, buildRollingContext, normalizeUnified, buildFinalReport,
} from './unified-merge'
import { applyChunkResult, type ApplyChunkCounts } from './chunk-writer'
import { useReferenceStore } from '../../stores/reference'
import { chatWithAbort } from './chat-with-abort'
import { runCharacterMerge } from './character-merge'

// 保留原有 API：UI / 其他模块一直从 pipeline 引入这三个函数。
export const registerChunkTexts = _registerChunkTexts
export const hasChunkTexts = _hasChunkTexts
export const clearChunkTexts = _clearChunkTexts

/** 跨块合并的触发周期 */
const MERGE_EVERY_N = 10

/** 单块最大重试次数（用户已批准 3 次） */
const MAX_ATTEMPTS = 3

/** 重试之间等多久（避免触发 rate limit），毫秒 */
const RETRY_DELAY_MS = 1500

/** 控制器：用户暂停 / 取消时切给 pipeline */
let activeController: AbortController | null = null
let activePauseFlag = { paused: false }

export function pausePipeline() {
  activePauseFlag.paused = true
  activeController?.abort()
  useImportStatusStore.getState().setPhase('paused')
  useImportStatusStore.getState().pushActivity('warn', '⏸ 用户暂停')
}

export function cancelPipeline() {
  activeController?.abort()
  activePauseFlag.paused = true
  useImportStatusStore.getState().setPhase('idle')
  useImportStatusStore.getState().pushActivity('warn', '✕ 用户取消任务')
}

export function isPipelineRunning() {
  return activeController !== null && !activePauseFlag.paused
}

/** 暴露给 UI：跑一次完整的流水线（新会话 或 续跑现有会话） */
export async function runSession(args: {
  sessionId: number
  projectId: number
}): Promise<void> {
  const { sessionId, projectId } = args
  const sessionStore = useImportSessionStore.getState()
  const statusStore = useImportStatusStore.getState()

  // 拉最新 session
  let session = await sessionStore.load(sessionId)
  if (!session) throw new Error(`找不到导入会话 #${sessionId}`)

  // 重置控制
  activeController = new AbortController()
  activePauseFlag = { paused: false }

  statusStore.attachSession({
    sessionId,
    filename: session.filename,
    totalChunks: session.totalChunks,
    finishedChunks: session.chunks.filter(c => c.status === 'done').length,
    failedChunks: session.chunks.filter(c => c.status === 'failed').length,
    phase: 'running',
  })
  statusStore.pushActivity('info',
    `▶ 开始处理「${session.filename}」共 ${session.totalChunks} 块`)
  await sessionStore.patch(sessionId, { status: 'running' })
  await sessionStore.log(sessionId, -1, 'info',
    `开始处理：共 ${session.totalChunks} 块，已完成 ${
      session.chunks.filter(c => c.status === 'done').length} 块`)

  try {
    let processedSinceMerge = 0

    for (const chunk of session.chunks) {
      // 已完成的跳过
      if (chunk.status === 'done') continue
      // 检查暂停 / 取消
      if (activePauseFlag.paused) {
        await sessionStore.patch(sessionId, { status: 'paused' })
        statusStore.pushActivity('warn', '已暂停，可点恢复继续')
        return
      }

      session = await sessionStore.load(sessionId) // 重新读一次（防外部修改）
      if (!session) return

      const ok = await runChunk(session, chunk.index, projectId)
      if (ok) processedSinceMerge++

      // 每 N 块跑一次合并
      if (processedSinceMerge >= MERGE_EVERY_N) {
        processedSinceMerge = 0
        if (!activePauseFlag.paused) {
          await runCharacterMerge({
            sessionId,
            projectId,
            isFinal: false,
            signal: activeController?.signal,
            isPaused: () => activePauseFlag.paused,
          })
        }
      }
    }

    if (activePauseFlag.paused) return

    // 终末合并 + 收尾
    await runCharacterMerge({
      sessionId,
      projectId,
      isFinal: true,
      signal: activeController?.signal,
      isPaused: () => activePauseFlag.paused,
    })

    const fresh = await sessionStore.load(sessionId)
    if (!fresh) return
    const failedCount = fresh.chunks.filter(c => c.status === 'failed').length
    const doneCount = fresh.chunks.filter(c => c.status === 'done').length

    const report = buildFinalReport(fresh)

    // 项目参考模式：把累积的 merged 数据写入 references 表
    if (fresh.importTarget === 'reference' && doneCount > 0) {
      try {
        await useReferenceStore.getState().addReference({
          projectId,
          title: fresh.filename.replace(/\.[^.]+$/, ''),
          author: '',
          type: 'story',
          note: `从「${fresh.filename}」导入 · ${fresh.totalChars.toLocaleString()} 字`,
          url: '',
          importedData: {
            worldview: fresh.merged?.worldview,
            characters: fresh.merged?.characters,
            outline: fresh.merged?.outline,
            writingTechniques: fresh.merged?.writingTechniques,
            sourceFilename: fresh.filename,
            importedAt: Date.now(),
          },
        })
        statusStore.pushActivity('success', '📚 已保存到「项目参考」')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        statusStore.pushActivity('error', `保存项目参考失败：${msg}`)
      }
    }

    await sessionStore.patch(sessionId, {
      status: failedCount === 0 ? 'done' : 'failed',
      finalReport: report,
      fatalError: failedCount > 0
        ? `${failedCount} 个块在重试 ${MAX_ATTEMPTS} 次后仍失败`
        : undefined,
    })
    statusStore.setPhase(failedCount === 0 ? 'done' : 'failed')
    statusStore.pushActivity(failedCount === 0 ? 'success' : 'warn',
      `任务结束：成功 ${doneCount} 块，失败 ${failedCount} 块`)
    if (failedCount > 0) {
      statusStore.setFatalError(`${failedCount} 个块多次重试仍失败，可在面板内单独重试这些块。`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as Error).name === 'AbortError') {
      statusStore.pushActivity('warn', '已中止')
      return
    }
    await sessionStore.patch(sessionId, { status: 'failed', fatalError: msg })
    statusStore.setPhase('failed')
    statusStore.setFatalError(msg)
    statusStore.pushActivity('error', `任务异常终止：${msg}`)
  } finally {
    activeController = null
  }
}

/** 跑单个 chunk，返回是否成功 */
async function runChunk(
  session: ImportSession,
  chunkIndex: number,
  projectId: number,
): Promise<boolean> {
  const sessionStore = useImportSessionStore.getState()
  const statusStore = useImportStatusStore.getState()
  const chunkState = session.chunks.find(c => c.index === chunkIndex)!

  // 重新切出本块原文（session 没保存原文，由调用方上传时已切；
  // 但因 session 不保存原文，我们让 ImportDocPanel 在 runSession 前把切好的文本
  // 缓存到 module 层的 IN_MEM_CHUNK_TEXT 里）
  const text = getChunkText(session.id!, chunkIndex)
  if (!text) {
    await sessionStore.patchChunk(session.id!, chunkIndex, {
      status: 'failed',
      errorMessage: '内存里找不到本块原文（页面刷新后续跑需重新上传同一文件）',
      attempts: chunkState.attempts,
      finishedAt: Date.now(),
    })
    statusStore.markChunkFinished({ success: false })
    statusStore.pushActivity('error',
      `块 ${chunkIndex + 1} 无原文，跳过（请重新上传文件以续跑）`, chunkIndex)
    await sessionStore.log(session.id!, chunkIndex, 'error', '原文丢失，跳过')
    return false
  }

  for (let attempt = chunkState.attempts; attempt < MAX_ATTEMPTS; attempt++) {
    if (activePauseFlag.paused) return false

    statusStore.setActiveChunk(chunkIndex, attempt + 1)
    await sessionStore.patchChunk(session.id!, chunkIndex, {
      status: 'running',
      attempts: attempt + 1,
      startedAt: chunkState.startedAt || Date.now(),
    })

    const attemptNo = attempt + 1
    statusStore.pushActivity('info',
      `▶ 块 ${chunkIndex + 1}/${session.totalChunks} 解析中（第 ${attemptNo} 次）`,
      chunkIndex)
    await sessionStore.log(session.id!, chunkIndex, 'info',
      `第 ${attemptNo} 次尝试 · ${chunkState.charCount.toLocaleString()} 字`)

    try {
      const result = await parseChunkOnce({
        chunkIndex,
        totalChunks: session.totalChunks,
        knownContext: session.rollingContext || '（尚无已识别上下文）',
        rawDocument: text,
        signal: activeController?.signal,
      })

      // 入库（仅"导入当前项目"时写入项目表；"导入项目参考"只累积到 merged）
      let counts: ApplyChunkCounts
      if (session.importTarget === 'reference') {
        // 项目参考模式：不写项目表，只统计
        const wvFields = result.worldview ? Object.keys(result.worldview).filter(k => {
          const v = result.worldview![k]; return typeof v === 'string' && v.trim()
        }).length : 0
        counts = {
          worldviewFields: wvFields,
          characters: Array.isArray(result.characters) ? result.characters.length : 0,
          outlineNodes: Array.isArray(result.outline) ? result.outline.length : 0,
        }
      } else {
        counts = await applyChunkResult(projectId, result)
      }

      // 更新 session.merged 和 rollingContext
      const merged = mergeUnified(session.merged || {}, result)
      const rolling = buildRollingContext(merged)

      await sessionStore.patchChunk(session.id!, chunkIndex, {
        status: 'done',
        errorMessage: undefined,
        extractedCounts: counts,
        finishedAt: Date.now(),
      })
      await sessionStore.patch(session.id!, { merged, rollingContext: rolling })

      statusStore.markChunkFinished({ success: true })
      statusStore.pushActivity('success',
        `✓ 块 ${chunkIndex + 1} 完成 · 入库 世界观${counts.worldviewFields}/角色${counts.characters}/大纲${counts.outlineNodes}`,
        chunkIndex)
      await sessionStore.log(session.id!, chunkIndex, 'success',
        `成功：世界观+${counts.worldviewFields} 角色+${counts.characters} 大纲+${counts.outlineNodes}`)
      return true
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false
      const msg = err instanceof Error ? err.message : String(err)
      statusStore.pushActivity('warn',
        `块 ${chunkIndex + 1} 第 ${attemptNo} 次失败：${msg.slice(0, 80)}`, chunkIndex)
      await sessionStore.log(session.id!, chunkIndex, 'warn',
        `第 ${attemptNo} 次失败：${msg}`)
      await sessionStore.patchChunk(session.id!, chunkIndex, {
        status: 'pending',
        errorMessage: msg,
      })
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_DELAY_MS)
      } else {
        // 最终失败
        await sessionStore.patchChunk(session.id!, chunkIndex, {
          status: 'failed',
          finishedAt: Date.now(),
        })
        statusStore.markChunkFinished({ success: false })
        statusStore.pushActivity('error',
          `✗ 块 ${chunkIndex + 1} 重试 ${MAX_ATTEMPTS} 次仍失败：${msg.slice(0, 80)}`,
          chunkIndex)
        await sessionStore.log(session.id!, chunkIndex, 'error',
          `最终失败：${msg}`)
        return false
      }
    }
  }
  return false
}

/** 调一次 AI 解析一个 chunk */
async function parseChunkOnce(args: {
  chunkIndex: number
  totalChunks: number
  knownContext: string
  rawDocument: string
  signal?: AbortSignal
}): Promise<UnifiedParseResult> {
  const tpl = usePromptStore.getState().getActive('import.parse-chunk')
  const { messages } = renderPrompt(tpl, {
    chunkIndex: args.chunkIndex + 1,
    totalChunks: args.totalChunks,
    knownContext: args.knownContext.slice(0, 2000),
    rawDocument: args.rawDocument,
  })
  const baseConfig = useAIConfigStore.getState().config
  const overrideMax = Math.max(baseConfig.maxTokens ?? 4096, IMPORT_MAX_TOKENS.all)
  const config: AIConfig = { ...baseConfig, maxTokens: overrideMax }
  if (!config.apiKey) throw new Error('未配置 AI API Key')

  const output = await chatWithAbort(messages, config, args.signal)
  const obj = extractJSON(output) as UnifiedParseResult
  return normalizeUnified(obj)
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/** 单独重试某个失败的块（用户在 ReportModal 里点的"重试失败块"） */
export async function retryFailedChunks(args: {
  sessionId: number
  projectId: number
}): Promise<void> {
  const { sessionId, projectId } = args
  const sessionStore = useImportSessionStore.getState()
  const session = await sessionStore.load(sessionId)
  if (!session) return
  // 把失败的重置成 pending 并清空 attempts
  const chunks: ChunkState[] = session.chunks.map(c =>
    c.status === 'failed'
      ? { ...c, status: 'pending', attempts: 0, errorMessage: undefined }
      : c,
  )
  await sessionStore.patch(sessionId, { chunks, status: 'running', fatalError: undefined })
  await runSession({ sessionId, projectId })
}
