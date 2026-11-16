import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import TtrpgOnlineRoomPanel from '../../src/components/ttrpg/TtrpgOnlineRoomPanel'
import { AuthoritativeOnlineRoomV1, type OnlineRoomCommandV1 } from '../../src/lib/online/room-authority'
import { HttpOnlineRoomTransportV1 } from '../../src/lib/online/http-transport'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('the unchanged room UI shows a rejected send, retains the draft and allows a revised message on the same connection', async () => {
  const releaseHash = 'a'.repeat(64)
  const accepted: string[] = []
  const created = await AuthoritativeOnlineRoomV1.create({
    roomId: 'sfqa115.ui', releaseHash, gmDisplayName: 'GM',
    adapter: {
      apply: async ({ command }) => {
        accepted.push(command.requestId)
        return { eventType: 'room.chat.message', publicPayload: command.payload, resultingStateHash: 'b'.repeat(64) }
      },
      project: async () => null,
    },
  })
  let sends = 0
  let connectionReady!: () => void
  let acceptedRefreshReady!: () => void
  const connected = new Promise<void>(resolve => { connectionReady = resolve })
  const acceptedRefresh = new Promise<void>(resolve => { acceptedRefreshReady = resolve })
  const json = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload })
  const transport = new HttpOnlineRoomTransportV1({
    baseUrl: '/sfqa115-fixture',
    fetch: async (url, init) => {
      if (url.endsWith('/wait')) return new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
      if (url.endsWith('/members')) return json({ members: [created.gm.member] })
      if (url.endsWith('/commands')) {
        sends += 1
        if (sends === 1) return json({ code: 'domain_rejected', message: '请修改这条消息后重试' }, 400)
        return json(await created.room.submit(JSON.parse(init.body) as OnlineRoomCommandV1))
      }
      if (url.endsWith('/reconnect')) {
        const result = await created.room.reconnect(JSON.parse(init.body) as Parameters<AuthoritativeOnlineRoomV1['reconnect']>[0])
        if (sends === 0) connectionReady()
        if (sends === 2) acceptedRefreshReady()
        return json(result)
      }
      if (url.endsWith('/rooms')) return json({ roomId: created.room.roomId, releaseHash, ...created.gm, cursor: 0 })
      throw new Error(`Unexpected fixture route: ${url}`)
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const button = (label: string) => {
    const found = [...host.querySelectorAll('button')].find(element => element.textContent?.trim() === label)
    if (!found) throw new Error(`Missing button ${label}`)
    return found
  }
  const fill = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  try {
    await act(async () => root.render(createElement(TtrpgOnlineRoomPanel, { releaseHash, selectedCharacterKeys: ['player.1'], characterNames: { 'player.1': 'Player' }, transport })))
    await act(async () => fill(host.querySelector<HTMLInputElement>('[aria-label="托管服务访问凭据"]')!, 'fixture-access'))
    await act(async () => { button('创建并连接').click(); await connected; await settle() })
    expect(host.textContent).toContain('online · #0')
    const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="在线房间消息"]')!
    await act(async () => fill(textarea, '保留尚未采纳的草稿'))
    await act(async () => { button('发送').click(); await settle() })
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('请修改这条消息后重试')
    expect(textarea.value).toBe('保留尚未采纳的草稿')
    expect(accepted).toHaveLength(0)
    await act(async () => fill(textarea, '修改后的合法消息'))
    await act(async () => { button('发送').click(); await acceptedRefresh; await settle() })
    expect(textarea.value).toBe('')
    expect(host.textContent).toContain('online · #1')
    expect(sends).toBe(2)
    expect(accepted).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
