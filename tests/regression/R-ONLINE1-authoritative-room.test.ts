import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
  type OnlineRoomDomainAdapterV1,
} from '../../src/lib/online/room-authority'

function adapter(): OnlineRoomDomainAdapterV1 {
  const publicHistory: unknown[] = []
  return {
    apply: async ({ sequence, command, member }) => {
      const publicPayload = command.kind === 'dice.request'
        ? { actorKey: command.actorKey, dice: [((sequence * 5) % 6) + 1], serverResolved: true }
        : { kind: command.kind, actorKey: command.actorKey, acceptedBy: member.memberId }
      publicHistory.push(publicPayload)
      return {
        eventType: `room.${command.kind}`,
        publicPayload,
        gmPrivatePayload: { gmSecret: `secret-at-${sequence}` },
        privatePayloadByMemberId: { [member.memberId]: { ownReceipt: sequence } },
        resultingStateHash: await hashCanonicalValue(publicHistory),
      }
    },
    project: async ({ sequence, member }) => ({
      sequence,
      publicHistory,
      ...(member.role === 'gm' ? { gmSecretState: 'server-only-secret' } : {}),
    }),
  }
}

function command(input: {
  roomId: string
  releaseHash: string
  requestId: string
  memberId: string
  authToken: string
  expectedSequence: number
  kind: OnlineRoomCommandV1['kind']
  actorKey?: string | null
  payload?: unknown
}): OnlineRoomCommandV1 {
  return {
    protocolVersion: 1,
    roomId: input.roomId,
    releaseHash: input.releaseHash,
    requestId: input.requestId,
    memberId: input.memberId,
    authToken: input.authToken,
    expectedSequence: input.expectedSequence,
    kind: input.kind,
    actorKey: input.actorKey ?? null,
    payload: input.payload ?? {},
  }
}

