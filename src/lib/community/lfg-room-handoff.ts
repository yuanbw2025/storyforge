import { hashProductProductionValueV2 } from '../product-production/hash'
import type { HostedFormalTtrpgRoomRegistryV1 } from '../online/ttrpg-room-registry'
import {
  CommunityAuthorityErrorV1,
  type CommunityPlatformAuthorityV1,
  type CommunityPrincipalV1,
} from './authority'

export interface CommunityLfgRoomHandoffRecordV1 {
  schema: 'storyforge.lfg-room-handoff'
  version: 1
  applicationId: string
  postId: string
  applicantId: string
  roomId: string
  releaseHash: string
  actorKey: string
  secretId: string
  expiresAt: number
  createdAt: number
}

export interface CommunityLfgRoomHandoffPersistenceV1 {
  load(applicationId: string): Promise<CommunityLfgRoomHandoffRecordV1 | null>
  putIfAbsent(record: CommunityLfgRoomHandoffRecordV1): Promise<'created' | 'identical' | 'conflict'>
}

/** Secret bytes live in a deployment KMS/secret store, never in community snapshots or audit events. */
export interface CommunityLfgRoomSecretVaultV1 {
  putIfAbsent(input: { secretId: string; plaintext: string; contextHash: string }): Promise<'created' | 'identical' | 'conflict'>
  read(input: { secretId: string; contextHash: string }): Promise<string | null>
}

export class InMemoryCommunityLfgRoomHandoffPersistenceV1 implements CommunityLfgRoomHandoffPersistenceV1 {
  private readonly records = new Map<string, CommunityLfgRoomHandoffRecordV1>()
  async load(applicationId: string) {
    const row = this.records.get(applicationId)
    return row ? structuredClone(row) : null
  }
  async putIfAbsent(record: CommunityLfgRoomHandoffRecordV1) {
    const prior = this.records.get(record.applicationId)
    if (prior) {
      const left = JSON.stringify(prior)
      const right = JSON.stringify({ ...record, createdAt: prior.createdAt })
      return left === right ? 'identical' as const : 'conflict' as const
    }
    this.records.set(record.applicationId, structuredClone(record))
    return 'created' as const
  }
}

export class InMemoryCommunityLfgRoomSecretVaultV1 implements CommunityLfgRoomSecretVaultV1 {
  private readonly secrets = new Map<string, { plaintext: string; contextHash: string }>()
  async putIfAbsent(input: { secretId: string; plaintext: string; contextHash: string }) {
    const prior = this.secrets.get(input.secretId)
    if (prior) return prior.plaintext === input.plaintext && prior.contextHash === input.contextHash
      ? 'identical' as const : 'conflict' as const
    this.secrets.set(input.secretId, structuredClone(input))
    return 'created' as const
  }
  async read(input: { secretId: string; contextHash: string }) {
    const row = this.secrets.get(input.secretId)
    return row?.contextHash === input.contextHash ? row.plaintext : null
  }
}

type CommunityHandoffPolicyV1 = Pick<CommunityPlatformAuthorityV1,
  'authorizeRoomHandoffForHost' | 'authorizeRoomHandoffForApplicant'>
type OnlineHandoffIssuerV1 = Pick<HostedFormalTtrpgRoomRegistryV1, 'issueMatchmakingInvite'>

function stable(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new CommunityAuthorityErrorV1('protocol', `${label} 无效`)
  }
  return value
}
function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new CommunityAuthorityErrorV1('protocol', `${label} 必须是 sha256`)
  }
  return value
}

export class CommunityLfgRoomHandoffServiceV1 {
  constructor(private readonly input: {
    community: CommunityHandoffPolicyV1
    online: OnlineHandoffIssuerV1
    persistence: CommunityLfgRoomHandoffPersistenceV1
    vault: CommunityLfgRoomSecretVaultV1
    now?: () => number
  }) {}

