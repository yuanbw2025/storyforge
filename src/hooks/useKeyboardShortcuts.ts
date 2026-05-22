import { useEffect } from 'react'

interface ShortcutMap {
  [key: string]: () => void
}

/**
 * 全局键盘快捷键 Hook
 * 
 * key 格式: "mod+s", "mod+enter", "escape", "mod+shift+s"
 * "mod" 在 macOS 上是 Cmd，其他平台是 Ctrl
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes('MAC')

    const handler = (e: KeyboardEvent) => {
      const parts: string[] = []
      const modKey = isMac ? e.metaKey : e.ctrlKey
      if (modKey) parts.push('mod')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')

      // 获取按键名
      let key = e.key.toLowerCase()
      if (key === ' ') key = 'space'

      parts.push(key)
      const combo = parts.join('+')

      const action = shortcuts[combo]
      if (action) {
        e.preventDefault()
        e.stopPropagation()
        action()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])
}

/**
 * 常用快捷键预设
 */
export function useWorkspaceShortcuts(actions: {
  onSave?: () => void
  onGenerate?: () => void
  onEscape?: () => void
  onExport?: () => void
}) {
  useKeyboardShortcuts({
    ...(actions.onSave ? { 'mod+s': actions.onSave } : {}),
    ...(actions.onGenerate ? { 'mod+enter': actions.onGenerate } : {}),
    ...(actions.onEscape ? { 'escape': actions.onEscape } : {}),
    ...(actions.onExport ? { 'mod+shift+e': actions.onExport } : {}),
  })
}