describe('PLATFORM-1B · authoritative online room core', () => {
  it('在线桌面移动绑定玩家席位，迷雾和图层保持 GM 权威', async () => {
    const releaseHash = '9'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.tabletop', releaseHash, gmDisplayName: '主持人', adapter: adapter(),
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: 'player.1', expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '玩家' })
    const base = {
      roomId: created.room.roomId, releaseHash, memberId: player.member.memberId,
      authToken: player.authToken, expectedSequence: 0,
    }
    await expect(created.room.submit(command({
      ...base, requestId: 'tabletop.spoof', kind: 'tabletop.move', actorKey: 'player.2',
    }))).rejects.toThrow('自己角色')
    await expect(created.room.submit(command({
      ...base, requestId: 'tabletop.fog.player', kind: 'tabletop.fog', actorKey: 'player.1',
    }))).rejects.toThrow('只允许 GM')
    await expect(created.room.submit(command({
      ...base, requestId: 'tabletop.move.player', kind: 'tabletop.move', actorKey: 'player.1',
      payload: { tokenKey: 'token.player.1', x: 40, y: 60 },
    }))).resolves.toMatchObject({ acceptedSequence: 1 })
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'tabletop.fog.gm',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 1, kind: 'tabletop.fog', payload: { fogKey: 'fog.scene.1', revealed: true },
    }))).resolves.toMatchObject({ acceptedSequence: 2 })
  })

  it('邀请绑定席位，服务端拒绝身份、Release、角色和 GM 权限伪造', async () => {
    let now = 1_800_000_000_000
    const releaseHash = 'a'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.alpha', releaseHash, gmDisplayName: '主持人', adapter: adapter(), now: () => now,
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: 'player.1', expiresAt: now + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '玩家甲' })
    await expect(created.room.join({ ...invite, displayName: '重放邀请' })).rejects.toThrow('邀请不存在、已过期或凭据无效')

    const base = {
      roomId: created.room.roomId, releaseHash, requestId: 'request.1',
      memberId: player.member.memberId, authToken: player.authToken, expectedSequence: 0,
    }
    await expect(created.room.submit(command({ ...base, authToken: 'forged.token', kind: 'dice.request', actorKey: 'player.1' })))
      .rejects.toThrow('成员凭据无效')
    await expect(created.room.submit(command({ ...base, releaseHash: 'b'.repeat(64), kind: 'dice.request', actorKey: 'player.1' })))
      .rejects.toThrow('过期 ProductRelease')
    await expect(created.room.submit(command({ ...base, kind: 'dice.request', actorKey: 'player.2' })))
      .rejects.toThrow('自己的已分配角色')
    await expect(created.room.submit(command({ ...base, kind: 'scene.open' })))
      .rejects.toThrow('只允许 GM')
    now += 1
    const accepted = await created.room.submit(command({ ...base, kind: 'dice.request', actorKey: 'player.1', payload: { expression: '2d6' } }))
    expect(accepted).toMatchObject({ acceptedSequence: 1, duplicate: false })
    expect(accepted.event.publicPayload).toMatchObject({ actorKey: 'player.1', serverResolved: true })
    expect(JSON.stringify(accepted)).not.toContain('secret-at-1')
  })

  it('requestId 幂等、sequence 冲突和断线重连都不产生双事件或秘密越权', async () => {
    const releaseHash = 'c'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.reconnect', releaseHash, gmDisplayName: '主持人', adapter: adapter(),
    })
    const playerInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: 'player.1', expiresAt: Date.now() + 60_000,
    })
    const spectatorInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'spectator', expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...playerInvite, displayName: '玩家' })
    const spectator = await created.room.join({ ...spectatorInvite, displayName: '观战者' })
    const firstCommand = command({
      roomId: created.room.roomId, releaseHash, requestId: 'idempotent.1',
      memberId: player.member.memberId, authToken: player.authToken,
      expectedSequence: 0, kind: 'rule.action', actorKey: 'player.1', payload: { actionKey: 'investigate' },
    })
    const first = await created.room.submit(firstCommand)
    const duplicate = await created.room.submit(firstCommand)
    expect(duplicate).toMatchObject({ acceptedSequence: first.acceptedSequence, duplicate: true })
    await expect(created.room.submit({ ...firstCommand, payload: { actionKey: 'strike' } }))
      .rejects.toThrow('requestId 已被不同命令使用')
    await expect(created.room.submit(command({
      ...firstCommand, requestId: 'stale.1', expectedSequence: 0,
    }))).rejects.toThrow('房间已推进到 #1')

    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'gm.scene.1',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 1, kind: 'scene.open', payload: { sceneKey: 'scene.next' },
    }))
    await created.room.disconnect(player.member.memberId, player.authToken)
    const reconnected = await created.room.reconnect({
      memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
    })
    expect(reconnected.cursor).toBe(2)
    expect(reconnected.events.map(event => event.sequence)).toEqual([1, 2])
    expect(JSON.stringify(reconnected)).not.toContain('secret-at-')
    expect(JSON.stringify(reconnected.projection)).not.toContain('server-only-secret')

    const gmReconnect = await created.room.reconnect({
      memberId: created.gm.member.memberId, authToken: created.gm.authToken, afterSequence: 1,
    })
    expect(JSON.stringify(gmReconnect)).toContain('secret-at-2')
    expect(JSON.stringify(gmReconnect.projection)).toContain('server-only-secret')
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'spectator.dice',
      memberId: spectator.member.memberId, authToken: spectator.authToken,
      expectedSequence: 2, kind: 'dice.request', actorKey: 'player.1',
    }))).rejects.toThrow('观战者不能提交游戏命令')
  })

  it('速率限制在领域适配器之前 fail-closed', async () => {
    let now = 1_800_000_000_000
    const releaseHash = 'd'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.rate', releaseHash, gmDisplayName: '主持人', adapter: adapter(),
      now: () => now, rateLimit: { commands: 1, windowMs: 10_000 },
    })
    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'gm.1',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 0, kind: 'chat.message', payload: { text: '一' },
    }))
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'gm.2',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 1, kind: 'chat.message', payload: { text: '二' },
    }))).rejects.toThrow('命令速率超过')
    now += 10_001
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'gm.3',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 1, kind: 'chat.message', payload: { text: '三' },
    }))).resolves.toMatchObject({ acceptedSequence: 2 })
  })
})
