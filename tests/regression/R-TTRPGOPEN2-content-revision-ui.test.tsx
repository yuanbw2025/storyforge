import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Panel from '../../src/components/ttrpg/TtrpgOpenContentRevision'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
const m = vi.hoisted(() => ({ inspect: vi.fn(), read: vi.fn(), prepare: vi.fn(), submit: vi.fn(), prepareLocal: vi.fn(), submitLocal: vi.fn() }))
vi.mock('../../src/lib/ttrpg/open-production-content-revision-service', () => ({ inspectTtrpgOpenContentRevisionV1: m.inspect,
  readTtrpgOpenContentRevisionDraftV1: m.read, prepareTtrpgOpenContentRevisionProposalV1: m.prepare, submitTtrpgOpenContentRevisionV1: m.submit, prepareTtrpgOpenLocalNoDispatchProposalV1: m.prepareLocal, submitTtrpgOpenLocalNoDispatchV1: m.submitLocal }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
const view = { scope: { projectId: 1, worldId: 2, workId: 3 }, productionId: 4, buildId: 5, controlEpoch: 7, expectedStateRevision: 11, planHash: 'a'.repeat(64) }
const owner = { ...view, ledgerHash: 'b'.repeat(64), failureHash: 'c'.repeat(64) }
const selection = { artifactKey: 'ttrpg.open.situation-layer', version: 3, contentHash: 'd'.repeat(64) }
const original = { schema: 'fixture-only', retained: 'KEEP_ORIGINAL_POLICY_AND_PRIVATE_OWNER', metadata: { visualBible: { characters: [
  { characterKey: 'actor.fixture', identityPrompt: '原角色', expressionBaselines: [], referenceAssetKeys: [] }] } } }
const source = { ...selection, owner, authorDraftJson: JSON.stringify(original) }
const inspection = { owner, choices: [selection], needsAccounting: false, unreportedFailedCount: 0, brief: {} }
const submitted = { receipt: { ok: true }, details: { production: { id: 4, status: 'producing' } } }
const props = () => ({ view, disabled: false, onBusy: vi.fn(), onAccounted: vi.fn(), onSubmitted: vi.fn() })
beforeEach(() => {
  vi.clearAllMocks(); m.inspect.mockResolvedValue(inspection); m.read.mockResolvedValue(source); m.submit.mockResolvedValue(submitted)
  m.prepare.mockImplementation(async input => ({ source: input.source, command: parseProductProductionCommandV1({
    type: 'resume', commandId: input.commandId, expectedStateRevision: input.source.owner.expectedStateRevision,
    ttrpgContentRevision: { artifactKey: input.source.artifactKey, expectedArtifactVersion: input.source.version,
      expectedArtifactHash: input.source.contentHash, expectedPlanHash: input.source.owner.planHash,
      expectedControlEpoch: input.source.owner.controlEpoch, authorDraftJson: input.authorDraftJson, note: input.note } }),
    commandHash: 'e'.repeat(64), additionalTaskKeys: [], blockedReason: null, tasks: [
    { taskKey: 'ttrpg.open.situation-layer', execution: 'author' }, { taskKey: 'ttrpg.open.media-plan', execution: 'deterministic' }] }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const button = (label: string) => [...host.querySelectorAll('button')].find(e => e.textContent === label)!
async function wait(check: () => void) { await vi.waitFor(async () => { await act(async () => { await Promise.resolve() }); check() }) }
async function click(label: string) { await act(async () => { button(label).click(); await Promise.resolve() }) }
async function edit(label: string, value: string) {
  await act(async () => {
    const field = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement
    const proto = field.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); await Promise.resolve()
  })
}
async function render(p = props()) {
  await act(async () => { root.render(createElement(Panel, p)); await Promise.resolve() })
  await wait(() => expect(button('载入已采用原稿').disabled).toBe(false)); return p
}
async function loaded(p = props()) { await render(p); await click('载入已采用原稿'); await wait(() => expect(button('新增表情基线')).toBeTruthy()); return p }
async function prepared(p = props()) {
  await loaded(p); await click('新增表情基线'); await edit('actor.fixture 表情 1 描述', '平静注视前方'); await edit('返修说明', '明确补齐原稿表情')
  await click('核对返修与影响'); await wait(() => expect(button('提交返修并继续制作')).toBeTruthy()); return p
}
it('loads explicitly, preserves the original JSON, previews separately and submits only by explicit action', async () => {
  const p = await render(); expect(m.read).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled()
  await click('载入已采用原稿'); await wait(() => expect(button('新增表情基线')).toBeTruthy()); await click('新增表情基线')
  await edit('actor.fixture 表情 1 描述', '平静注视前方'); await edit('返修说明', '作者明确补齐')
  await click('核对返修与影响'); await wait(() => expect(button('提交返修并继续制作')).toBeTruthy())
  const sent = JSON.parse(m.prepare.mock.calls[0][0].authorDraftJson), expected = structuredClone(original)
  ;(expected.metadata.visualBible.characters[0].expressionBaselines as unknown[]) = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  expect(sent).toEqual(expected); expect(source.authorDraftJson).toBe(JSON.stringify(original)); expect(m.submit).not.toHaveBeenCalled()
  expect(host.textContent).toContain('后续 0 个模型岗位'); await click('提交返修并继续制作'); await wait(() => expect(p.onSubmitted).toHaveBeenCalledWith(submitted))
})
it('invalidates the proposal after an edit or failed fresh preview', async () => {
  await prepared(); await edit('返修说明', '修改后的说明'); expect(button('提交返修并继续制作')).toBeUndefined()
  await click('核对返修与影响'); await wait(() => expect(button('提交返修并继续制作')).toBeTruthy())
  m.prepare.mockRejectedValueOnce(Error('原稿已变化')); await click('核对返修与影响'); await wait(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('已变化'))
  expect(button('提交返修并继续制作')).toBeUndefined(); expect(m.submit).not.toHaveBeenCalled()
})
it.each([
  { label: 'pasted JSON with a final newline', draft: `${JSON.stringify(original, null, 2)}\n`, note: '  作者明确修订原稿 \n' },
  { label: 'decomposed Unicode in the JSON and note', draft: JSON.stringify({ ...original, retained: 'cafe\u0301' }), note: 'cafe\u0301' },
])('submits the reviewed $label using the canonical command without replacing the editor input', async ({ draft, note }) => {
  const p = await loaded(); await edit('返修原稿 JSON', draft); await edit('返修说明', note)
  await click('核对返修与影响'); await wait(() => expect(button('提交返修并继续制作')).toBeTruthy())
  expect(m.prepare).toHaveBeenCalledWith(expect.objectContaining({ authorDraftJson: draft, note }))
  expect((host.querySelector('[aria-label="返修原稿 JSON"]') as HTMLTextAreaElement).value).toBe(draft)
  expect(m.submit).not.toHaveBeenCalled(); await click('提交返修并继续制作')
  await wait(() => expect(p.onSubmitted).toHaveBeenCalledWith(submitted)); expect(m.submit).toHaveBeenCalledOnce()
  const sent = m.submit.mock.calls[0][0].command.ttrpgContentRevision
  expect(sent.authorDraftJson).toBe(draft.trim().normalize('NFC')); expect(sent.note).toBe(note.trim().normalize('NFC'))
})
it('requires a new preview after a formatting-only edit even when canonical contents would be unchanged', async () => {
  const p = await prepared(); const draft = (host.querySelector('[aria-label="返修原稿 JSON"]') as HTMLTextAreaElement).value
  await edit('返修原稿 JSON', `${draft}\n`); expect(button('提交返修并继续制作')).toBeUndefined()
  expect(m.submit).not.toHaveBeenCalled(); expect(p.onSubmitted).not.toHaveBeenCalled()
  await click('核对返修与影响'); await wait(() => expect(button('提交返修并继续制作')).toBeTruthy())
  await click('提交返修并继续制作'); await wait(() => expect(p.onSubmitted).toHaveBeenCalledOnce())
  expect(m.prepare).toHaveBeenCalledTimes(2); expect(m.submit).toHaveBeenCalledOnce()
})
it('retains the same command after a lost return and never retries automatically', async () => {
  const p = await prepared(); m.submit.mockRejectedValueOnce(Error('提交返回中断')); await click('提交返修并继续制作')
  await wait(() => expect(host.querySelector('[role=alert]')).toBeTruthy()); expect(m.submit).toHaveBeenCalledOnce(); expect(p.onSubmitted).not.toHaveBeenCalled()
  const first = m.submit.mock.calls[0][0]; await click('提交返修并继续制作'); await wait(() => expect(p.onSubmitted).toHaveBeenCalledOnce())
  expect(m.submit.mock.calls[1][0]).toBe(first); expect(m.prepare).toHaveBeenCalledOnce()
})
it('guards duplicate submission and discards a late completion after Work changes', async () => {
  const p = await prepared(); let finish!: (value: unknown) => void; m.submit.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await act(async () => { button('提交返修并继续制作').click(); button('提交返修并继续制作').click(); await Promise.resolve() }); await wait(() => expect(m.submit).toHaveBeenCalledOnce())
  const next = { ...props(), view: { ...view, scope: { ...view.scope, workId: 999 } } }
  m.inspect.mockResolvedValue({ ...inspection, owner: { ...owner, ...next.view } })
  await act(async () => { root.render(createElement(Panel, { ...next, key: 'new' })); await Promise.resolve() })
  await act(async () => { finish(submitted); await Promise.resolve() })
  expect(p.onSubmitted).not.toHaveBeenCalled(); expect(next.onSubmitted).not.toHaveBeenCalled(); expect(next.onBusy).not.toHaveBeenCalled()
})
it('discards late source loading after a Work switch and leaves unknown accounting blocked', async () => {
  await render(); let finish!: (value: unknown) => void; m.read.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await click('载入已采用原稿'); const next = { ...props(), view: { ...view, scope: { ...view.scope, workId: 999 } } }
  m.inspect.mockResolvedValue({ ...inspection, owner: { ...owner, ...next.view }, needsAccounting: true })
  await act(async () => { root.render(createElement(Panel, { ...next, key: 'new' })); await Promise.resolve() })
  await wait(() => expect(host.textContent).toContain('仍有在途请求')); await act(async () => { finish(source); await Promise.resolve() })
  expect(button('新增表情基线')).toBeUndefined(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled()
})

const accounted = { receipt: { ok: true }, details: { production: { id: 4, status: 'paused' } } }
async function legacyLoaded(p = props()) {
  m.inspect.mockResolvedValue({ ...inspection, unreportedFailedCount: 2 })
  m.prepareLocal.mockImplementation(async input => ({ source: input.source, command: { commandId: input.commandId }, commandHash: 'f'.repeat(64), attempts: [
    { taskKey: 'ttrpg.open.situation-layer', attempt: 1, controlEpoch: 4, classification: 'preflight-before-dispatch', durationMs: 10 },
    { taskKey: 'ttrpg.open.media-plan', attempt: 1, controlEpoch: 6, classification: 'empty-media-kernel', durationMs: 25 }] }))
  m.submitLocal.mockResolvedValue(accounted)
  return loaded(p)
}
it('keeps editing locked until a separate explicit evidence preview and bookkeeping confirmation', async () => {
  const p = await legacyLoaded()
  expect((button('新增表情基线').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  expect((host.querySelector('[aria-label="返修原稿 JSON"]') as HTMLTextAreaElement).disabled).toBe(true)
  expect(m.prepareLocal).not.toHaveBeenCalled(); expect(m.submitLocal).not.toHaveBeenCalled()
  await click('核对旧失败记录'); await wait(() => expect(button('确认关闭未发送记录')).toBeTruthy())
  expect(host.textContent).toContain('发送前预检失败'); expect(host.textContent).toContain('本地素材校验失败')
  expect(m.submitLocal).not.toHaveBeenCalled(); await click('确认关闭未发送记录')
  await wait(() => expect(p.onAccounted).toHaveBeenCalledWith(accounted))
  expect(p.onSubmitted).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled()
})
it('reuses the exact bookkeeping command after a lost return and never repeats automatically', async () => {
  const p = await legacyLoaded(); await click('核对旧失败记录'); await wait(() => expect(button('确认关闭未发送记录')).toBeTruthy())
  m.submitLocal.mockRejectedValueOnce(Error('核对回执返回中断')); await click('确认关闭未发送记录')
  await wait(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('返回中断'))
  expect(m.submitLocal).toHaveBeenCalledOnce(); expect(p.onAccounted).not.toHaveBeenCalled()
  const first = m.submitLocal.mock.calls[0][0]; await click('确认关闭未发送记录')
  await wait(() => expect(p.onAccounted).toHaveBeenCalledOnce()); expect(m.submitLocal.mock.calls[1][0]).toBe(first)
  expect(m.prepareLocal).toHaveBeenCalledOnce()
})
it('discards a late legacy proof after Work changes and cannot confirm an ambiguous record', async () => {
  await legacyLoaded(); let finish!: (value: unknown) => void
  m.prepareLocal.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); await click('核对旧失败记录')
  const next = { ...props(), view: { ...view, scope: { ...view.scope, workId: 999 } } }
  m.inspect.mockResolvedValue({ ...inspection, owner: { ...owner, ...next.view }, unreportedFailedCount: 1 })
  await act(async () => { root.render(createElement(Panel, { ...next, key: 'legacy.other-work' })); await Promise.resolve() })
  await act(async () => { finish({ attempts: [] }); await Promise.resolve() })
  expect(button('确认关闭未发送记录')).toBeUndefined(); expect(next.onAccounted).not.toHaveBeenCalled()
  await click('载入已采用原稿'); await wait(() => expect(button('核对旧失败记录')).toBeTruthy())
  m.prepareLocal.mockRejectedValueOnce(Error('存在发送证据，保留原未知用量'))
  await click('核对旧失败记录'); await wait(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('保留原未知'))
  expect(button('确认关闭未发送记录')).toBeUndefined(); expect(m.submitLocal).not.toHaveBeenCalled()
})

it('shows extra upstream revalidation and blocks submission while preserving the old draft', async () => {
  m.prepare.mockImplementationOnce(async input => ({ source: input.source, command: { type: 'resume', commandId: input.commandId,
    ttrpgContentRevision: { authorDraftJson: input.authorDraftJson, note: input.note, expectedImpactHash: 'f'.repeat(64) } },
    commandHash: 'e'.repeat(64), blockedReason: 'upstream-version-changed', additionalTaskKeys: ['ttrpg.open.rule-system', 'ttrpg.open.source-facts'], tasks: [
      { taskKey: 'ttrpg.open.source-facts', execution: 'model' }, { taskKey: 'ttrpg.open.rule-system', execution: 'model' },
      { taskKey: 'ttrpg.open.situation-layer', execution: 'author' }, { taskKey: 'ttrpg.open.media-plan', execution: 'deterministic' }] }))
  const p = await loaded(); await click('新增表情基线'); await edit('actor.fixture 表情 1 描述', '平静注视前方'); await edit('返修说明', '明确补齐原稿表情')
  await click('核对返修与影响'); await wait(() => expect(host.textContent).toContain('2 个上游模型岗位'))
  expect(host.textContent).toContain('局部返修不可提交'); expect(host.textContent).toContain('保留旧轮次')
  expect(button('提交返修并继续制作')).toBeUndefined(); expect(m.submit).not.toHaveBeenCalled(); expect(p.onSubmitted).not.toHaveBeenCalled()
  expect(host.textContent).toContain('KEEP_ORIGINAL_POLICY_AND_PRIVATE_OWNER')
})
