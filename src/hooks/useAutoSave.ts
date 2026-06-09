import { useEffect, useRef } from 'react'

/**
 * 自动保存 Hook
 * 当 data 变化时，debounce 后调用 saveFn。
 * 组件卸载时如果有未保存的变更，会立即 flush 一次确保数据落盘。
 */
export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  delay: number = 1500,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFnRef = useRef(saveFn)
  const dataRef = useRef(data)
  const dirtyRef = useRef(false)
  const isFirstRender = useRef(true)

  // 始终使用最新的 saveFn 和 data
  saveFnRef.current = saveFn
  dataRef.current = data

  useEffect(() => {
    // 跳过首次渲染
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    // 标记有待保存的变更
    dirtyRef.current = true

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      dirtyRef.current = false
      saveFnRef.current(data)
    }, delay)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [data, delay])

  // 组件卸载时：如果有未保存的变更，立即 flush
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        saveFnRef.current(dataRef.current)
      }
    }
  }, [])
}
