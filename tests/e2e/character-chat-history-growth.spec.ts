import {test, expect} from '@playwright/test'
import {createWriteStream, renameSync, writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pipeline} from 'node:stream/promises'
import {createGzip, gzipSync} from 'node:zlib'

const target = Number(process.env.CHAT_HISTORY_GROWTH_ACTIONS ?? 100)
if (![100, 300, 1000].includes(target)) throw new Error('CHAT_HISTORY_GROWTH_ACTIONS must be 100, 300 or 1000')

test(`native IndexedDB retains ${target} consequential actions, actual historical input and portable checkpoints`, async ({page}, info) => {
  test.setTimeout(target === 100 ? 600_000 : 1_800_000)
  let externalCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://history-growth.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://history-growth.invalid/**', async route => {externalCalls++; await route.abort()})
  await page.exposeFunction('persistNativeGrowthCheckpoint', (checkpoint: {actions: number; state: string; elapsedMs: number; calls: number}) => {
    const {state, ...progress} = checkpoint
    writeFileSync(info.outputPath(`native-growth-${checkpoint.actions}-state.json.gz`), gzipSync(state))
    writeFileSync(info.outputPath(`native-growth-${checkpoint.actions}-progress.json`), JSON.stringify({...progress, externalCalls}, null, 2))
  })
  // Browser backups use the same bounded JSON Blob as the download UI. Do not
  // turn the complete backup into a CDP argument/result or retain it in a trace.
  const transfers = new Map<string, {gzip: ReturnType<typeof createGzip>; done: Promise<void>; hash: ReturnType<typeof createHash>; bytes: number}>()
  await page.exposeFunction('persistNativeGrowthBackup', async (part: {name: string; kind: 'start' | 'chunk' | 'end'; base64?: string; bytes?: number}) => {
    if (!/^native-growth-(?:[0-9]+-)?backup$/.test(part.name)) throw new Error('Invalid backup evidence name')
    const path = info.outputPath(`${part.name}.json.gz`)
    if (part.kind === 'start') {
      if (transfers.has(part.name)) throw new Error('Backup transfer already started')
      const gzip = createGzip(), done = pipeline(gzip, createWriteStream(`${path}.partial`, {flags: 'wx'}))
      void done.catch(() => {}) // The awaited terminal transfer reports the original failure.
      transfers.set(part.name, {gzip, done, hash: createHash('sha256'), bytes: 0})
      return
    }
    const transfer = transfers.get(part.name)
    if (!transfer) throw new Error('Backup transfer was not started')
    if (part.kind === 'chunk') {
      const chunk = Buffer.from(part.base64 ?? '', 'base64')
      if (!chunk.length || chunk.length > 65536) throw new Error('Backup chunk exceeds transport bound')
      transfer.hash.update(chunk); transfer.bytes += chunk.length
      await new Promise<void>((resolve, reject) => transfer.gzip.write(chunk, error => error ? reject(error) : resolve()))
      return
    }
    if (transfer.bytes !== part.bytes) throw new Error('Backup transfer length mismatch')
    transfer.gzip.end(); await transfer.done
    renameSync(`${path}.partial`, path)
    writeFileSync(info.outputPath(`${part.name}-receipt.json`), JSON.stringify({bytes: transfer.bytes, sha256: transfer.hash.digest('hex'), transport: 'bounded binary chunks', externalCalls}, null, 2))
    transfers.delete(part.name)
  })
  page.on('console', message => {if (message.text().startsWith('CHAT_GROWTH ')) console.info(message.text())})
  await page.goto('./chat/library')
  const outcome = await page.evaluate(async target => {
    const load = new Function('p', 'return import(p)')
    const helper = await load('/storyforge/tests/helpers/chat-history-growth.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    const portable = await load('/storyforge/src/lib/export/json-export.ts')
    const jsonFile = await load('/storyforge/src/lib/export/json-file.ts')
    const sendBackup = (globalThis as unknown as {persistNativeGrowthBackup: (part: {name: string; kind: string; base64?: string; bytes?: number}) => Promise<void>}).persistNativeGrowthBackup
    const saveBackup = async (name: string): Promise<Blob> => {
      console.info('CHAT_GROWTH ' + JSON.stringify({phase: 'backup-capture-start', name}))
      const blob: Blob = jsonFile.createProjectJSONBlob(await portable.exportProjectJSON(f.scope.projectId))
      console.info('CHAT_GROWTH ' + JSON.stringify({phase: 'backup-captured', name, bytes: blob.size}))
      await sendBackup({name, kind: 'start'})
      const reader = blob.stream().getReader()
      try {
        for (;;) {
          const {done, value} = await reader.read()
          if (done) break
          for (let offset = 0; offset < value.length; offset += 65536) {
            const bytes = value.subarray(offset, offset + 65536)
            await sendBackup({name, kind: 'chunk', base64: btoa(String.fromCharCode(...bytes))})
          }
        }
        await sendBackup({name, kind: 'end', bytes: blob.size})
      } finally { reader.releaseLock() }
      console.info('CHAT_GROWTH ' + JSON.stringify({phase: 'backup-persisted', name, bytes: blob.size}))
      return blob
    }
    const persist = (globalThis as unknown as {persistNativeGrowthCheckpoint: (row: {actions: number; state: string; elapsedMs: number; calls: number}) => Promise<void>}).persistNativeGrowthCheckpoint
    const f = await helper.seedChatHistoryGrowthFixture(), started = performance.now()
    const worlds = JSON.stringify(await db.worldReleases.toArray())
    const progress: {actions: number; elapsedMs: number; lastActionMs: number}[] = []
    const checkpoints: {actions: number; sequence: number; facts: number; actorRead: boolean; reviewRead: boolean}[] = []
    let actions = 0, failure: string | null = null
    try {
      for (let i = 0; i < target; i++) {
        const before = performance.now(); await f.perform(helper.chatHistoryGrowthObservation(i)); actions++
        if (actions % 25 === 0) {const row = {actions, elapsedMs: Math.round(performance.now() - started), lastActionMs: Math.round(performance.now() - before)}; progress.push(row); console.info('CHAT_GROWTH ' + JSON.stringify(row))}
        if ([100, 300, 1000].includes(actions)) {
          const inputRead = {actor: false, review: false}
          const reply = {...helper.chatHistoryGrowthObservation(i), kind: 'speak', text: '旧登记上的靛蓝地图旁有杉木叶标记。', evidenceFactKeys: ['capacity-0'], newFacts: []}
          await f.perform(reply, '以前靛蓝地图的杉木叶标记是什么？', (phase: 'actor' | 'review', text: string) => {
            if (!text.includes('capacity-0') || !text.includes('靛蓝地图登记旁有杉木叶标记')) throw new Error('原线索没有进入实际' + phase + '输入')
            if (phase === 'actor' && text.includes('柜台下')) throw new Error('角色输入包含幕后秘密')
            inputRead[phase] = true
          })
          const state = await api.readProductRuntimeState(f.sessionId), session = await db.productRuntimeSessions.get(f.sessionId)
          const full = core.replayProductRuntimeEvents(core.parseProductRuntimeState(session.initialStateJson), await core.readSessionEvents(session))
          if (JSON.stringify(state) !== JSON.stringify(full)) throw new Error('完整重放与当前状态不一致')
          const facts = state.interaction.chatNarrative.situation.facts.length
          if (facts !== actions * 2 + 4) throw new Error('完整事实数量不一致')
          checkpoints.push({actions, sequence: state.lastSequence, facts, actorRead: inputRead.actor, reviewRead: inputRead.review})
        }
        // A later browser deadline must not erase evidence already reached.
        // Intermediate backups are original sessions, not recovery acceptance.
        if (actions % 100 === 0) {
          // Preserve reached state before starting the separate backup phase.
          const memory = (performance as Performance & {memory?: {usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number}}).memory
          console.info('CHAT_GROWTH ' + JSON.stringify({phase: 'state-checkpoint', actions, memory, storage: await navigator.storage.estimate()}))
          await persist({actions, state: JSON.stringify(await api.readProductRuntimeState(f.sessionId)),
            elapsedMs: Math.round(performance.now() - started), calls: f.calls()})
          if ([100, 300, 800].includes(actions)) await saveBackup(`native-growth-${actions}-backup`)
        }
      }
    } catch (error) {failure = String(error)}
    const state = await api.readProductRuntimeState(f.sessionId)
    const result = {target, actions, failure, calls: f.calls(), progress, checkpoints, facts: state.interaction.chatNarrative.situation.facts.length,
      database: 'native IndexedDB', elapsedMs: Math.round(performance.now() - started)}
    if (failure) return {result, branches: [], worldUnchanged: JSON.stringify(await db.worldReleases.toArray()) === worlds}
    const branches: {title: string; stateHash: string; sessionId: number}[] = []
    for (const checkpoint of checkpoints) {
      const title = `native-growth-${checkpoint.actions}`
      const branch = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: checkpoint.sequence, title})
      branches.push({title, stateHash: await core.hashStateJson(JSON.stringify((await api.readProductRuntimeState(branch.id)).interaction)), sessionId: branch.id})
    }
    await api.deleteProductRuntimeSession(f.sessionId)
    const backup = await saveBackup('native-growth-backup')
    const imported = await portable.importProjectJSON(await jsonFile.readProjectJSONFile(backup))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(imported).toArray()
    for (const branch of branches) {
      branch.sessionId = sessions.find((s: {title: string}) => s.title === branch.title).id
      if (await core.hashStateJson(JSON.stringify((await api.readProductRuntimeState(branch.sessionId)).interaction)) !== branch.stateHash) throw new Error('删除父档后的导入恢复不一致')
    }
    return {result: {...result, elapsedMs: Math.round(performance.now() - started)}, branches,
      worldUnchanged: JSON.stringify(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()) === worlds}
  }, target).finally(async () => {
    // A browser crash leaves clearly incomplete evidence and closes its streams.
    for (const transfer of transfers.values()) transfer.gzip.destroy()
    await Promise.allSettled([...transfers.values()].map(transfer => transfer.done))
  })
  writeFileSync(info.outputPath('native-growth-result.json'), JSON.stringify({...outcome.result, externalCalls, worldUnchanged: outcome.worldUnchanged}, null, 2))
  await info.attach('native-growth-result', {body: JSON.stringify({...outcome.result, externalCalls, worldUnchanged: outcome.worldUnchanged}, null, 2), contentType: 'application/json'})
  expect(outcome.result.failure).toBeNull(); expect(outcome.result.actions).toBe(target); expect(outcome.result.facts).toBe(target * 2 + 4)
  expect(outcome.result.calls).toBe(target * 3 + outcome.result.checkpoints.length * 3)
  expect(outcome.result.checkpoints.every(c => c.actorRead && c.reviewRead)).toBe(true)
  expect(outcome.worldUnchanged).toBe(true); expect(externalCalls).toBe(0)
  await page.reload()
  const restored = await page.evaluate(async branches => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    return Promise.all(branches.map(async branch => ({title: branch.title, equal: await core.hashStateJson(JSON.stringify((await api.readProductRuntimeState(branch.sessionId)).interaction)) === branch.stateHash})))
  }, outcome.branches)
  expect(restored.every(item => item.equal)).toBe(true); expect(externalCalls).toBe(0)
  writeFileSync(info.outputPath('native-growth-refresh.json'), JSON.stringify(restored, null, 2))
  await info.attach('native-growth-refresh', {body: JSON.stringify(restored), contentType: 'application/json'})
})
