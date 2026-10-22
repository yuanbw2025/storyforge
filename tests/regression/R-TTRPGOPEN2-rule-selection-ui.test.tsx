import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgProductionWizard from '../../src/components/ttrpg/TtrpgProductionWizard'
import TtrpgOpenRuleImport from '../../src/components/ttrpg/TtrpgOpenRuleImport'
import { defaultTtrpgSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { createStoryForgeOpenRulePackV2 } from '../../src/lib/ttrpg/storyforge-open-rule-pack'
import type { TtrpgRulePackRecordV1, WorkspaceScope } from '../../src/lib/types'

const library = vi.hoisted(() => ({ v1: vi.fn(), v2: vi.fn(), save: vi.fn() }))
vi.mock('../../src/lib/ttrpg/rule-pack-library', () => ({ listValidatedTtrpgRulePacksV1: library.v1, listValidatedTtrpgRulePacksV2: library.v2, saveTtrpgRulePackV2: library.save }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN2 scoped rule selection and explicit preparation', () => {
  let root: Root, host: HTMLDivElement
  const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }, changed = vi.fn(), saved = vi.fn()
  const record = (id: number, title: string) => ({ id, ...scope, title, ruleSystemId: 'storyforge.narrative', ruleSystemVersion: '3.0.0', status: 'validated' }) as TtrpgRulePackRecordV1
  beforeEach(() => {
    library.v1.mockReset().mockResolvedValue([]); library.v2.mockReset().mockResolvedValue([]); library.save.mockReset()
    changed.mockReset(); saved.mockReset()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  async function wizard(format: 'scripted' | 'open' = 'open', owner: WorkspaceScope | null = scope, value = defaultTtrpgSettingsV2(format).wizard) {
    await act(async () => root.render(createElement(TtrpgProductionWizard, { scope: owner, runFormat: format, activeStep: 2, value, onChange: changed, sourceOptions: null, sourceSelection: null })))
  }
  const button = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent === text)!
  async function importer(key = 'work-a') { await act(async () => root.render(createElement(TtrpgOpenRuleImport, { key, scope, onSaved: saved }))) }
  async function file(read: () => Promise<string>) {
    const input = host.querySelector('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 100, text: read }] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
  }
  it('loads only the matching V2 format on reload while leaving saved settings untouched', async () => {
    library.v2.mockResolvedValue([record(10, '作者保存的开放规则')])
    await wizard('open', scope, { ...defaultTtrpgSettingsV2('open').wizard, savedRulePackId: 10 })
    expect(library.v2).toHaveBeenCalledWith(scope); expect(library.v1).not.toHaveBeenCalled()
    const option = host.querySelector('option[value="10"]') as HTMLOptionElement
    expect(option.disabled).toBe(false); expect(option.selected).toBe(true); expect(option.textContent).toContain('作者保存的开放规则')
    expect(host.querySelector('option[value="builtin-storyforge"]')).toBeNull(); expect(changed).not.toHaveBeenCalled()
  })
  it('keeps all existing scripted builtins and uses the original V1 list', async () => {
    library.v1.mockResolvedValue([record(11, '旧格式自定义规则')]); await wizard('scripted')
    expect(library.v1).toHaveBeenCalledWith(scope); expect(library.v2).not.toHaveBeenCalled()
    for (const origin of ['builtin-storyforge', 'builtin-rank-lite', 'builtin-d20-fantasy', 'builtin-d100-investigation', 'saved-rule-pack']) {
      expect(host.querySelector(`option[value="${origin}"]`)).not.toBeNull()
    }
    expect(host.querySelector('[data-testid="ttrpg-open-rule-import"]')).toBeNull(); expect(changed).not.toHaveBeenCalled()
  })
  it('preserves an incompatible old open choice for explicit correction without rewriting it on read', async () => {
    await wizard('open', scope, { ...defaultTtrpgSettingsV2('open').wizard, ruleOrigin: 'builtin-storyforge' })
    const option = host.querySelector('option[value="builtin-storyforge"]') as HTMLOptionElement
    expect(option.disabled).toBe(true); expect(option.selected).toBe(true); expect(changed).not.toHaveBeenCalled()
  })
  it('does not erase a newly confirmed rule when the initial list resolves late', async () => {
    let finish!: (rows: TtrpgRulePackRecordV1[]) => void
    library.v2.mockImplementationOnce(() => new Promise(done => { finish = done })); library.save.mockResolvedValue(record(13, '刚保存的规则'))
    await wizard(); await act(async () => button('预览内置开放 2d6 规则').click())
    await act(async () => button('确认并使用这份规则').click())
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ savedRulePackId: 13 }))
    await act(async () => finish([]))
    expect(host.querySelector('option[value="13"]')?.textContent).toContain('刚保存的规则')
  })
  it('drops late old-Work results and clears prior choices immediately when the scope disappears', async () => {
    let finish!: (rows: TtrpgRulePackRecordV1[]) => void
    library.v2.mockImplementationOnce(() => new Promise(done => { finish = done })).mockResolvedValue([record(20, '当前作品规则')])
    await wizard(); await wizard('open', { projectId: 4, worldId: 5, workId: 6 })
    await act(async () => finish([record(10, '另一作品迟到的规则')]))
    expect(host.textContent).toContain('当前作品规则'); expect(host.textContent).not.toContain('另一作品迟到的规则')
    await wizard('open', null); expect(host.textContent).not.toContain('当前作品规则'); expect(changed).not.toHaveBeenCalled()
  })
  it('rejects a late open-format list after switching the same Work to scripted', async () => {
    let finish!: (rows: TtrpgRulePackRecordV1[]) => void
    library.v2.mockImplementation(() => new Promise(done => { finish = done })); library.v1.mockResolvedValue([record(11, '现有闭合规则')])
    await wizard(); await wizard('scripted', scope, { ...defaultTtrpgSettingsV2('scripted').wizard, ruleOrigin: 'saved-rule-pack' })
    await act(async () => finish([record(12, '迟到开放规则')]))
    expect(host.textContent).toContain('现有闭合规则'); expect(host.textContent).not.toContain('迟到开放规则')
  })
  it('reports a failed list and preserves an unavailable saved identity without silently selecting another pack', async () => {
    library.v2.mockRejectedValue(new Error('hash mismatch'))
    await wizard('open', scope, { ...defaultTtrpgSettingsV2('open').wizard, savedRulePackId: 99 })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('hash mismatch')
    const option = host.querySelector('option[value="99"]') as HTMLOptionElement
    expect(option.disabled).toBe(true); expect(option.selected).toBe(true); expect(changed).not.toHaveBeenCalled()
  })
  it('previews the built-in without writing until explicit confirmation, retaining a failed candidate', async () => {
    await importer(); await act(async () => button('预览内置开放 2d6 规则').click())
    expect(host.textContent).toContain('StoryForge 开放叙事 2d6'); expect(host.textContent).toContain('第一方内容许可')
    expect(library.save).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled()
    library.save.mockRejectedValueOnce(new Error('immutable version clash'))
    await act(async () => button('确认并使用这份规则').click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('immutable version clash')
    expect(host.querySelector('[data-testid="ttrpg-open-rule-candidate"]')).not.toBeNull(); expect(saved).not.toHaveBeenCalled()
    const row = record(10, '规则'); library.save.mockResolvedValueOnce(row)
    await act(async () => button('确认并使用这份规则').click())
    expect(library.save).toHaveBeenLastCalledWith({ scope, rulePack: createStoryForgeOpenRulePackV2(), status: 'validated', immutable: true })
    expect(saved).toHaveBeenCalledWith(row); expect(host.querySelector('[data-testid="ttrpg-open-rule-candidate"]')).toBeNull()
  })
  it('preparing the built-in invalidates an earlier pending file without overwriting the visible candidate', async () => {
    await importer(); let finish!: (text: string) => void
    await file(() => new Promise(done => { finish = done })); await act(async () => button('预览内置开放 2d6 规则').click())
    const old = { ...createStoryForgeOpenRulePackV2(), title: '迟到的文件' }
    await act(async () => finish(JSON.stringify(old)))
    expect(host.textContent).toContain('StoryForge 开放叙事 2d6'); expect(host.textContent).not.toContain('迟到的文件'); expect(library.save).not.toHaveBeenCalled()
  })
  it('does not deliver a completed save to another mounted Work', async () => {
    await importer(); let finish!: (row: TtrpgRulePackRecordV1) => void
    library.save.mockImplementationOnce(() => new Promise(done => { finish = done }))
    await act(async () => button('预览内置开放 2d6 规则').click()); await act(async () => button('确认并使用这份规则').click())
    await importer('work-b'); await act(async () => finish(record(10, 'old Work rule')))
    expect(saved).not.toHaveBeenCalled(); expect(host.querySelector('[data-testid="ttrpg-open-rule-candidate"]')).toBeNull()
  })
})
