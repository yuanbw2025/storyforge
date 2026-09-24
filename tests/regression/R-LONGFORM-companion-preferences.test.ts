import { describe, expect, it } from 'vitest'
import { COMPANION_KEY, sanitizeCompanion, useCompanionStore } from '../../src/stores/companion'

describe('助手偏好与作品数据隔离', () => {
  it('拒绝远程、SVG 及无效立绘，默认浏览器语音且不自动朗读', () => {
    const value = sanitizeCompanion({ portrait: 'https://untrusted.example/image.png', inputMode: 'unknown', autoRead: 'yes', input: { apiKey: 'must-not-load' } })
    expect(value.portrait).toBe('')
    expect(value.inputMode).toBe('browser')
    expect(value.autoRead).toBe(false)
    expect(value.input.apiKey).toBe('')
    expect(sanitizeCompanion({ portrait: 'data:image/svg+xml;base64,abcd' }).portrait).toBe('')
  })
  it('长期偏好不保存密钥，服务密钥仅在会话存储，隐藏形象不会关闭文字或改写 Work', () => {
    const store = useCompanionStore.getState()
    store.update({ visible: false, input: { ...store.preferences.input, apiKey: 'isolated-session-key' } })
    const saved = JSON.parse(localStorage.getItem(COMPANION_KEY)!)
    expect(saved.visible).toBe(false)
    expect(saved.input.apiKey).toBe('')
    expect(localStorage.getItem(COMPANION_KEY)).not.toContain('isolated-session-key')
    expect(sessionStorage.getItem('storyforge-longform-voice-keys-v1')).toContain('isolated-session-key')
    expect(Object.keys(saved)).not.toContain('workId')
  })
})
