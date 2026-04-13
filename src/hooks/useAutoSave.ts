import { useEffect, useRef } from 'react'

/**
 * 自动保存 Hook
 * 当 data 变化时，debounce 后调用 saveFn
 */
export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  delay: number = 1500,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFnRef = useRef(saveFn)
  const isFirstRender = useRef(true)

  // 始终使用最新的 saveFn
  saveFnRef.current = saveFn

  useEffect(() => {
    // 跳过首次渲染
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      saveFnRef.current(data)
    }, delay)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [data, delay])
}
