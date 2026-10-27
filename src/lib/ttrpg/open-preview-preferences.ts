import { useSyncExternalStore } from 'react'

// This browser preference only reveals experimental UI. It grants no seat,
// model, production, adoption, source or runtime authority.
const KEY = 'storyforge:ttrpg:open-preview:v1'
const EVENT = 'storyforge:ttrpg:open-preview-changed'
export function readTtrpgOpenPreviewEnabledV1(): boolean {
  if (import.meta.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW === '1') return true
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function saveTtrpgOpenPreviewEnabledV1(enabled: boolean): boolean {
  try {
    if (enabled) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch { return false }
  window.dispatchEvent(new Event(EVENT))
  return true
}
function subscribe(changed: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) changed() }
  window.addEventListener(EVENT, changed)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, changed); window.removeEventListener('storage', storage) }
}
export function useTtrpgOpenPreviewEnabledV1() {
  return useSyncExternalStore(subscribe, readTtrpgOpenPreviewEnabledV1, () => false)
}
