/**
 * AI 连接日志系统
 * 记录所有 API 调用的详细信息，方便排错
 */

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AILogEntry {
  id: string
  timestamp: number
  type: 'test' | 'chat' | 'stream'
  provider: string
  url: string
  model: string
  status: 'pending' | 'success' | 'error'
  statusCode?: number
  errorMessage?: string
  responseBody?: string
  responseSummary?: string
  duration?: number
  usage?: TokenUsage
}

/**
 * 仅在内存中伴随日志存在的脱敏上下文；这些值不会进入 AILogEntry，
 * 因而不会被日志面板、格式化输出或未来的导出逻辑读取。
 */
export interface AILogRedactionContext {
  sensitiveValues?: readonly (string | null | undefined)[]
  baseUrl?: string | null
}

const MAX_LOGS = 50
const REDACTED = '[REDACTED]'
const ENDPOINT_UNAVAILABLE = '[endpoint unavailable]'
let logs: AILogEntry[] = []
let listeners: Array<() => void> = []
const redactionContexts = new Map<string, { sensitiveValues: string[]; baseUrl: string | null }>()

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 日志 URL 只保留协议、主机和端口，绝不保留凭证、路径、查询或 fragment。 */
export function sanitizeAILogUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return ENDPOINT_UNAVAILABLE
    return url.origin
  } catch {
    return ENDPOINT_UNAVAILABLE
  }
}

function sanitizeEmbeddedUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    return sanitizeAILogUrl(candidate)
  })
}

function sanitizeText(
  value: string,
  context?: { sensitiveValues: readonly string[]; baseUrl: string | null },
): string {
  let sanitized = value

  if (context?.baseUrl) {
    const safeBaseUrl = sanitizeAILogUrl(context.baseUrl)
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(context.baseUrl), 'g'),
      safeBaseUrl,
    )
  }

  for (const sensitive of [...(context?.sensitiveValues ?? [])].sort((a, b) => b.length - a.length)) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(sensitive), 'g'), REDACTED)
  }

  sanitized = sanitizeEmbeddedUrls(sanitized)
  sanitized = sanitized
    .replace(/\b(Bearer|Basic)\s+[^\s,"';}\]]+/gi, `$1 ${REDACTED}`)
    .replace(
      /((?:"|')(?:api[-_]?key|x-api-key|authorization|access[-_]?token|secret(?:[-_]?key)?|password|token)(?:"|')\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /(\b(?:api[-_]?key|x-api-key|authorization|access[-_]?token|secret(?:[-_]?key)?|password|token)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b(?:sk|ak)-[A-Za-z0-9._-]{8,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{16,}\b/g, REDACTED)

  return sanitized
}

function normalizeRedactionContext(context?: AILogRedactionContext) {
  const sensitiveValues = [...new Set(
    (context?.sensitiveValues ?? [])
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )]
  return {
    sensitiveValues,
    baseUrl: typeof context?.baseUrl === 'string' && context.baseUrl.length > 0
      ? context.baseUrl
      : null,
  }
}

function sanitizeLogEntry<T extends Partial<AILogEntry>>(
  entry: T,
  context?: { sensitiveValues: readonly string[]; baseUrl: string | null },
): T {
  const sanitized = { ...entry }
  if (typeof sanitized.url === 'string') {
    const origin = sanitizeAILogUrl(sanitized.url)
    const redactedOrigin = sanitizeText(origin, context)
    sanitized.url = (redactedOrigin.includes(REDACTED) ? ENDPOINT_UNAVAILABLE : redactedOrigin) as T['url']
  }
  for (const key of ['provider', 'model', 'errorMessage', 'responseBody', 'responseSummary'] as const) {
    const value = sanitized[key]
    if (typeof value === 'string') sanitized[key] = sanitizeText(value, context) as T[typeof key]
  }
  if (sanitized.usage) sanitized.usage = { ...sanitized.usage }
  return sanitized
}

function forgetRedactionContext(id: string): void {
  const context = redactionContexts.get(id)
  if (context) {
    context.sensitiveValues.fill('')
    context.baseUrl = null
  }
  redactionContexts.delete(id)
}

/** 创建一条新日志 */
export function createLog(
  entry: Omit<AILogEntry, 'id' | 'timestamp'>,
  redaction?: AILogRedactionContext,
): AILogEntry {
  const id = generateId()
  const context = normalizeRedactionContext(redaction)
  redactionContexts.set(id, context)
  const log = sanitizeLogEntry<AILogEntry>({
    ...entry,
    id,
    timestamp: Date.now(),
  }, context)
  const nextLogs = [log, ...logs].slice(0, MAX_LOGS)
  for (const dropped of logs) {
    if (!nextLogs.some(candidate => candidate.id === dropped.id)) forgetRedactionContext(dropped.id)
  }
  logs = nextLogs
  notify()
  return { ...log, ...(log.usage ? { usage: { ...log.usage } } : {}) }
}

/** 更新日志 */
export function updateLog(id: string, update: Partial<AILogEntry>) {
  const context = redactionContexts.get(id)
  const sanitizedUpdate = sanitizeLogEntry(update, context)
  logs = logs.map((l) => (l.id === id ? { ...l, ...sanitizedUpdate, id: l.id, timestamp: l.timestamp } : l))
  notify()
}

/** 获取所有日志 */
export function getLogs(): AILogEntry[] {
  return logs.map(log => sanitizeLogEntry(log, redactionContexts.get(log.id)))
}

/** 清空日志 */
export function clearLogs() {
  for (const id of redactionContexts.keys()) forgetRedactionContext(id)
  logs = []
  notify()
}

/** 订阅日志变化 */
export function subscribeLogs(listener: () => void) {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function notify() {
  listeners.forEach((l) => l())
}

/** 格式化日志为可读文本 */
export function formatLog(entry: AILogEntry): string {
  const safeEntry = sanitizeLogEntry(entry, redactionContexts.get(entry.id))
  const time = new Date(safeEntry.timestamp).toLocaleTimeString('zh-CN')
  const status = safeEntry.status === 'success' ? '✅' : safeEntry.status === 'error' ? '❌' : '⏳'
  const dur = safeEntry.duration ? ` (${safeEntry.duration}ms)` : ''
  let line = `${status} [${time}] ${safeEntry.type.toUpperCase()} → ${safeEntry.provider} ${safeEntry.url}${dur}`
  if (safeEntry.statusCode) line += ` HTTP ${safeEntry.statusCode}`
  if (safeEntry.usage) line += `\n   Token: ↑${safeEntry.usage.inputTokens} ↓${safeEntry.usage.outputTokens} = ${safeEntry.usage.totalTokens}`
  if (safeEntry.responseSummary) line += `\n   响应: ${safeEntry.responseSummary}`
  if (safeEntry.errorMessage) line += `\n   错误: ${safeEntry.errorMessage}`
  return line
}
