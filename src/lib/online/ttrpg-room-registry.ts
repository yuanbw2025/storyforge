import { hashProductProductionValueV2 } from '../product-production/hash'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import type { TtrpgRuntimeContentV1 } from '../types'
import {
  AuthoritativeOnlineRoomV1,
  OnlineRoomAuthorityError,
  type OnlineRoomPersistenceV1,
} from './room-authority'
import type { OnlineRoomAuthorityRegistryV1 } from './room-gateway'
import { DurableFormalTtrpgRoomAdapterV1 } from './ttrpg-durable-adapter'
import type { OnlineTtrpgAiPlayerServiceV1 } from './ttrpg-ai-player-service'
import type { OnlineTtrpgAiGmServiceV1 } from './ttrpg-ai-gm-service'

export interface HostedTtrpgReleaseRecordV1 {
  contentHash: string
  manifestJson: string
  status: 'published' | 'suspended' | 'withdrawn'
}

export interface HostedTtrpgReleaseStoreV1 {
  loadByContentHash(contentHash: string): Promise<HostedTtrpgReleaseRecordV1 | null>
}

export interface HostedOnlineRoomIdentityV1 {
  authorizeRoomCreation(input: {
    creatorAccessToken: string
    releaseHash: string
  }): Promise<{ userId: string; entitled: boolean; allowedToHost: boolean } | null>
  authenticateRoomMembership(input: {
    memberAccessToken: string
    roomId: string
  }): Promise<{ userId: string } | null>
}

/**
 * Deployment-owned key service. The same exact provisioning fingerprint must
 * return the same opaque, unguessable credential across processes; different
 * fingerprints must not collide. A production implementation should use a
 * versioned HMAC/KMS key and retain the prior key for the room recovery window.
 */
export interface HostedOnlineRoomCredentialIssuerV1 {
  issueStableGmCredential(input: {
    userId: string
    roomId: string
    releaseHash: string
    provisioningFingerprint: string
  }): Promise<string>
  /** Stable across devices/processes for the same account and room. */
  issueStableRoomSessionCredential(input: {
    userId: string
    roomId: string
    releaseHash: string
  }): Promise<string>
  issueStableInviteCredential(input: {
    requestId: string
    userId: string
    roomId: string
    releaseHash: string
    actorKey: string
    expiresAt: number
  }): Promise<{ inviteId: string; inviteToken: string }>
}

export interface HostedOnlineRoomPersistenceFactoryV1 {
  forRoom(roomId: string): OnlineRoomPersistenceV1
}

function fail(code: string, message: string): never {
  throw new OnlineRoomAuthorityError(code, message)
}

async function loadContent(input: {
  releases: HostedTtrpgReleaseStoreV1
  releaseHash: string
}): Promise<TtrpgRuntimeContentV1> {
  const record = await input.releases.loadByContentHash(input.releaseHash)
  if (!record || record.contentHash !== input.releaseHash || record.status !== 'published') {
    fail('release_mismatch', '正式 TTRPG ProductRelease 不存在或不可主持')
  }
  let raw: unknown
  try { raw = JSON.parse(record.manifestJson) } catch { fail('release_mismatch', 'ProductRelease manifest 不是合法 JSON') }
  if (await hashProductProductionValueV2(raw) !== record.contentHash) fail('release_mismatch', 'ProductRelease 内容 hash 不一致')
  const manifest = await verifyProductReleaseManifestV1(raw)
  if (manifest.productType !== 'ttrpg' || !manifest.runtimePackage.ttrpg) {
    fail('release_mismatch', 'ProductRelease 不是正式 TTRPG 产品')
  }
  return structuredClone(manifest.runtimePackage.ttrpg)
}

/**
 * Production composition root for the room gateway. It validates identity and
 * entitlement, loads a hash-addressed published release, creates the portable
 * durable adapter, and restores evicted rooms from their own CAS store.
 */
export class HostedFormalTtrpgRoomRegistryV1 implements OnlineRoomAuthorityRegistryV1 {
  private readonly cache = new Map<string, AuthoritativeOnlineRoomV1>()

