import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import ExperiencePackages from '../../src/components/character-interaction/ExperiencePackages'
import * as packages from '../../src/lib/character-interaction/experience-package'
import * as downloads from '../../src/lib/export/text-export'

let host: HTMLDivElement, root: Root
const scope = {projectId: 1, worldId: 2, workId: 3}
function preview(): packages.ChatExperiencePackagePreviewV1 {
  return {releaseVersion: 1, title: '驿站', description: '工程样本', bundleHash: 'a'.repeat(64), releaseHash: 'b'.repeat(64), existing: [],
    summary: {experienceInfo: null, kind: '剧情互动', actors: [{key: 'guard', name: '叶岑'}], media: [], credits: [], triggers: ['continue'], maxActions: 1, newSituations: false,
      opening: {title: '驿站', description: '工程样本', persona: null, canStartAction: true, scenes: []}}}
}
beforeEach(() => {vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host)})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
async function upload(read = async () => new ArrayBuffer(2)) {
  const input = host.querySelector('input')!
  Object.defineProperty(input, 'files', {value: [{size: 2, arrayBuffer: read}], configurable: true})
  await act(async () => input.dispatchEvent(new Event('change', {bubbles: true})))
}

it('only installs after the displayed preview is confirmed, rejects double clicks and keeps a failed preview for explicit retry', async () => {
  const value = preview(), onInstalled = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(packages, 'previewChatExperiencePackageV1').mockResolvedValue(value)
  const install = vi.spyOn(packages, 'installChatExperiencePackageV1').mockRejectedValue(new Error('磁盘空间不足'))
  await act(async () => root.render(createElement(ExperiencePackages, {scope, disabled: false, releases: [], onInstalled})))
  await upload()
  expect(host.textContent).toContain('驿站')
  expect(install).not.toHaveBeenCalled()
  const confirm = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '确认安装此体验包')!
  await act(async () => {confirm.click(); confirm.click()})
  expect(install).toHaveBeenCalledTimes(1)
  expect(onInstalled).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('磁盘空间不足')
  expect(confirm.disabled).toBe(false)
  install.mockResolvedValue({id: 10} as never)
  await act(async () => confirm.click())
  expect(install).toHaveBeenCalledTimes(2)
  expect(onInstalled).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[aria-label="体验包安装预览"]')).toBeNull()
})

it('cancels without installing and ignores file reads that finish after leaving the Work', async () => {
  const read = vi.spyOn(packages, 'previewChatExperiencePackageV1').mockResolvedValue(preview())
  const install = vi.spyOn(packages, 'installChatExperiencePackageV1')
  await act(async () => root.render(createElement(ExperiencePackages, {scope, disabled: false, releases: [], onInstalled: vi.fn()})))
  await upload()
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '取消安装')!.click())
  expect(host.querySelector('[aria-label="体验包安装预览"]')).toBeNull()
  let finish!: (value: ArrayBuffer) => void
  const pending = new Promise<ArrayBuffer>(resolve => {finish = resolve})
  await upload(() => pending)
  await act(async () => {root.unmount(); finish(new ArrayBuffer(2))})
  root = createRoot(host)
  expect(install).not.toHaveBeenCalled()
  // A late verification may complete locally, but can neither install nor
  // reintroduce its preview in the newly selected Work.
  expect(read).toHaveBeenCalledTimes(2)
  expect(host.textContent).toBe('')
})

it('does not offer a damaged local copy as an equivalent reinstall', async () => {
  const value = preview()
  value.existing.push({releaseId: 10, localVersion: 1, releaseHash: value.releaseHash, sameContent: true, summary: null, error: '本地内容损坏'})
  vi.spyOn(packages, 'previewChatExperiencePackageV1').mockResolvedValue(value)
  const install = vi.spyOn(packages, 'installChatExperiencePackageV1')
  await act(async () => root.render(createElement(ExperiencePackages, {scope, disabled: false, releases: [], onInstalled: vi.fn()})))
  await upload()
  expect(host.textContent).toContain('完整性检查未通过')
  expect(host.textContent).not.toContain('内容相同，重复安装将复用')
  expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === '确认安装此体验包')!.disabled).toBe(true)
  expect(install).not.toHaveBeenCalled()
})

it('shows a conflicting authored version before installation instead of promising to renumber it', async () => {
  const value = preview()
  value.existing.push({releaseId: 10, localVersion: value.releaseVersion, releaseHash: 'c'.repeat(64), sameContent: false, summary: null, error: null})
  vi.spyOn(packages, 'previewChatExperiencePackageV1').mockResolvedValue(value)
  const install = vi.spyOn(packages, 'installChatExperiencePackageV1')
  await act(async () => root.render(createElement(ExperiencePackages, {scope, disabled: false, releases: [], onInstalled: vi.fn()})))
  await upload()
  expect(host.textContent).toContain('同一发行版本号存在内容冲突')
  expect(host.textContent).not.toContain('内容不同，将并列保留')
  expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === '确认安装此体验包')!.disabled).toBe(true)
  expect(install).not.toHaveBeenCalled()
})

async function prepareExport() {
  const build = vi.spyOn(packages, 'exportChatExperiencePackageV1').mockResolvedValue({productRelease: {contentHash: 'a'.repeat(64)}} as never)
  await act(async () => root.render(createElement(ExperiencePackages, {
    scope, disabled: false, releases: [{id: 10, title: '驿站', version: 1}], onInstalled: vi.fn(),
  })))
  const select = host.querySelector('select')!
  await act(async () => {select.value = '10'; select.dispatchEvent(new Event('change', {bubbles: true}))})
  return {build, button: Array.from(host.querySelectorAll('button')).find(button => button.textContent === '导出完整体验包')!}
}

it.each(['已取消保存', '磁盘空间不足'])('waits for the file save receipt and keeps export available after %s', async message => {
  let fail!: (error: Error) => void
  const saving = new Promise<void>((_, reject) => {fail = reject})
  const save = vi.spyOn(downloads, 'downloadTextFile').mockImplementation(() => saving)
  const {build, button} = await prepareExport()
  await act(async () => {button.click(); button.click()})
  expect(build).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  expect(host.textContent).toContain('正在本地检查或保存体验包')
  expect(host.textContent).not.toContain('已导出完整体验包')
  await act(async () => fail(new Error(message)))
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(message)
  expect(host.textContent).not.toContain('已导出完整体验包')
  expect(button.disabled).toBe(false)
  save.mockImplementation(async () => {})
  await act(async () => button.click())
  expect(build).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenCalledTimes(2)
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.textContent).toContain('已导出完整体验包')
})

it('does not show a late save receipt in a newly selected Work', async () => {
  let finish!: () => void
  const save = vi.spyOn(downloads, 'downloadTextFile').mockImplementation(() => new Promise<void>(resolve => {finish = resolve}))
  const {button} = await prepareExport()
  await act(async () => button.click())
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(ExperiencePackages, {scope: {...scope, workId: 4}, disabled: false, releases: [], onInstalled: vi.fn()}))
    finish()
  })
  expect(host.textContent).not.toContain('已导出完整体验包')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
