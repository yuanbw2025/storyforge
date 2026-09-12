import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TextOpenWorldArtifactGovernanceProjectionV1,
  TextOpenWorldArtifactProductionValidationV1,
  TextOpenWorldGovernedArtifactHealthV1,
  TextOpenWorldGovernedArtifactV1,
  TextOpenWorldGovernedEntityKindV1,
  TextOpenWorldGovernedEntityV1,
} from '../../src/lib/open-world/creator-artifact-governance'
import type { WorkspaceScope } from '../../src/lib/types'

const governanceMocks = vi.hoisted(() => ({
  read: vi.fn(),
}))
const editMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-artifact-governance', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/creator-artifact-governance')>()
  return {
    ...actual,
    readTextOpenWorldArtifactGovernanceV1: governanceMocks.read,
  }
})

vi.mock('../../src/lib/product-production/service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/product-production/service')>()
  return {
    ...actual,
    prepareTextOpenWorldCreatorArtifactEditV1: editMocks.prepare,
  }
})

vi.mock('../../src/components/text-game/TextOpenWorldCreatorArtifactEditor', async () => {
  const { createElement: element } = await import('react')
  return {
    default: (props: {
      selection: { artifactKey: string; entityIdentity: string | null; buildId: number; expectedSnapshotHash: string }
      eligible: boolean
      ineligibleReason?: string
    }) => element('aside', {
      'data-testid': 'mock-text-open-world-artifact-editor',
      'data-artifact-key': props.selection.artifactKey,
      'data-entity-identity': props.selection.entityIdentity ?? '',
      'data-build-id': String(props.selection.buildId),
      'data-snapshot-hash': props.selection.expectedSnapshotHash,
      'data-eligible': String(props.eligible),
      'data-ineligible-reason': props.ineligibleReason ?? '',
    }),
  }
})

import TextOpenWorldCreatorArtifactBrowser from '../../src/components/text-game/TextOpenWorldCreatorArtifactBrowser'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 401, worldId: 402, workId: 403 }
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function governedEntity(input: {
  key: string
  title: string
  kind?: TextOpenWorldGovernedEntityKindV1
  status?: TextOpenWorldGovernedEntityV1['status']
  summary?: string
}): TextOpenWorldGovernedEntityV1 {
  const kind = input.kind ?? 'character'
  const identity = `${kind}:${input.key}`
  return {
    identity,
    kind,
    key: input.key,
    title: input.title,
    summary: input.summary ?? `${input.title}的公开摘要`,
    status: input.status ?? 'verified',
    artifactKey: `artifact.${kind}`,
    artifactVersion: 3,
    artifactContentHash: HASH_A,
    definedByArtifactKeys: [`artifact.${kind}`],
    fields: [{ key: 'public-description', label: '公开描述', value: `${input.title}的可公开内容` }],
    sourceEvidence: [{ kind: 'source-claim', key: `claim.${input.key}`, field: 'sourceClaimKeys' }],
    sourceEvidenceCount: 1,
    truncatedSourceEvidenceCount: 0,
    references: [],
    referenceCount: 0,
    truncatedReferenceCount: 0,
  }
}

function governedArtifact(input: {
  artifactKey: string
  label: string
  kind?: string
  health?: TextOpenWorldGovernedArtifactHealthV1
  productionValidation?: TextOpenWorldArtifactProductionValidationV1
  diagnostics?: Array<{ code: string; message: string }>
}): TextOpenWorldGovernedArtifactV1 {
  return {
    rowId: Number(input.artifactKey.replace(/\D/g, '').slice(0, 6)) || 1,
    artifactKey: input.artifactKey,
    requirementKey: null,
    kind: input.kind ?? 'text-open-world-character-module',
    label: input.label,
    group: input.kind?.includes('source') ? 'source' : 'world',
    version: 3,
    artifactStatus: 'accepted',
    health: input.health ?? 'verified',
    productionValidation: input.productionValidation
      ?? (input.health && input.health !== 'verified' ? 'not-applicable' : 'production-validated'),
    validatorId: input.productionValidation === 'integrity-only'
      || (input.health && input.health !== 'verified')
      ? null : 'text-open-world.fixture.production-contract.v1',
    validationReceiptHash: input.productionValidation === 'integrity-only'
      || (input.health && input.health !== 'verified') ? null : HASH_A,
    currentEpoch: true,
    controlEpoch: 8,
    ownerTaskKey: `task.${input.artifactKey}`,
    ownerLane: 'content',
    producerRunId: 91,
    producerRunState: 'completed',
    producerReceiptHash: HASH_B,
    inputHash: HASH_A,
    contentHash: HASH_B,
    schema: input.kind ?? 'storyforge.text-open-world.character-module',
    byteSize: 512,
    mediaKind: null,
    mimeType: 'application/json',
    sourceEvidence: [{ kind: 'hash', key: HASH_A, field: 'sourcePinHash' }],
    sourceEvidenceCount: 1,
    truncatedSourceEvidenceCount: 0,
    entityIdentities: [],
    diagnostics: input.diagnostics ?? [],
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_001_000,
  }
}

