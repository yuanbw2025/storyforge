/**
 * AI 连接日志系统
 * 记录所有 API 调用的详细信息，方便排错
 */

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
  duration?: number
}

const MAX_LOGS = 50
let logs: AILogEntry[] = []
let listeners: Array<() => void> = []

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 创建一条新日志 */
export function createLog(entry: Omit<AILogEntry, 'id' | 'timestamp'>): AILogEntry {
  const log: AILogEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
  }
  logs = [log, ...logs].slice(0, MAX_LOGS)
  notify()
  return log
}

/** 更新日志 */
export function updateLog(id: string, update: Partial<AILogEntry>) {
  logs = logs.map((l) => (l.id === id ? { ...l, ...update } : l))
  notify()
}

/** 获取所有日志 */
export function getLogs(): AILogEntry[] {
  return logs
}

/** 清空日志 */
export function clearLogs() {
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
  const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN')
  const status = entry.status === 'success' ? '✅' : entry.status === 'error' ? '❌' : '⏳'
  const dur = entry.duration ? ` (${entry.duration}ms)` : ''
  let line = `${status} [${time}] ${entry.type.toUpperCase()} → ${entry.provider} ${entry.url}${dur}`
  if (entry.statusCode) line += ` HTTP ${entry.statusCode}`
  if (entry.errorMessage) line += `\n   错误: ${entry.errorMessage}`
  return line
}
