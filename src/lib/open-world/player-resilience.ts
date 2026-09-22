export type TextOpenWorldPlayerIssueStateV1 =
  | 'recoverable-error'
  | 'blocking-error'
  | 'degraded'

export type TextOpenWorldPlayerIssueSurfaceV1 =
  | 'library-load'
  | 'runtime-load'
  | 'runtime-operation'
  | 'optional-ai'

export type TextOpenWorldPlayerPhaseV1 =
  | 'loading'
  | 'empty'
  | 'ready'
  | 'recoverable-error'
  | 'blocking-error'

export type TextOpenWorldGameplayAvailabilityV1 = 'enabled' | 'read-only' | 'blocked'

export type TextOpenWorldPlayerRecoveryActionV1 =
  | 'reload-library'
  | 'refresh-session'
  | 'resume-settlement'
  | 'return-library'
  | 'dismiss'

export interface TextOpenWorldPlayerIssueV1 {
  state: TextOpenWorldPlayerIssueStateV1
  code:
    | 'TOW-PLAYER-LOAD'
    | 'TOW-PLAYER-STALE'
    | 'TOW-PLAYER-UNKNOWN-RESULT'
    | 'TOW-PLAYER-STORAGE'
    | 'TOW-PLAYER-INTEGRITY'
    | 'TOW-PLAYER-OPTIONAL-AI'
    | 'TOW-PLAYER-OPERATION'
  title: string
  message: string
  guidance: string
  retryAllowed: boolean
  gameplayAvailability: TextOpenWorldGameplayAvailabilityV1
  recoveryActions: readonly TextOpenWorldPlayerRecoveryActionV1[]
}

const includesAny = (value: string, markers: readonly string[]): boolean => (
  markers.some(marker => value.includes(marker))
)

const STALE_MARKERS = [
  '确认基线已变化', '状态已变化', '状态已经变化', '过期的session事件基线',
  'stale', 'base sequence', 'basesequence',
] as const

const UNKNOWN_RESULT_MARKERS = [
  '结果未知', 'unknown-result', 'unknown result', 'outcome unknown',
] as const

const OPTIONAL_AI_MARKERS = [
  'api key', 'apikey', 'provider', '模型不可用', '模型服务', '模型请求',
  '余额不足', '额度不足', '配额已用完', 'insufficient balance', 'provider quota',
  'quota exceeded', 'rate limit', '429', '401', '402', 'fetch failed',
  'network error', 'network timeout', '请求超时', '网络连接',
] as const

const STORAGE_MARKERS = [
  'quotaexceedederror', 'indexeddb', 'database is closed', 'databaseclosederror',
  '浏览器存储', '本地存储', '磁盘空间', '存储空间',
] as const

const INTEGRITY_MARKERS = [
  '运行投影与冻结产品来源不一致', 'productrelease 与生产谱系不一致',
  '运行包与', '运行包缺少', '运行包无效', 'runtimepackage',
  '内容hash', '状态hash', 'hash与', 'hash不一致', '哈希不一致',
  '事件流与缓存头不一致', '重放状态不一致', '包络与投影不一致',
  '没有绑定有效的 product build 或 productrelease', '该存档不是文字开放世界',
  '该存档不属于当前世界分组', '文字开放世界session不存在',
  'schema/version无效', 'schema/version不符合', '疑似被篡改', '完整性校验',
] as const

/**
 * Converts internal diagnostics into a bounded player-facing recovery state.
 * The raw diagnostic is deliberately never returned: runtime keys, hashes and
 * database identities belong in developer diagnostics, not the game surface.
 */
