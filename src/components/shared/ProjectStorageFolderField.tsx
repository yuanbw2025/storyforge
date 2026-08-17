import { useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import {
  ensureFolderPermission,
  isFSASupported,
  pickFolder,
} from '../../lib/storage/folder-backup'

interface Props {
  value: FileSystemDirectoryHandle | null
  onChange: (handle: FileSystemDirectoryHandle) => void
  disabled?: boolean
}

/** Optional project-location field shared by every project creation entry. */
export default function ProjectStorageFolderField({ value, onChange, disabled = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = isFSASupported()

  const choose = async () => {
    setBusy(true)
    setError('')
    try {
      const handle = await pickFolder({
        id: 'storyforge-project-location',
        startIn: value ?? undefined,
      })
      if (!handle) return
      if (!(await ensureFolderPermission(handle))) {
        setError('没有获得该文件夹的读写权限')
        return
      }
      onChange(handle)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5" data-testid="project-storage-folder-field">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-base px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs text-text-secondary">项目存储位置</p>
          <p className="truncate text-xs text-text-muted">
            {value ? `已选择：${value.name}` : supported ? '尚未选择，可稍后在设置中指定' : '当前浏览器不支持直接选择硬盘文件夹'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void choose()}
          disabled={disabled || busy || !supported}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          {value ? '更换文件夹' : '选择项目文件夹'}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-text-muted">
        可选择任意硬盘位置。创建后它就是本项目的存储工作区；首次写入仍需你核对并确认。
      </p>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  )
}
