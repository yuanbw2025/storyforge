import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import ReleaseUpgrade from '../../src/components/character-interaction/ReleaseUpgrade'
import * as plans from '../../src/lib/character-interaction/release-upgrade-plan'
import * as upgrades from '../../src/lib/character-interaction/release-upgrade'

let host: HTMLDivElement, root: Root
const scope = {projectId: 1, worldId: 2, workId: 3}
function plan(): plans.ChatReleaseUpgradePlanV1 {
  return {parentSessionId: 7, targetReleaseId: 9, sourceTitle: '雨夜原存档', targetTitle: '图片新版', sourceSequence: 11, sourceStateHash: 'a'.repeat(64), blockers: [], canCopy: true, planHash: 'b'.repeat(64),
    compatibility: {schema: 'storyforge.chat-release-upgrade-compatibility', version: 1, sourceReleaseHash: 'c'.repeat(64), targetReleaseHash: 'd'.repeat(64), sourcePackageHash: 'e'.repeat(64),
      targetPackageHash: 'f'.repeat(64), disposition: 'copy-preserving-story', blockers: [], changes: ['pictures', 'release-metadata'], compatibilityHash: '1'.repeat(64)}}
}
beforeEach(() => {vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host)})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(value => value.textContent === text)!
async function render(onCopied = vi.fn().mockResolvedValue(undefined), onRollback = vi.fn().mockResolvedValue(undefined)) {
  await act(async () => root.render(createElement(ReleaseUpgrade, {scope, sessionId: 7, disabled: false,
    releases: [{id: 9, title: '图片新版', version: 2}], rollback: {id: 5, title: '来源存档'}, onCopied, onRollback})))
}
async function preview() {
  const select = host.querySelector('select')!
  await act(async () => {select.value = '9'; select.dispatchEvent(new Event('change', {bubbles: true}))})
  await act(async () => button('检查存档兼容性').click())
}
it('previews before confirmation and retries the same receipt identity after failure, without double copies', async () => {
  vi.spyOn(plans, 'readChatReleaseUpgradePlanV1').mockResolvedValue(plan())
  const copy = vi.spyOn(upgrades, 'copyChatSaveToReleaseV1').mockRejectedValue(new Error('保存结果尚未读回'))
  const onCopied = vi.fn().mockResolvedValue(undefined)
  await render(onCopied); await preview()
  expect(copy).not.toHaveBeenCalled()
  expect(host.textContent).toContain('记忆、关系和剧情进展')
  expect(host.textContent).toContain('未发送草稿留在原存档')
  await act(async () => {button('确认创建升级副本').click(); button('确认创建升级副本').click()})
  expect(copy).toHaveBeenCalledTimes(1)
  expect(onCopied).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('尚未读回')
  copy.mockResolvedValue({id: 10} as never)
  await act(async () => button('确认创建升级副本').click())
  expect(copy).toHaveBeenCalledTimes(2)
  expect(copy.mock.calls[1][0].request).toEqual(copy.mock.calls[0][0].request)
  expect(onCopied).toHaveBeenCalledWith(10)
})
it('shows concrete incompatibility and unfinished-run reasons, supports cancel and explicitly returns to the old save', async () => {
  const value = plan(); value.canCopy = false; value.blockers = ['unfinished-run']; value.compatibility.blockers = ['character-knowledge']; value.compatibility.disposition = 'new-session-required'
  vi.spyOn(plans, 'readChatReleaseUpgradePlanV1').mockResolvedValue(value)
  const copy = vi.spyOn(upgrades, 'copyChatSaveToReleaseV1'), rollback = vi.fn().mockResolvedValue(undefined)
  await render(vi.fn(), rollback); await preview()
  expect(host.textContent).toContain('人物身份、角色资料或知识边界有变化')
  expect(host.textContent).toContain('结果待确认的生成任务')
  expect(button('确认创建升级副本')).toBeUndefined()
  await act(async () => button('取消升级').click())
  expect(host.querySelector('[aria-label="存档升级预览"]')).toBeNull()
  await act(async () => button('返回原存档').click())
  expect(rollback).toHaveBeenCalledWith(5)
  expect(copy).not.toHaveBeenCalled()
})
it('ignores a late compatibility read after leaving the save', async () => {
  let finish!: (value: plans.ChatReleaseUpgradePlanV1) => void
  vi.spyOn(plans, 'readChatReleaseUpgradePlanV1').mockImplementation(() => new Promise(resolve => {finish = resolve}))
  const copy = vi.spyOn(upgrades, 'copyChatSaveToReleaseV1')
  await render(); await preview()
  await act(async () => {root.unmount(); finish(plan())})
  root = createRoot(host)
  expect(host.textContent).toBe('')
  expect(copy).not.toHaveBeenCalled()
})

it('shows both versions of public statements before asking to create a copy', async () => {
  const value = plan()
  value.compatibility.sourceExperienceInfo = null
  value.compatibility.targetExperienceInfo = {version: 1, author: '公开署名', attribution: '', usageTerms: '新版本使用说明'}
  vi.spyOn(plans, 'readChatReleaseUpgradePlanV1').mockResolvedValue(value)
  const copy = vi.spyOn(upgrades, 'copyChatSaveToReleaseV1')
  await render(); await preview()
  expect(host.querySelector('[aria-label="原版本作品说明"]')!.textContent).toContain('未提供')
  expect(host.querySelector('[aria-label="目标版本作品说明"]')!.textContent).toContain('新版本使用说明')
  expect(copy).not.toHaveBeenCalled()
  await act(async () => button('取消升级').click())
  expect(copy).not.toHaveBeenCalled()
})