  constructor(private readonly input: {
    releases: HostedTtrpgReleaseStoreV1
    identity: HostedOnlineRoomIdentityV1
    credentials: HostedOnlineRoomCredentialIssuerV1
    persistence: HostedOnlineRoomPersistenceFactoryV1
    maximumCachedRooms?: number
    maximumCommittedRolls?: number
    now?: () => number
    aiPlayerService?: OnlineTtrpgAiPlayerServiceV1 | null
    aiGmService?: OnlineTtrpgAiGmServiceV1 | null
  }) {
    const maximum = input.maximumCachedRooms ?? 1_000
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100_000) {
      fail('domain_configuration', 'maximumCachedRooms 无效')
    }
    if (input.maximumCommittedRolls != null
      && (!Number.isInteger(input.maximumCommittedRolls) || input.maximumCommittedRolls < 1
        || input.maximumCommittedRolls > 100_000)) {
      fail('domain_configuration', 'maximumCommittedRolls 无效')
    }
  }

  async load(roomId: string): Promise<AuthoritativeOnlineRoomV1 | null> {
    const cached = this.cache.get(roomId)
    if (cached) {
      this.cache.delete(roomId)
      this.cache.set(roomId, cached)
      return cached
    }
    const persistence = this.input.persistence.forRoom(roomId)
    const snapshot = await persistence.load(roomId)
    if (!snapshot) return null
    const content = await loadContent({ releases: this.input.releases, releaseHash: snapshot.releaseHash })
    const defaultRoster = content.campaign.characterTemplates
      .filter(item => item.role === 'player')
      .slice(0, content.campaign.playerCount.minimum)
      .map(item => item.characterKey)
    const adapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId, releaseHash: snapshot.releaseHash, content,
      selectedCharacterKeys: defaultRoster,
      maximumCommittedRolls: this.input.maximumCommittedRolls,
      aiPlayerService: this.input.aiPlayerService,
      aiGmService: this.input.aiGmService,
    })
    const room = await AuthoritativeOnlineRoomV1.restore({
      roomId, adapter, persistence, now: this.input.now,
    })
    this.remember(roomId, room)
    return room
  }

  async create(input: {
    requestId: string
    roomId: string
    releaseHash: string
    selectedCharacterKeys: string[]
    creatorAccessToken: string
    gmDisplayName: string
  }): Promise<{
    room: AuthoritativeOnlineRoomV1
    gm: Awaited<ReturnType<typeof AuthoritativeOnlineRoomV1.create>>['gm']
  }> {
    const identity = await this.input.identity.authorizeRoomCreation({
      creatorAccessToken: input.creatorAccessToken,
      releaseHash: input.releaseHash,
    })
    if (!identity) fail('unauthorized', '房间创建凭据无效或过期')
    if (!identity.entitled || !identity.allowedToHost) fail('forbidden', '账号没有该 Release 的主持权限')
    const provisioningFingerprint = await hashProductProductionValueV2({
      protocolVersion: 1,
      requestId: input.requestId,
      roomId: input.roomId,
      releaseHash: input.releaseHash,
      selectedCharacterKeys: input.selectedCharacterKeys,
      gmDisplayName: input.gmDisplayName.trim().normalize('NFC'),
      userId: identity.userId,
    })
    const gmAuthToken = await this.input.credentials.issueStableGmCredential({
      userId: identity.userId,
      roomId: input.roomId,
      releaseHash: input.releaseHash,
      provisioningFingerprint,
    })
    if (typeof gmAuthToken !== 'string' || !gmAuthToken.trim() || gmAuthToken.length > 500) {
      fail('domain_configuration', '主持凭据签发器返回无效凭据')
    }
    const persistence = this.input.persistence.forRoom(input.roomId)
    if (await persistence.load(input.roomId)) {
      return this.recoverProvisionedRoom(input.roomId, input.releaseHash, gmAuthToken)
    }
    const content = await loadContent({ releases: this.input.releases, releaseHash: input.releaseHash })
    const adapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: input.roomId, releaseHash: input.releaseHash, content,
      selectedCharacterKeys: input.selectedCharacterKeys,
      maximumCommittedRolls: this.input.maximumCommittedRolls,
      aiPlayerService: this.input.aiPlayerService,
      aiGmService: this.input.aiGmService,
    })
    let created: Awaited<ReturnType<typeof AuthoritativeOnlineRoomV1.create>>
    try {
      created = await AuthoritativeOnlineRoomV1.create({
        roomId: input.roomId, releaseHash: input.releaseHash,
        gmDisplayName: input.gmDisplayName, gmAuthToken,
        gmPrincipalBinding: identity.userId,
        adapter, persistence,
        now: this.input.now,
      })
    } catch (error) {
      // Two identical requests can race before either observes the first CAS.
      // The loser recovers the winner instead of creating a second room or
      // stranding the host after a lost HTTP response.
      if (error instanceof OnlineRoomAuthorityError && error.code === 'persistence_conflict') {
        return this.recoverProvisionedRoom(input.roomId, input.releaseHash, gmAuthToken)
      }
      throw error
    }
    this.remember(input.roomId, created.room)
    return created
  }

  async joinAuthenticated(input: {
    requestId: string
    roomId: string
    inviteId: string
    inviteToken: string
    memberAccessToken: string
    displayName: string
  }): Promise<{
    room: AuthoritativeOnlineRoomV1
    member: Awaited<ReturnType<AuthoritativeOnlineRoomV1['join']>>
  }> {
    const identity = await this.input.identity.authenticateRoomMembership({
      memberAccessToken: input.memberAccessToken,
      roomId: input.roomId,
    })
    if (!identity) fail('unauthorized', '账号访问凭据无效或过期')
    const room = await this.load(input.roomId)
    if (!room) fail('room_not_found', '在线房间不存在')
    const memberAuthToken = await this.input.credentials.issueStableRoomSessionCredential({
      userId: identity.userId,
      roomId: input.roomId,
      releaseHash: room.releaseHash,
    })
    if (typeof memberAuthToken !== 'string' || !memberAuthToken.trim() || memberAuthToken.length > 500) {
      fail('domain_configuration', '成员凭据签发器返回无效凭据')
    }
    const member = await room.join({
      inviteId: input.inviteId,
      inviteToken: input.inviteToken,
      displayName: input.displayName,
      principalBinding: identity.userId,
      memberAuthToken,
    })
    return { room, member }
  }

  async resumeAuthenticated(input: {
    roomId: string
    memberAccessToken: string
  }): Promise<{
    room: AuthoritativeOnlineRoomV1
    member: Awaited<ReturnType<AuthoritativeOnlineRoomV1['resumeMemberByPrincipal']>>
  }> {
    const identity = await this.input.identity.authenticateRoomMembership({
      memberAccessToken: input.memberAccessToken,
      roomId: input.roomId,
    })
    if (!identity) fail('unauthorized', '账号访问凭据无效或过期')
    const room = await this.load(input.roomId)
    if (!room) fail('room_not_found', '在线房间不存在')
    const memberAuthToken = await this.input.credentials.issueStableRoomSessionCredential({
      userId: identity.userId,
      roomId: input.roomId,
      releaseHash: room.releaseHash,
    })
    if (typeof memberAuthToken !== 'string' || !memberAuthToken.trim() || memberAuthToken.length > 500) {
      fail('domain_configuration', '成员凭据签发器返回无效凭据')
    }
    const member = await room.resumeMemberByPrincipal({
      principalBinding: identity.userId,
      memberAuthToken,
    })
    return { room, member }
  }

  /** Service-to-service bridge for accepted LFG seats; no GM token leaves the room service. */
  async issueMatchmakingInvite(input: {
    requestId: string
    roomId: string
    hostAccessToken: string
    expectedHostUserId: string
    actorKey: string
    expiresAt: number
  }): Promise<{ roomId: string; releaseHash: string; inviteId: string; inviteToken: string }> {
    const identity = await this.input.identity.authenticateRoomMembership({
      memberAccessToken: input.hostAccessToken, roomId: input.roomId,
    })
    if (!identity) fail('unauthorized', '主持账号凭据无效或过期')
    if (identity.userId !== input.expectedHostUserId) {
      fail('forbidden', '社区主持人与在线房间账号不一致')
    }
    const room = await this.load(input.roomId)
    if (!room) fail('room_not_found', '在线房间不存在')
    const gmSessionCredential = await this.input.credentials.issueStableRoomSessionCredential({
      userId: identity.userId, roomId: input.roomId, releaseHash: room.releaseHash,
    })
    const gm = await room.resumeMemberByPrincipal({
      principalBinding: identity.userId, memberAuthToken: gmSessionCredential,
    })
    if (gm.member.role !== 'gm') fail('forbidden', '只有房间 GM 可以绑定组团席位')
    const stable = await this.input.credentials.issueStableInviteCredential({
      requestId: input.requestId, userId: identity.userId, roomId: input.roomId,
      releaseHash: room.releaseHash, actorKey: input.actorKey, expiresAt: input.expiresAt,
    })
    if (!stable || typeof stable.inviteId !== 'string'
      || !/^invite\.[A-Za-z0-9._:-]+$/.test(stable.inviteId)
      || typeof stable.inviteToken !== 'string' || !stable.inviteToken.trim()
      || stable.inviteToken.length > 500) {
      fail('domain_configuration', '稳定邀请签发器返回无效凭据')
    }
    const invite = await room.issueInvite({
      gmMemberId: gm.member.memberId, gmAuthToken: gm.authToken,
      role: 'player', actorKey: input.actorKey, expiresAt: input.expiresAt, maximumUses: 1,
      stableInvite: stable,
    })
    return { roomId: room.roomId, releaseHash: room.releaseHash, ...invite }
  }

  /** Test/operations hook: eviction never deletes the durable room. */
  evict(roomId: string): void {
    this.cache.delete(roomId)
  }

  private remember(roomId: string, room: AuthoritativeOnlineRoomV1): void {
    this.cache.delete(roomId)
    this.cache.set(roomId, room)
    const maximum = this.input.maximumCachedRooms ?? 1_000
    while (this.cache.size > maximum) {
      const oldest = this.cache.keys().next().value as string | undefined
      if (!oldest) break
      this.cache.delete(oldest)
    }
  }

  private async recoverProvisionedRoom(
    roomId: string,
    releaseHash: string,
    gmAuthToken: string,
  ): Promise<{
    room: AuthoritativeOnlineRoomV1
    gm: Awaited<ReturnType<typeof AuthoritativeOnlineRoomV1.create>>['gm']
  }> {
    const room = await this.load(roomId)
    if (!room || room.releaseHash !== releaseHash) {
      fail('request_conflict', 'roomId 已由其他发布或创建请求占用')
    }
    try {
      const resumed = await room.resumeGmWithCredential(gmAuthToken)
      return { room, gm: { member: resumed.member, authToken: resumed.authToken } }
    } catch (error) {
      if (error instanceof OnlineRoomAuthorityError && error.code === 'unauthorized') {
        fail('request_conflict', 'roomId 已由其他创建请求占用；请重连或使用新房间号')
      }
      throw error
    }
  }
}
