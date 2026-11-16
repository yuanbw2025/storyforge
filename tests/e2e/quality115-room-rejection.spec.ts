import { expect, test } from '@playwright/test'

test('the real online room panel keeps a rejected draft and accepts its revision without reconnecting', async ({ page }) => {
  const modules: Record<string, string> = {}
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (path.endsWith('/react.js')) modules.react = response.url()
    if (path.endsWith('/react-dom_client.js')) modules.dom = response.url()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  await page.getByTestId('home-page').waitFor()
  expect(modules.react).toBeTruthy()
  expect(modules.dom).toBeTruthy()
  await page.evaluate(async modules => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<Record<string, unknown>>
    const reactModule = await load(modules.react), domModule = await load(modules.dom)
    const react = (reactModule.default ?? reactModule) as typeof import('react')
    const dom = (domModule.default ?? domModule) as typeof import('react-dom/client')
    const { default: Panel } = await load('/storyforge/src/components/ttrpg/TtrpgOnlineRoomPanel.tsx') as typeof import('../../src/components/ttrpg/TtrpgOnlineRoomPanel')
    const { AuthoritativeOnlineRoomV1 } = await load('/storyforge/src/lib/online/room-authority.ts') as typeof import('../../src/lib/online/room-authority')
    const { HttpOnlineRoomTransportV1 } = await load('/storyforge/src/lib/online/http-transport.ts') as typeof import('../../src/lib/online/http-transport')
    const releaseHash = 'a'.repeat(64), state = { sends: 0, accepted: [] as string[] }
    const created = await AuthoritativeOnlineRoomV1.create({ roomId: 'sfqa115.native', releaseHash, gmDisplayName: 'GM',
      adapter: {
        apply: async ({ command }) => {
          state.accepted.push(command.requestId)
          return { eventType: 'room.chat.message', publicPayload: command.payload, resultingStateHash: 'b'.repeat(64) }
        },
        project: async () => null,
      },
    })
    const json = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload })
    // The service response is controlled; the unchanged panel, client, transport,
    // room authority, credentials, request IDs and native input events are real.
    const transport = new HttpOnlineRoomTransportV1({ baseUrl: '/sfqa115-fixture', fetch: async (url, init) => {
      if (url.endsWith('/wait')) return new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
      if (url.endsWith('/members')) return json({ members: [created.gm.member] })
      if (url.endsWith('/commands')) {
        state.sends += 1
        if (state.sends === 1) return json({ code: 'domain_rejected', message: '请修改这条消息后重试' }, 400)
        return json(await created.room.submit(JSON.parse(init.body) as import('../../src/lib/online/room-authority').OnlineRoomCommandV1))
      }
      if (url.endsWith('/reconnect')) return json(await created.room.reconnect(JSON.parse(init.body) as Parameters<typeof created.room.reconnect>[0]))
      if (url.endsWith('/rooms')) return json({ roomId: created.room.roomId, releaseHash, ...created.gm, cursor: 0 })
      throw new Error(`Unexpected fixture route: ${url}`)
    } })
    const host = document.createElement('main')
    host.dataset.testid = 'sfqa115-room'
    host.style.cssText = 'position:fixed;inset:0;z-index:10000;overflow:auto;background:white;padding:16px'
    document.body.append(host)
    const root = dom.createRoot(host)
    Object.defineProperty(window, '__sfqa115Native', { configurable: true, value: { state, cleanup: () => { root.unmount(); host.remove() } } })
    root.render(react.createElement(Panel, { releaseHash, selectedCharacterKeys: ['player.1'], characterNames: { 'player.1': 'Player' }, transport }))
  }, modules)
  const room = page.getByTestId('sfqa115-room')
  try {
    await room.getByLabel('托管服务访问凭据').fill('isolated-fixture-access')
    await room.getByRole('button', { name: '创建并连接', exact: true }).click()
    await expect(room).toContainText('online · #0')
    const draft = room.getByLabel('在线房间消息')
    await draft.fill('保留尚未接受的草稿')
    await room.getByRole('button', { name: '发送', exact: true }).click()
    await expect(room.getByRole('alert')).toContainText('请修改这条消息后重试')
    await expect(draft).toHaveValue('保留尚未接受的草稿')
    await expect(room).toContainText('online · #0')
    await draft.fill('修改后的合法消息')
    await room.getByRole('button', { name: '发送', exact: true }).click()
    await expect(draft).toHaveValue('')
    await expect(room).toContainText('online · #1')
    const state = await page.evaluate(() => (Object.getOwnPropertyDescriptor(window, '__sfqa115Native')!.value as {
      state: { sends: number; accepted: string[] }
    }).state)
    expect(state.sends).toBe(2)
    expect(state.accepted).toHaveLength(1)
  } finally {
    await page.evaluate(() => (Object.getOwnPropertyDescriptor(window, '__sfqa115Native')!.value as { cleanup: () => void }).cleanup())
  }
})
