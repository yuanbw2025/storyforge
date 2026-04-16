import { useCallback, useState } from 'react'

export interface FSAHandle {
  directoryHandle: FileSystemDirectoryHandle
  path: string
}

/** 检查浏览器是否支持 File System Access API */
export function isFSASupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/**
 * File System Access API Hook
 * 允许用户绑定本地文件夹，自动将项目 JSON 写入磁盘
 */
export function useFileSystemAccess() {
  const [handle, setHandle] = useState<FSAHandle | null>(null)
  const [writing, setWriting] = useState(false)

  /** 请求用户选择目录 */
  const pickDirectory = useCallback(async (): Promise<FSAHandle | null> => {
    if (!isFSASupported()) {
      alert('你的浏览器不支持 File System Access API，请使用 Chrome 或 Edge。')
      return null
    }
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
      const fsaHandle: FSAHandle = {
        directoryHandle: dirHandle,
        path: dirHandle.name,
      }
      setHandle(fsaHandle)
      return fsaHandle
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[FSA] 选择目录失败:', err)
      }
      return null
    }
  }, [])

  /** 将 JSON 数据写入文件夹下的指定文件名 */
  const writeFile = useCallback(
    async (filename: string, content: string, fsaHandle?: FSAHandle | null): Promise<boolean> => {
      const target = fsaHandle ?? handle
      if (!target) return false
      setWriting(true)
      try {
        const fileHandle = await target.directoryHandle.getFileHandle(filename, { create: true })
        const writable = await (fileHandle as any).createWritable()
        await writable.write(content)
        await writable.close()
        return true
      } catch (err) {
        console.error('[FSA] 写入文件失败:', err)
        return false
      } finally {
        setWriting(false)
      }
    },
    [handle]
  )

  /** 清除绑定 */
  const clearHandle = useCallback(() => {
    setHandle(null)
  }, [])

  return { handle, writing, pickDirectory, writeFile, clearHandle }
}
