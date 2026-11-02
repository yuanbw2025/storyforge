import { describe, expect, it, vi } from 'vitest'
import { AuthoritativeOnlineRoomV1, OnlineRoomAuthorityError } from '../../src/lib/online/room-authority'
import { OnlineRoomClientV1, type OnlineRoomTransportV1 } from '../../src/lib/online/room-client'

async function fixture() {
  const history: string[] = []
  const releaseHash = 'a'.repeat(64)
  const created = await AuthoritativeOnlineRoomV1.create({
    roomId: 'sfqa115', releaseHash, gmDisplayName: 'GM',
    adapter: {
      apply: async ({ command }) => {
        if (command.kind === 'intent.submit') throw new OnlineRoomAuthorityError('domain_rejected', '请修订当前意图')
        history.push(command.requestId)
        return { eventType: 'room.chat.message', publicPayload: {}, resultingStateHash: 'b'.repeat(64) }
      },
      project: async () => [...history],
    },
  })
  const invite = await created.room.issueInvite({ gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken, role: 'player', actorKey: 'player.1', expiresAt: Date.now() + 60_000 })
  const player = await created.room.join({ ...invite, displayName: 'Player' })
  const transport: OnlineRoomTransportV1 = {
    submit: vi.fn(command => created.room.submit(command)),
    reconnect: vi.fn(input => created.room.reconnect(input)),
  }
  const client = new OnlineRoomClientV1({ roomId: created.room.roomId, releaseHash, memberId: player.member.memberId, authToken: player.authToken, actorKey: 'player.1' }, transport)
  return { client, transport, history }
}

describe('SFQA115: definitive rejection cannot permanently block an outbox', () => {
  it.each([
    ['domain_rejected', 'intent.submit'], ['forbidden', 'gm.narrate'],
  ] as const)('retains a %s failure receipt, lets the author revise, and sends the next legal command', async (code, kind) => {
    const { client, transport, history } = await fixture()
    await client.connect()
    await expect(client.enqueue({ requestId: 'rejected.request', kind, payload: {} })).rejects.toMatchObject({ code, requestId: 'rejected.request' })
    expect(client.inspect()).toMatchObject({ connection: 'online', pendingRequestIds: [], lastErrorCode: code, cursor: 0 })
    await client.recover()
    expect(transport.submit).toHaveBeenCalledTimes(1)
    const next = await client.enqueue({ requestId: 'revised.request', kind: 'chat.message', payload: { text: 'revised' } })
    expect(next).toMatchObject({ connection: 'online', cursor: 1, pendingRequestIds: [], lastErrorCode: null })
    expect(history).toEqual(['revised.request'])
  })

  it('also releases a rejected offline command during connect so a later queued command can proceed', async () => {
    const { client, history } = await fixture()
    await client.enqueue({ requestId: 'offline.rejected', kind: 'intent.submit', payload: {} })
    await client.enqueue({ requestId: 'offline.valid', kind: 'chat.message', payload: { text: 'valid' } })
    await expect(client.connect()).rejects.toMatchObject({ code: 'domain_rejected', requestId: 'offline.rejected' })
    expect(client.inspect()).toMatchObject({ connection: 'online', pendingRequestIds: ['offline.valid'] })
    expect(await client.recover()).toMatchObject({ connection: 'online', pendingRequestIds: [], cursor: 1 })
    expect(history).toEqual(['offline.valid'])
  })

  it('does not relabel an accepted command as rejected when its projection refresh is forbidden', async () => {
    const { client, transport, history } = await fixture()
    await client.connect()
    vi.mocked(transport.reconnect).mockRejectedValueOnce(new OnlineRoomAuthorityError('forbidden', 'projection temporarily denied'))
    const accepted = await client.enqueue({ requestId: 'accepted.request', kind: 'chat.message', payload: {} })
    expect(accepted).toMatchObject({ connection: 'error', pendingRequestIds: [], cursor: 1, lastErrorCode: 'forbidden' })
    expect(await client.recover()).toMatchObject({ connection: 'online', pendingRequestIds: [], cursor: 1 })
    expect(history).toEqual(['accepted.request'])
    expect(transport.submit).toHaveBeenCalledTimes(1)
  })
})
