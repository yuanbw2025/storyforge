import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgOpenIdentityKnowledgePanel from '../../src/components/ttrpg/TtrpgOpenIdentityKnowledgePanel'
import { readTtrpgOpenIdentityKnowledgeDeskV1, prepareTtrpgOpenIdentityKnowledgeV1, confirmTtrpgOpenIdentityKnowledgeReviewV1,
  type TtrpgOpenIdentityKnowledgeDeskV1, type TtrpgOpenIdentityKnowledgeReviewV1 } from '../../src/lib/ttrpg/open-identity-knowledge-service'

vi.mock('../../src/lib/ttrpg/open-identity-knowledge-service', () => ({ readTtrpgOpenIdentityKnowledgeDeskV1: vi.fn(), prepareTtrpgOpenIdentityKnowledgeV1: vi.fn(), confirmTtrpgOpenIdentityKnowledgeReviewV1: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const read = vi.mocked(readTtrpgOpenIdentityKnowledgeDeskV1), prepare = vi.mocked(prepareTtrpgOpenIdentityKnowledgeV1), confirm = vi.mocked(confirmTtrpgOpenIdentityKnowledgeReviewV1)
const input = { scope: { projectId: 1, worldId: 2, workId: 3 }, sessionId: 4, viewerKey: 'viewer.a' }
function page(name = '已知人物甲'): TtrpgOpenIdentityKnowledgeDeskV1 {
  return { sequence: 10, actorKey: 'hero', humanGm: false, canReview: true, players: [{ actorKey: 'hero', name: '调查者' }],
    roots: [{ knowledgeKey: 'knowledge.root', title: '原观察', description: '本人实际获得的线索', observerActorKeys: ['hero'] }],
    instances: [{ entityRef: 'entity.fixture', kind: 'actor', name }], shareSources: [],
    learned: [{ entityRef: 'entity.fixture', kind: 'actor', name, evidence: '原观察', reliability: 'observed' }] }
}
function review(name = '这次明确识别的人物'): TtrpgOpenIdentityKnowledgeReviewV1 {
  return { schema: 'storyforge.ttrpg-open-identity-knowledge-review', version: 1, reviewKey: 'review.fixture', mode: 'observation',
    evidence: { title: '原观察', description: '这次核对的原文' }, identities: [{ entityRef: 'entity.fixture', kind: 'actor', name }], recipients: ['调查者'], audience: 'private' }
}
describe('R-TTRPGOPEN9 identity human review UI', () => {
  let host: HTMLDivElement, root: Root, props: Parameters<typeof TtrpgOpenIdentityKnowledgePanel>[0]
  const render = () => root.render(createElement(TtrpgOpenIdentityKnowledgePanel, props))
  const button = (name: string) => [...host.querySelectorAll('button')].find(row => row.textContent === name)!
  const checkbox = (name: string) => [...host.querySelectorAll('label')].find(row => row.textContent === name)!.querySelector('input')!
  async function click(name: string) { await act(async () => button(name).click()) }
  async function select() {
    await act(async () => {
      const value = host.querySelector<HTMLSelectElement>('select[aria-label="原知识"]')!; value.value = 'knowledge.root'; value.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { checkbox('已知人物甲').click(); checkbox('调查者').click() })
    await click('核对这次内容与接收者')
  }
  beforeEach(() => {
    vi.resetAllMocks(); read.mockResolvedValue(page()); prepare.mockResolvedValue(review()); confirm.mockResolvedValue({ sequence: 11, knowledgeKey: 'knowledge.saved' })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    props = { input, sequence: 10, busy: false, onChanged: vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  it('only reads on mount and saves after exact content and recipient acknowledgement', async () => {
    const r = review(); prepare.mockResolvedValue(r); await act(async () => render())
    expect(prepare).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
    await select(); expect(host.textContent).toContain('对象：这次明确识别的人物')
    const save = button('明确保存这次知识'); expect(save.disabled).toBe(true)
    await act(async () => checkbox('我已核对这次身份、原观察与接收者').click())
    await act(async () => { save.click(); save.click() })
    expect(confirm).toHaveBeenCalledTimes(1); expect(props.onChanged).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toEqual({ ...input, review: r, decision: 'confirm-these-identities-and-recipients' })
    expect(prepare.mock.calls[0][0].request).toEqual({ mode: 'observation', actorKey: 'hero', sourceKnowledgeKey: 'knowledge.root', entityRefs: ['entity.fixture'], audience: 'private', recipientActorKeys: ['hero'] })
  })
  it('retains the exact original pending review for a storage retry', async () => {
    const r = review(); prepare.mockResolvedValue(r); confirm.mockRejectedValueOnce(new Error('原存储暂时失败'))
    await act(async () => render()); await select()
    await act(async () => checkbox('我已核对这次身份、原观察与接收者').click())
    await click('明确保存这次知识'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('原存储暂时失败')
    await click('明确保存这次知识')
    expect(confirm).toHaveBeenCalledTimes(2); expect(confirm.mock.calls.every(call => call[0].review === r)).toBe(true); expect(prepare).toHaveBeenCalledTimes(1)
  })
  it('rejects a late read from an earlier visit even after returning to the same viewer', async () => {
    let done!: (value: TtrpgOpenIdentityKnowledgeDeskV1) => void
    read.mockImplementationOnce(() => new Promise(resolve => { done = resolve })).mockResolvedValueOnce(page('乙的私域人物')).mockResolvedValueOnce(page('甲的新访问人物'))
    await act(async () => render()); props = { ...props, input: { ...input, viewerKey: 'viewer.b' } }; await act(async () => render())
    expect(host.textContent).toContain('乙的私域人物')
    props = { ...props, input }; await act(async () => render()); expect(host.textContent).toContain('甲的新访问人物')
    await act(async () => { done(page('旧访问不应返回的私域人物')) })
    expect(host.textContent).not.toMatch(/旧访问不应返回的私域人物|乙的私域人物/)
  })
  it('does not restore a late review into a different identity or a later visit', async () => {
    let done!: (value: TtrpgOpenIdentityKnowledgeReviewV1) => void
    prepare.mockImplementationOnce(() => new Promise(resolve => { done = resolve }))
    await act(async () => render()); await select()
    props = { ...props, input: { ...input, viewerKey: 'viewer.b' } }; await act(async () => render())
    props = { ...props, input }; await act(async () => render())
    await act(async () => { done(review('旧身份核对秘密')) })
    expect(host.querySelector('[aria-label="身份知识确认"]')).toBeNull(); expect(host.textContent).not.toContain('旧身份核对秘密')
  })
  it('hides stale private labels immediately while reading a new sequence, including a failed refresh', async () => {
    await act(async () => render()); expect(host.textContent).toContain('已知人物甲')
    let reject!: (cause: Error) => void; read.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    props = { ...props, sequence: 11 }; await act(async () => render()); expect(host.textContent).not.toContain('已知人物甲')
    await act(async () => { reject(new Error('原读取暂时失败')) })
    expect(host.textContent).not.toContain('已知人物甲'); expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })
})
