import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import ExperienceInfo, {ExperienceInfoForm} from '../../src/components/character-interaction/ExperienceInfo'
import type {ChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'

let host: HTMLDivElement, root: Root
beforeEach(() => {vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host)})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()})
it('makes publication statements explicit and removable without inventing default terms', async () => {
  function Editor() {
    const [value, setValue] = useState<ChatExperienceInfoV1>()
    return createElement(ExperienceInfoForm, {value, disabled: false, onChange: setValue})
  }
  await act(async () => root.render(createElement(Editor)))
  const checkbox = host.querySelector('input')!
  expect(checkbox.checked).toBe(false)
  expect(host.querySelectorAll('textarea')).toHaveLength(0)
  await act(async () => checkbox.click())
  expect(host.querySelectorAll('textarea')).toHaveLength(3)
  expect((host.querySelector('[aria-label="作品使用说明"]') as HTMLTextAreaElement).value).toBe('')
  await act(async () => checkbox.click())
  expect(host.querySelectorAll('textarea')).toHaveLength(0)
})
it('renders declarations as plain text and identifies absent metadata without implying platform permission', async () => {
  const value = {version: 1 as const, author: '<img src=x onerror=alert(1)>', attribution: '资料归属', usageTerms: '仅供工程验证'}
  await act(async () => root.render(createElement(ExperienceInfo, {value})))
  expect(host.textContent).toContain(value.author)
  expect(host.querySelector('img')).toBeNull()
  expect(host.textContent).toContain('不证明作者身份或权利归属')
  await act(async () => root.render(createElement(ExperienceInfo, {value: null})))
  expect(host.textContent).toContain('未提供作品署名与使用说明')
  expect(host.textContent).not.toContain('仅供工程验证')
})