export function classifyTextOpenWorldPlayerIssueV1(input: {
  error: unknown
  surface: TextOpenWorldPlayerIssueSurfaceV1
}): TextOpenWorldPlayerIssueV1 | null {
  const raw = input.error instanceof Error ? input.error.message : String(input.error ?? '')
  const normalized = raw.normalize('NFC').trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return null

  if (includesAny(normalized, STORAGE_MARKERS)) {
    return {
      state: 'blocking-error',
      code: 'TOW-PLAYER-STORAGE',
      title: '本地存储暂时不可写',
      message: '播放器无法安全保存新的游戏事件，因此已经暂停会改变进度的操作。',
      guidance: '请释放浏览器存储空间或恢复本地数据库访问，然后重新核对当前存档。',
      retryAllowed: true,
      gameplayAvailability: 'blocked',
      recoveryActions: ['refresh-session', 'return-library'],
    }
  }

  if (includesAny(normalized, INTEGRITY_MARKERS)) {
    return {
      state: 'blocking-error',
      code: 'TOW-PLAYER-INTEGRITY',
      title: '存档或运行包未通过安全核对',
      message: '当前来源、事件或状态证据不一致，播放器已停止写入，避免进一步损坏进度。',
      guidance: '请返回游戏库选择其他存档或版本；确认来源恢复后再重新核对。',
      retryAllowed: true,
      gameplayAvailability: 'blocked',
      recoveryActions: ['refresh-session', 'return-library'],
    }
  }

  if (input.surface !== 'optional-ai' && includesAny(normalized, UNKNOWN_RESULT_MARKERS)) {
    return {
      state: 'recoverable-error',
      code: 'TOW-PLAYER-UNKNOWN-RESULT',
      title: '需要核对上一次操作',
      message: '上一次请求的最终结果尚未确认。为避免重复执行，播放器不会自动重新提交。',
      guidance: '请使用“核对并恢复”读取当前时间线；系统只会续结已经记录的同一项操作。',
      retryAllowed: true,
      gameplayAvailability: 'read-only',
      recoveryActions: ['resume-settlement', 'return-library'],
    }
  }

  if (input.surface !== 'optional-ai' && includesAny(normalized, STALE_MARKERS)) {
    return {
      state: 'recoverable-error',
      code: 'TOW-PLAYER-STALE',
      title: '游戏状态已经更新',
      message: '这项操作基于较早的游戏状态，未在新状态上重复执行。',
      guidance: '核对最新时间线后重新选择目标；已经落盘的事件不会重复写入。',
      retryAllowed: true,
      gameplayAvailability: 'read-only',
      recoveryActions: ['refresh-session', 'return-library'],
    }
  }

  if (input.surface === 'optional-ai' || includesAny(normalized, OPTIONAL_AI_MARKERS)) {
    return {
      state: 'degraded',
      code: 'TOW-PLAYER-OPTIONAL-AI',
      title: '可选 AI 表现暂不可用',
      message: '模型、网络或账户额度当前不可用，但确定性玩法、地图、任务、战斗和存档仍可继续。',
      guidance: '可以继续游玩；需要 AI 表现时再检查网络、模型配置或账户额度。',
      retryAllowed: false,
      gameplayAvailability: 'enabled',
      recoveryActions: ['dismiss'],
    }
  }

  if (input.surface === 'library-load' || input.surface === 'runtime-load') {
    return {
      state: 'recoverable-error',
      code: 'TOW-PLAYER-LOAD',
      title: input.surface === 'library-load' ? '游戏库暂时无法读取' : '存档暂时无法载入',
      message: input.surface === 'library-load'
        ? '本地游戏发布与存档没有完整载入。'
        : '当前存档没有完整载入，尚未开放任何会改变进度的操作。',
      guidance: '请重新加载；如果仍然失败，可以返回游戏库选择其他存档。',
      retryAllowed: true,
      gameplayAvailability: 'read-only',
      recoveryActions: input.surface === 'library-load'
        ? ['reload-library']
        : ['refresh-session', 'return-library'],
    }
  }

  return {
    state: 'recoverable-error',
    code: 'TOW-PLAYER-OPERATION',
    title: '操作未能完成',
    message: '当前操作没有得到可安全展示的完成结果。',
    guidance: '请先核对最新时间线，再决定是否重新操作。',
    retryAllowed: true,
    gameplayAvailability: 'read-only',
    recoveryActions: ['refresh-session', 'return-library'],
  }
}

export function textOpenWorldUnsupportedRuntimeIssueV1(): TextOpenWorldPlayerIssueV1 {
  return {
    state: 'blocking-error',
    code: 'TOW-PLAYER-INTEGRITY',
    title: '这个存档暂时不能运行',
    message: '存档存在，但它的冻结运行包与当前玩家投影不能组成受支持的文字开放世界。',
    guidance: '请返回游戏库选择其他存档或版本；播放器不会猜测或改写这份存档。',
    retryAllowed: true,
    gameplayAvailability: 'blocked',
    recoveryActions: ['refresh-session', 'return-library'],
  }
}

export function textOpenWorldProjectionUnavailableIssueV1(): TextOpenWorldPlayerIssueV1 {
  return {
    state: 'blocking-error',
    code: 'TOW-PLAYER-INTEGRITY',
    title: '运行状态未通过一致性核对',
    message: '当前事件时间线与玩家状态不能形成同一份可信快照，播放器已停止写入。',
    guidance: '请重新核对当前存档；如果问题持续存在，请返回游戏库选择其他存档。',
    retryAllowed: true,
    gameplayAvailability: 'blocked',
    recoveryActions: ['refresh-session', 'return-library'],
  }
}

export function projectTextOpenWorldPlayerPhaseV1(input: {
  loading: boolean
  hasPlayableContent: boolean
  issue: TextOpenWorldPlayerIssueV1 | null
}): TextOpenWorldPlayerPhaseV1 {
  if (input.loading) return 'loading'
  if (input.issue?.state === 'blocking-error') return 'blocking-error'
  if (input.issue?.state === 'recoverable-error') return 'recoverable-error'
  return input.hasPlayableContent ? 'ready' : 'empty'
}
