import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'

test('native fetch stops an unfinished room response body on timeout and caller cancellation', async ({ page }) => {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{"cursor":') // Real headers and a partial body; deliberately never finish it.
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local fixture port')
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await page.goto('./')
    await page.getByTestId('home-page').waitFor()
    const results = await page.evaluate(async baseUrl => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { HttpOnlineRoomTransportV1 } = await importer('/storyforge/src/lib/online/http-transport.ts') as typeof import('../../src/lib/online/http-transport')
      const outcomes: Array<{ mode: string; headersReceived: boolean; code: string }> = []
      for (const mode of ['timeout', 'caller']) {
        const caller = new AbortController()
        let headersReceived = false
        let abortTimer: ReturnType<typeof setTimeout> | undefined
        let deadline: ReturnType<typeof setTimeout> | undefined
        const transport = new HttpOnlineRoomTransportV1({
          baseUrl, timeoutMs: 200,
          fetch: async (url, init) => {
            const response = await fetch(url, init)
            headersReceived = true
            if (mode === 'caller') abortTimer = setTimeout(() => caller.abort(), 30)
            return response
          },
        })
        try {
          const result = transport.waitForAdvance({ roomId: 'local-fixture', memberId: 'gm', authToken: 'mock', afterSequence: 0, timeoutMs: 1000, signal: caller.signal })
            .then(() => 'unexpected-success', (error: unknown) => error && typeof error === 'object' && 'code' in error ? String(error.code) : String(error))
          const code = await Promise.race([result, new Promise<string>(resolve => {
            deadline = setTimeout(() => resolve('body-still-pending'), 1500)
          })])
          outcomes.push({ mode, headersReceived, code })
        } finally { clearTimeout(abortTimer); clearTimeout(deadline); caller.abort() }
      }
      return outcomes
    }, `http://127.0.0.1:${address.port}`)
    expect(results).toEqual([
      { mode: 'timeout', headersReceived: true, code: 'timeout' },
      { mode: 'caller', headersReceived: true, code: 'request_aborted' },
    ])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
