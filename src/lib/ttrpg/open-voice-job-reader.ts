/** Bounded original-job metadata reader. It has no launch or retry endpoint. */
import profile from '../../../scripts/ttrpg-local-tts/product-profile.json'
import { requestText } from './open-local-voice-transport'
import type { TtrpgOpenVoiceJobIdentityV1 } from './open-voice-job-read-state'
import * as p from './open-contract-parse'

const PREFIX = '/storyforge/local-tts/v1/jobs/'
const STATES = ['waiting-for-slot', 'launch-recorded', 'running', 'running-observed', 'unknown', 'generated',
  'failed', 'cancelled-before-start', 'cancelled-before-spawn', 'cancelled-confirmed', 'not-found', 'stop-requested-without-job'] as const
export interface TtrpgOpenVoiceJobStatusV1 {
  jobKey: string; status: typeof STATES[number]; canStart: boolean; cancellationConfirmed: boolean
  inputArtifactHash?: string; profileHash?: string; cancellationRequested?: boolean; futureStartBlocked?: boolean
  hasResultFile?: boolean; workerExecutionKind?: 'pinned-offline-worker' | 'injected-test-worker'; automaticRetryAllowed?: false
}
export interface TtrpgOpenVoiceJobReaderV1 {
  kind: 'original-local-voice-job-reader-v1'
  read: (identity: TtrpgOpenVoiceJobIdentityV1, signal?: AbortSignal) => Promise<TtrpgOpenVoiceJobStatusV1>
}
export type TtrpgOpenVoiceJobControlIdentityV1 = Omit<TtrpgOpenVoiceJobIdentityV1, 'profileHash'> & { profileHash?: string }
export function parseTtrpgOpenVoiceJobStatusForKernelV1(value: unknown, identity: TtrpgOpenVoiceJobControlIdentityV1): TtrpgOpenVoiceJobStatusV1 {
  const r = p.object(value, 'original local voice job status')
  const fields = ['jobKey','status','canStart','cancellationConfirmed','inputArtifactHash','profileHash','cancellationRequested','futureStartBlocked','hasResultFile','workerExecutionKind','automaticRetryAllowed']
  if (Object.keys(r).some(key => !fields.includes(key)) || r.jobKey !== identity.jobKey) p.fail('本机状态不属于原准确任务')
  const status = p.oneOf(r.status, STATES, 'local job state'), canStart = p.bool(r.canStart, 'backend slot availability')
  const cancellationConfirmed = p.bool(r.cancellationConfirmed, 'observed cancellation')
  if (status === 'not-found' || status === 'stop-requested-without-job') {
    if (canStart || cancellationConfirmed || Object.keys(r).some(key => !['jobKey','status','canStart','cancellationConfirmed','futureStartBlocked'].includes(key))) p.fail('缺失任务不能冒充已经确认停止')
    const futureStartBlocked = r.futureStartBlocked === undefined ? false : p.bool(r.futureStartBlocked, 'future launch barrier')
    if (futureStartBlocked !== (status === 'stop-requested-without-job')) p.fail('缺失任务的停止屏障不一致')
    return { jobKey: identity.jobKey, status, canStart: false, cancellationConfirmed: false, futureStartBlocked }
  }
  if (r.inputArtifactHash !== identity.inputArtifactHash || identity.profileHash !== undefined && r.profileHash !== identity.profileHash
    || r.automaticRetryAllowed !== false) p.fail('本机状态更换了原输入、版本或重试边界')
  if (canStart && status !== 'waiting-for-slot' || cancellationConfirmed !== ['cancelled-before-start','cancelled-before-spawn','cancelled-confirmed'].includes(status)) p.fail('本机状态与启动或真实停止证明矛盾')
  return { jobKey: identity.jobKey, status, canStart, cancellationConfirmed,
    inputArtifactHash: p.hash(r.inputArtifactHash, 'original job input'), profileHash: p.hash(r.profileHash, 'original job profile'),
    cancellationRequested: p.bool(r.cancellationRequested, 'requested cancellation'), hasResultFile: p.bool(r.hasResultFile, 'file presence only'), automaticRetryAllowed: false,
    ...(r.futureStartBlocked === undefined ? {} : { futureStartBlocked: p.bool(r.futureStartBlocked, 'future launch barrier') }),
    ...(r.workerExecutionKind === undefined ? {} : { workerExecutionKind: p.oneOf(r.workerExecutionKind, ['pinned-offline-worker','injected-test-worker'], 'worker evidence kind') }) }
}
export function createTtrpgOpenVoiceJobReaderV1(): TtrpgOpenVoiceJobReaderV1 {
  return { kind: 'original-local-voice-job-reader-v1', read: async (identity, signal) => {
    // Capture the original identity before fetch yields to caller code.
    const frozen = { jobKey: identity.jobKey, inputArtifactHash: p.hash(identity.inputArtifactHash, 'original input'), profileHash: p.hash(identity.profileHash, 'original profile') }
    if (!/^ttrpg\.voice\.[1-9][0-9]*\.[a-f0-9]{64}$/.test(frozen.jobKey) || !frozen.jobKey.endsWith('.' + frozen.inputArtifactHash)) p.fail('原任务标识无效')
    return parseTtrpgOpenVoiceJobStatusForKernelV1(JSON.parse(await requestText(PREFIX + encodeURIComponent(frozen.jobKey), {}, signal, 65536, profile.statusRequestTimeoutMs)), frozen)
  } }
}
