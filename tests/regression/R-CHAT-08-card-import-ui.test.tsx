import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import CharacterCardImport from '../../src/components/character-interaction/CharacterCardImport'
import * as cards from '../../src/lib/character-interaction/character-card'
import {chatCharacterCardFixture} from '../helpers/chat-character-card-fixture'

let host: HTMLDivElement, root: Root
const bytes = () => new TextEncoder().encode(JSON.stringify(chatCharacterCardFixture())).buffer
const file = (name: string, read = async () => bytes()) => ({name, size: 1024, arrayBuffer: read})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
async function upload(value: ReturnType<typeof file>) {
  const input = host.querySelector('input')!
  Object.defineProperty(input, 'files', {value: [value], configurable: true})
  await act(async () => {input.dispatchEvent(new Event('change', {bubbles: true}))})
}

it('never imports on read, requires identity and a click, and presents ignored fields as plain text', async () => {
  const onImport = vi.fn(), preview = await cards.previewChatCharacterCardV2({bytes: bytes(), fileName: 'card.json'})
  vi.spyOn(cards, 'previewChatCharacterCardV2').mockResolvedValue(preview)
  await act(async () => root.render(createElement(CharacterCardImport, {disabled: false, onImport})))
  await upload(file('card.json'))
  expect(host.textContent).toContain('桥灯 · 外部卡片设定')
  expect(onImport).not.toHaveBeenCalled()
  const confirm = host.querySelector('button')!
  expect(confirm.disabled).toBe(true)
  expect(host.textContent).toContain('/data/system_prompt')
  expect(host.textContent).not.toContain('CARD_SYSTEM_MUST_NOT_EXECUTE')
  const identity = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(identity, '修灯人')
    identity.dispatchEvent(new Event('input', {bubbles: true}))
  })
  expect(confirm.disabled).toBe(false)
  await act(async () => {confirm.click(); confirm.click()})
  expect(onImport).toHaveBeenCalledTimes(1)
  expect(onImport.mock.calls[0][0]).toMatchObject({name: '桥灯', identity: '修灯人', cardOrigin: {fileName: 'card.json'}})
})

it('ignores a late read after unmount and reports malformed files without a candidate', async () => {
  const onImport = vi.fn(); let finish!: (bytes: ArrayBuffer) => void
  const pending = new Promise<ArrayBuffer>(resolve => {finish = resolve})
  vi.spyOn(cards, 'previewChatCharacterCardV2').mockRejectedValue(new Error('无法读取 JSON'))
  await act(async () => root.render(createElement(CharacterCardImport, {disabled: false, onImport})))
  await upload(file('late.json', () => pending))
  await act(async () => {root.unmount(); finish(bytes())})
  root = createRoot(host)
  await act(async () => root.render(createElement(CharacterCardImport, {disabled: false, onImport})))
  await upload(file('bad.json'))
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('无法读取 JSON')
  expect(host.querySelector('[data-testid="chat-card-preview"]')).toBeNull()
  expect(onImport).not.toHaveBeenCalled()
})