  async bindAcceptedSeats(input: {
    principal: CommunityPrincipalV1
    hostAccessToken: string
    requestId: string
    postId: string
    roomId: string
    releaseHash: string
    expiresAt: number
    bindings: Array<{ applicationId: string; actorKey: string }>
  }): Promise<Array<Omit<CommunityLfgRoomHandoffRecordV1, 'secretId'>>> {
    const requestId = stable(input.requestId, 'requestId')
    const postId = stable(input.postId, 'postId')
    const roomId = stable(input.roomId, 'roomId')
    const releaseHash = sha(input.releaseHash, 'releaseHash')
    if (typeof input.hostAccessToken !== 'string' || input.hostAccessToken.length < 16 || input.hostAccessToken.length > 2_000
      || !Number.isInteger(input.expiresAt) || input.expiresAt <= (this.input.now?.() ?? Date.now())
      || input.expiresAt > (this.input.now?.() ?? Date.now()) + 7 * 24 * 60 * 60 * 1_000
      || !Array.isArray(input.bindings) || input.bindings.length < 1 || input.bindings.length > 20) {
      throw new CommunityAuthorityErrorV1('protocol', '房间交接参数无效')
    }
    const authorized = this.input.community.authorizeRoomHandoffForHost({
      principal: input.principal, postId, releaseHash,
    })
    const accepted = new Map(authorized.acceptedApplications.map(row => [row.applicationId, row]))
    const normalized = input.bindings.map((binding, index) => ({
      applicationId: stable(binding?.applicationId, `bindings[${index}].applicationId`),
      actorKey: stable(binding?.actorKey, `bindings[${index}].actorKey`),
    }))
    if (new Set(normalized.map(row => row.applicationId)).size !== normalized.length
      || new Set(normalized.map(row => row.actorKey)).size !== normalized.length
      || normalized.some(row => !accepted.has(row.applicationId))) {
      throw new CommunityAuthorityErrorV1('forbidden', '只能为本招募已接受申请分配唯一角色席位')
    }
    const results: Array<Omit<CommunityLfgRoomHandoffRecordV1, 'secretId'>> = []
    for (const binding of normalized) {
      const application = accepted.get(binding.applicationId)!
      const invite = await this.input.online.issueMatchmakingInvite({
        requestId: `${requestId}.${binding.applicationId}`, roomId,
        hostAccessToken: input.hostAccessToken, expectedHostUserId: input.principal.userId,
        actorKey: binding.actorKey, expiresAt: input.expiresAt,
      })
      if (invite.releaseHash !== releaseHash || invite.roomId !== roomId) {
        throw new CommunityAuthorityErrorV1('room_mismatch', '在线房间与招募 Release 不匹配')
      }
      const context = {
        postId, applicationId: binding.applicationId, applicantId: application.userId,
        roomId, releaseHash, actorKey: binding.actorKey, expiresAt: input.expiresAt,
      }
      const contextHash = await hashProductProductionValueV2(context)
      const secretId = `secret.lfg-room.${contextHash}`
      const secretResult = await this.input.vault.putIfAbsent({
        secretId, contextHash,
        plaintext: JSON.stringify({ inviteId: invite.inviteId, inviteToken: invite.inviteToken }),
      })
      if (secretResult === 'conflict') throw new CommunityAuthorityErrorV1('handoff_conflict', '房间邀请密钥发生冲突')
      const createdAt = this.input.now?.() ?? Date.now()
      const record: CommunityLfgRoomHandoffRecordV1 = {
        schema: 'storyforge.lfg-room-handoff', version: 1, ...context, secretId, createdAt,
      }
      const stored = await this.input.persistence.putIfAbsent(record)
      if (stored === 'conflict') throw new CommunityAuthorityErrorV1('handoff_conflict', '申请已绑定其他房间或角色')
      const { secretId: _secretId, ...publicRecord } = record
      results.push(publicRecord)
    }
    return results
  }

  async claimForApplicant(input: {
    principal: CommunityPrincipalV1
    applicationId: string
  }): Promise<{
    applicationId: string
    roomId: string
    releaseHash: string
    actorKey: string
    inviteId: string
    inviteToken: string
    displayName: string
    expiresAt: number
  }> {
    const applicationId = stable(input.applicationId, 'applicationId')
    const authorized = this.input.community.authorizeRoomHandoffForApplicant({
      principal: input.principal, applicationId,
    })
    const record = await this.input.persistence.load(applicationId)
    if (!record) throw new CommunityAuthorityErrorV1('handoff_missing', '主持人尚未分配在线房间席位')
    if (record.postId !== authorized.post.postId || record.applicantId !== authorized.application.userId
      || record.releaseHash !== authorized.post.releaseHash || record.expiresAt <= (this.input.now?.() ?? Date.now())) {
      throw new CommunityAuthorityErrorV1('handoff_invalid', '房间交接已过期或与申请不一致')
    }
    const contextHash = await hashProductProductionValueV2({
      postId: record.postId, applicationId, applicantId: record.applicantId,
      roomId: record.roomId, releaseHash: record.releaseHash, actorKey: record.actorKey,
      expiresAt: record.expiresAt,
    })
    const plaintext = await this.input.vault.read({ secretId: record.secretId, contextHash })
    if (!plaintext) throw new CommunityAuthorityErrorV1('handoff_invalid', '房间邀请密钥不可用')
    let secret: unknown
    try { secret = JSON.parse(plaintext) } catch { throw new CommunityAuthorityErrorV1('handoff_invalid', '房间邀请密钥损坏') }
    if (!secret || typeof secret !== 'object' || Array.isArray(secret)
      || typeof (secret as Record<string, unknown>).inviteId !== 'string'
      || typeof (secret as Record<string, unknown>).inviteToken !== 'string') {
      throw new CommunityAuthorityErrorV1('handoff_invalid', '房间邀请密钥结构无效')
    }
    return {
      applicationId, roomId: record.roomId, releaseHash: record.releaseHash, actorKey: record.actorKey,
      inviteId: (secret as { inviteId: string }).inviteId,
      inviteToken: (secret as { inviteToken: string }).inviteToken,
      displayName: authorized.profile.displayName, expiresAt: record.expiresAt,
    }
  }
}
