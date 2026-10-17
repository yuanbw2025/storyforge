import { useEffect, useRef, useState } from 'react'

/** Active presentation time only. Menus/hidden tabs neither consume waits nor
 * allow an old timer to complete a different sentence/visit. */
export function useCueClock(key: string, marks: number[], paused: boolean): number {
  const progress = useRef({ key, elapsed: 0 })
  const [value, setValue] = useState({ key, elapsed: 0 })
  const signature = [...new Set(marks.filter(n => n > 0))].sort((a,b) => a-b).join(',')
  useEffect(() => {
    if (progress.current.key !== key) progress.current = { key, elapsed: 0 }
    setValue({ ...progress.current })
    if (paused) return
    const start = performance.now(), base = progress.current.elapsed
    let active = true
    const timers = signature.split(',').filter(Boolean).map(Number).filter(mark => mark > base).map(mark => window.setTimeout(() => {
      if (active) setValue({ key, elapsed: Math.max(mark, base+performance.now()-start) })
    }, mark-base))
    return () => { active = false; timers.forEach(window.clearTimeout); progress.current = { key, elapsed: base+performance.now()-start } }
  }, [key, signature, paused])
  return value.key === key ? value.elapsed : 0
}