function governanceProjection(input: {
  title?: string
  snapshotHash?: string
  entities?: TextOpenWorldGovernedEntityV1[]
  artifacts?: TextOpenWorldGovernedArtifactV1[]
} = {}): TextOpenWorldArtifactGovernanceProjectionV1 {
  const entities = input.entities ?? [
    governedEntity({ key: 'hero', title: '巡灯人' }),
    governedEntity({ key: 'ferryman', title: '老渡人' }),
    governedEntity({ key: 'unresolved', title: '未完成角色', status: 'pending-reference' }),
    governedEntity({ key: 'dangling', title: '悬空角色', status: 'dangling' }),
  ]
  const artifacts = input.artifacts ?? [
    governedArtifact({ artifactKey: 'artifact.characters.1', label: '角色模块' }),
    governedArtifact({
      artifactKey: 'artifact.regions.2',
      label: '损坏的地区模块',
      kind: 'text-open-world-region-module',
      health: 'corrupt',
      diagnostics: [{ code: 'artifact.hash-mismatch', message: '内容哈希与候选证据不一致' }],
    }),
  ]
  return {
    schema: 'storyforge.text-open-world-artifact-governance-projection',
    version: 1,
    production: {
      id: 71,
      productionKey: 'text-open-world.primary.test',
      title: input.title ?? '盐脊验收世界',
      status: 'preview-ready',
      stateRevision: 12,
    },
    build: {
      id: 81,
      buildNumber: 4,
      status: 'preview-ready',
      controlEpoch: 8,
      planHash: HASH_A,
    },
    snapshotHash: input.snapshotHash ?? HASH_B,
    summary: {
      rowCount: artifacts.length,
      currentVerifiedArtifactCount: artifacts.filter(item => item.health === 'verified').length,
      currentProductionValidatedArtifactCount: artifacts.filter(
        item => item.productionValidation === 'production-validated',
      ).length,
      currentIntegrityOnlyArtifactCount: artifacts.filter(
        item => item.productionValidation === 'integrity-only',
      ).length,
      currentProblemArtifactCount: artifacts.filter(item => item.health !== 'verified').length,
      historicalArtifactCount: 0,
      entityCount: entities.length,
      danglingEntityCount: entities.filter(item => item.status === 'dangling').length,
      pendingReferenceEntityCount: entities.filter(item => item.status === 'pending-reference').length,
    },
    artifacts,
    entities,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setSelect(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function tab(host: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find(candidate => candidate.textContent === label)
  if (!result) throw new Error(`找不到标签页：${label}`)
  return result
}

function selectByLabel(host: ParentNode, label: string): HTMLSelectElement {
  const result = Array.from(host.querySelectorAll<HTMLLabelElement>('label'))
    .find(candidate => candidate.firstChild?.textContent?.trim() === label)
    ?.querySelector('select')
  if (!(result instanceof HTMLSelectElement)) throw new Error(`找不到选择器：${label}`)
  return result
}

function listRows(host: ParentNode): HTMLButtonElement[] {
  const list = host.querySelector('ul[aria-label="内容实体列表"], ul[aria-label="Artifact 列表"]')
  return list ? Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > li > button')) : []
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 5_000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (cause) {
      last = cause
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

describe('Text Open World G5-05 · 受治理内容浏览 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    governanceMocks.read.mockReset()
    editMocks.prepare.mockReset()
    editMocks.prepare.mockImplementation(async selection => ({
      target: {
        artifactKey: selection.artifactKey,
        entityIdentity: selection.entityIdentity,
      },
      editableFields: [{ fieldId: 'title' }],
    }))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('默认只展示 verified 内容，以稳定 locator 选中详情，并永不渲染受保护正文', async () => {
    const sourceSecret = 'SOURCE_PIN_UNIT_SECRET_BODY'
    const ledgerSecret = 'LEDGER_QUOTE_SECRET_BODY'
    const privateSecret = 'PLAYER_PRIVATE_KNOWLEDGE_SECRET'
    const hero = {
      ...governedEntity({ key: 'hero', title: '巡灯人' }),
      privateKnowledge: privateSecret,
    } as TextOpenWorldGovernedEntityV1
    const sourcePinUnit = {
      ...governedArtifact({
        artifactKey: 'artifact.source-unit.11',
        label: '来源单元索引',
        kind: 'text-open-world-source-pin-unit',
      }),
      payload: { content: sourceSecret },
    } as TextOpenWorldGovernedArtifactV1
    const sourceLedger = {
      ...governedArtifact({
        artifactKey: 'artifact.source-ledger.12',
        label: '来源证据账本',
        kind: 'text-open-world-source-ledger',
      }),
      payload: { claims: [{ quote: ledgerSecret }] },
    } as TextOpenWorldGovernedArtifactV1
    governanceMocks.read.mockResolvedValue(governanceProjection({
      entities: [
        hero,
        governedEntity({ key: 'ferryman', title: '老渡人' }),
        governedEntity({ key: 'unresolved', title: '未完成角色', status: 'pending-reference' }),
        governedEntity({ key: 'dangling', title: '悬空角色', status: 'dangling' }),
      ],
      artifacts: [sourcePinUnit, sourceLedger],
    }))

    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(host.textContent).toContain('巡灯人'))

    expect(listRows(host).map(row => row.textContent)).toHaveLength(2)
    expect(host.textContent).not.toContain('未完成角色')
    expect(host.textContent).not.toContain('悬空角色')
    const heroRow = host.querySelector<HTMLButtonElement>(
      '[data-open-world-artifact-locator="entity:character:hero"]',
    )
    expect(heroRow).not.toBeNull()
    await act(async () => heroRow!.click())
    const detail = host.querySelector('[data-testid="text-open-world-creator-entity-detail"]')
    expect(detail?.textContent).toContain('character:hero')
    expect(heroRow?.getAttribute('aria-current')).toBe('true')

    await act(async () => tab(host, 'Artifact').click())
    const sourceRow = host.querySelector<HTMLButtonElement>(
      '[data-open-world-artifact-locator="artifact:artifact.source-unit.11:v3:row11"]',
    )
    expect(sourceRow).not.toBeNull()
    await act(async () => sourceRow!.click())
    expect(host.querySelector('[data-testid="text-open-world-creator-artifact-detail"]')?.textContent)
      .toContain('artifact.source-unit.11')
    expect(host.textContent).not.toContain(sourceSecret)
    expect(host.textContent).not.toContain(ledgerSecret)
    expect(host.textContent).not.toContain(privateSecret)
  })

  it('内容、Artifact、诊断三类 tab 具备 Arrow、Home 与 End 键盘语义', async () => {
    governanceMocks.read.mockResolvedValue(governanceProjection())
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(tab(host, '内容').getAttribute('aria-selected')).toBe('true'))

    const content = tab(host, '内容')
    await act(async () => content.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    })))
    expect(tab(host, 'Artifact').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab(host, 'Artifact'))
    expect(host.textContent).toContain('角色模块')

    await act(async () => tab(host, 'Artifact').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'End', bubbles: true, cancelable: true,
    })))
    expect(tab(host, '诊断').getAttribute('aria-selected')).toBe('true')
    expect(listRows(host).map(row => row.textContent?.includes('损坏的地区模块'))).toEqual([true])

    await act(async () => tab(host, '诊断').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Home', bubbles: true, cancelable: true,
    })))
    expect(tab(host, '内容').getAttribute('aria-selected')).toBe('true')

    await act(async () => tab(host, '内容').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowLeft', bubbles: true, cancelable: true,
    })))
    expect(tab(host, '诊断').getAttribute('aria-selected')).toBe('true')
  })

  it('明确区分完整性与生产验证，并把仅完整性Artifact放入诊断而非内容视图', async () => {
    const integrityOnly = governedArtifact({
      artifactKey: 'text-open-world.player-build',
      label: '自声明地区模块',
      kind: 'text-open-world.player-build',
      productionValidation: 'integrity-only',
    })
    governanceMocks.read.mockResolvedValue(governanceProjection({
      entities: [],
      artifacts: [integrityOnly],
    }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(host.textContent).toContain('生产验证 Artifact'))

    expect(host.textContent).toContain('仅完整性 Artifact')
    expect(listRows(host)).toHaveLength(0)
    await act(async () => tab(host, '诊断').click())
    expect(listRows(host)).toHaveLength(1)
    expect(listRows(host)[0].textContent).toContain('仅完整性通过')
    await act(async () => listRows(host)[0].click())
    expect(host.querySelector('[data-testid="text-open-world-creator-artifact-detail"]')?.textContent)
      .toContain('未获得产品生产验证')
    const editor = host.querySelector<HTMLElement>('[data-testid="mock-text-open-world-artifact-editor"]')!
    expect(editor.dataset.eligible).toBe('false')
    expect(editor.dataset.ineligibleReason).toContain('尚未通过产品生产合同验证')
  })

  it('只把当前 Build 中精确且生产验证通过的目标交给编辑器', async () => {
    const editable = governedArtifact({
      artifactKey: 'text-open-world.player-build',
      label: '玩家成长方案',
      kind: 'text-open-world.player-build',
    })
    const hero = {
      ...governedEntity({ key: 'hero', title: '巡灯人' }),
      artifactKey: editable.artifactKey,
      artifactVersion: editable.version,
      artifactContentHash: editable.contentHash,
    }
    governanceMocks.read.mockResolvedValue(governanceProjection({
      entities: [hero],
      artifacts: [editable],
    }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(host.textContent).toContain('巡灯人'))

    const entityEditor = host.querySelector<HTMLElement>('[data-testid="mock-text-open-world-artifact-editor"]')!
    expect(entityEditor.dataset.artifactKey).toBe(editable.artifactKey)
    expect(entityEditor.dataset.entityIdentity).toBe('character:hero')
    expect(entityEditor.dataset.buildId).toBe('81')
    expect(entityEditor.dataset.snapshotHash).toBe(HASH_B)
    await waitFor(() => expect(entityEditor.dataset.eligible).toBe('true'))

    await act(async () => tab(host, 'Artifact').click())
    const artifactEditor = host.querySelector<HTMLElement>('[data-testid="mock-text-open-world-artifact-editor"]')!
    expect(artifactEditor.dataset.artifactKey).toBe(editable.artifactKey)
    expect(artifactEditor.dataset.entityIdentity).toBe('')
    await waitFor(() => expect(artifactEditor.dataset.eligible).toBe('true'))
  })

  it('领域 dispatcher 预检拒绝时，已验证 Artifact 仍必须显示为不可编辑', async () => {
    const editable = governedArtifact({
      artifactKey: 'text-open-world.player-build',
      label: '玩家成长方案',
      kind: 'text-open-world.player-build',
    })
    const hero = {
      ...governedEntity({ key: 'hero', title: '巡灯人' }),
      artifactKey: editable.artifactKey,
      artifactVersion: editable.version,
      artifactContentHash: editable.contentHash,
    }
    governanceMocks.read.mockResolvedValue(governanceProjection({
      entities: [hero],
      artifacts: [editable],
    }))
    editMocks.prepare.mockRejectedValue(new Error('领域 dispatcher 拒绝该精确目标'))

    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(
      host.querySelector<HTMLElement>('[data-testid="mock-text-open-world-artifact-editor"]')
        ?.dataset.ineligibleReason,
    ).toContain('领域 dispatcher 拒绝'))

    const editor = host.querySelector<HTMLElement>(
      '[data-testid="mock-text-open-world-artifact-editor"]',
    )!
    expect(editor.dataset.eligible).toBe('false')
    expect(editor.dataset.ineligibleReason).toBe('领域 dispatcher 拒绝该精确目标')
    expect(editMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      artifactKey: editable.artifactKey,
      entityIdentity: 'character:hero',
      buildId: 81,
      expectedSnapshotHash: HASH_B,
    }))
  })

  it('领域 dispatcher 返回 editableFields=[] 时显式禁用编辑', async () => {
    const editable = governedArtifact({
      artifactKey: 'text-open-world.player-build',
      label: '玩家成长方案',
      kind: 'text-open-world.player-build',
    })
    const hero = {
      ...governedEntity({ key: 'hero', title: '巡灯人' }),
      artifactKey: editable.artifactKey,
      artifactVersion: editable.version,
      artifactContentHash: editable.contentHash,
    }
    governanceMocks.read.mockResolvedValue(governanceProjection({
      entities: [hero],
      artifacts: [editable],
    }))
    editMocks.prepare.mockResolvedValue({
      target: { artifactKey: editable.artifactKey, entityIdentity: 'character:hero' },
      editableFields: [],
    })

    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(
      host.querySelector<HTMLElement>('[data-testid="mock-text-open-world-artifact-editor"]')
        ?.dataset.ineligibleReason,
    ).toContain('没有登记的作者可修改字段'))

    const editor = host.querySelector<HTMLElement>(
      '[data-testid="mock-text-open-world-artifact-editor"]',
    )!
    expect(editor.dataset.eligible).toBe('false')
    expect(editor.dataset.ineligibleReason).toBe('该精确目标没有登记的作者可修改字段。')
  })

  it('安全搜索、类型与状态筛选生效，分页在 UI 中最多读取 50 条', async () => {
    const entities = Array.from({ length: 55 }, (_, index) => governedEntity({
      key: `entity-${String(index + 1).padStart(2, '0')}`,
      title: `实体 ${String(index + 1).padStart(2, '0')}`,
      kind: index % 2 === 0 ? 'character' : 'region',
      summary: index === 40 ? '唯一的灯塔线索' : `第 ${index + 1} 个公开摘要`,
    }))
    entities.push(governedEntity({
      key: 'dangling-only',
      title: '悬空测试实体',
      kind: 'quest',
      status: 'dangling',
    }))
    governanceMocks.read.mockResolvedValue(governanceProjection({ entities }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(listRows(host)).toHaveLength(30))

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => setInput(search, '灯塔线索'))
    expect(listRows(host)).toHaveLength(1)
    expect(listRows(host)[0].textContent).toContain('实体 41')

    await act(async () => setInput(search, ''))
    const type = selectByLabel(host, '类型')
    await act(async () => setSelect(type, 'region'))
    expect(listRows(host)).toHaveLength(27)
    expect(listRows(host).every(row => row.textContent?.includes('region'))).toBe(true)

    await act(async () => setSelect(type, 'all'))
    const status = selectByLabel(host, '状态')
    await act(async () => setSelect(status, 'dangling'))
    expect(listRows(host)).toHaveLength(1)
    expect(listRows(host)[0].textContent).toContain('悬空测试实体')

    await act(async () => setSelect(status, 'all'))
    const pageSize = selectByLabel(host, '每页')
    await act(async () => setSelect(pageSize, '50'))
    expect(listRows(host)).toHaveLength(50)
    expect(host.textContent).toContain('最多 50 条/页')
    const next = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('下一页'))!
    await act(async () => next.click())
    expect(listRows(host)).toHaveLength(6)
    expect(host.textContent).toContain('第 2/2 页')
  })

  it('刷新失败时保留上次成功快照和选中 locator', async () => {
    const first = governanceProjection({ title: '稳定快照世界', snapshotHash: HASH_A })
    governanceMocks.read.mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('当前 Build 读取失败'))
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
    })))
    await waitFor(() => expect(host.textContent).toContain('稳定快照世界'))
    const ferryman = host.querySelector<HTMLButtonElement>(
      '[data-open-world-artifact-locator="entity:character:ferryman"]',
    )!
    await act(async () => ferryman.click())
    expect(ferryman.getAttribute('aria-current')).toBe('true')

    const refresh = host.querySelector<HTMLButtonElement>('[aria-label="刷新受治理 Artifact 快照"]')!
    await act(async () => refresh.click())
    await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('当前 Build 读取失败'))
    expect(host.textContent).toContain('稳定快照世界')
    expect(host.textContent).toContain(HASH_A)
    expect(host.textContent).toContain('仍保留上一次成功读取的快照')
    expect(ferryman.getAttribute('aria-current')).toBe('true')
  })

  it('refreshToken 触发的并发读取只采纳最新一代响应', async () => {
    const oldRead = deferred<TextOpenWorldArtifactGovernanceProjectionV1>()
    const newRead = deferred<TextOpenWorldArtifactGovernanceProjectionV1>()
    governanceMocks.read.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
      refreshToken: 'old',
    })))
    await waitFor(() => expect(governanceMocks.read).toHaveBeenCalledTimes(1))

    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactBrowser, {
      scope: SCOPE,
      productionId: 71,
      refreshToken: 'new',
    })))
    await waitFor(() => expect(governanceMocks.read).toHaveBeenCalledTimes(2))
    await act(async () => newRead.resolve(governanceProjection({
      title: '最新快照世界',
      snapshotHash: HASH_B,
    })))
    await waitFor(() => expect(host.textContent).toContain('最新快照世界'))

    await act(async () => oldRead.resolve(governanceProjection({
      title: '过期快照世界',
      snapshotHash: HASH_A,
    })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('最新快照世界')
    expect(host.textContent).not.toContain('过期快照世界')
    expect(host.textContent).toContain(HASH_B)
  })
})
