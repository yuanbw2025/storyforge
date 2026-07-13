import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import {
  setBackupDialogAdapter,
  type BackupChoice,
  type RequireBackupOptions,
} from '../../lib/safety/require-backup-before'

type DialogTone = 'info' | 'danger'

interface DialogOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  tone?: DialogTone
  defaultValue?: string
  placeholder?: string
}

interface DialogContextValue {
  alert: (options: DialogOptions | string) => Promise<void>
  confirm: (options: DialogOptions | string) => Promise<boolean>
  prompt: (options: DialogOptions | string) => Promise<string | null>
}

type DialogMode = 'alert' | 'confirm' | 'prompt'

interface DialogState extends DialogOptions {
  mode: DialogMode
  resolve: (value: boolean | string | null) => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

function normalizeOptions(options: DialogOptions | string): DialogOptions {
  return typeof options === 'string' ? { title: options } : options
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [inputValue, setInputValue] = useState('')

  const open = useCallback((mode: DialogMode, options: DialogOptions | string) => new Promise<boolean | string | null>((resolve) => {
    const next = normalizeOptions(options)
    setInputValue(next.defaultValue ?? '')
    setDialog({ ...next, mode, resolve })
  }), [])

  const close = useCallback((value: boolean | string | null) => {
    setDialog(current => {
      current?.resolve(value)
      return null
    })
  }, [])

  const api = useMemo<DialogContextValue>(() => ({
    alert: async (options) => { await open('alert', options) },
    confirm: async (options) => Boolean(await open('confirm', options)),
    prompt: async (options) => {
      const value = await open('prompt', options)
      return typeof value === 'string' ? value : null
    },
  }), [open])

  useEffect(() => {
    setBackupDialogAdapter({
      chooseBackup: async (options: RequireBackupOptions): Promise<BackupChoice> => {
        const proceed = await api.confirm({
          title: `危险操作:${options.operation}`,
          message: [
            options.details,
            '此操作不可恢复。是否继续？下一步会询问是否立即备份。',
          ].filter(Boolean).join('\n\n'),
          confirmText: options.confirmLabel ?? '继续',
          cancelText: options.cancelLabel ?? '取消',
          tone: 'danger',
        })
        if (!proceed) return 'cancel'
        if (options.projectId == null) return 'proceed-already-backed-up'

        const wantBackup = await api.confirm({
          title: '是否立即下载备份(JSON 文件到本地)?',
          message: '确认后会立即下载备份，然后继续；取消表示你已经备份过，直接继续。',
          confirmText: '立即备份',
          cancelText: '已备份，继续',
        })
        return wantBackup ? 'proceed-backup-now' : 'proceed-already-backed-up'
      },
      confirm: api.confirm,
    })
    return () => setBackupDialogAdapter(null)
  }, [api])

  const isDanger = dialog?.tone === 'danger'
  const Icon = isDanger ? AlertTriangle : Info

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-surface shadow-2xl">
            <div className="flex items-start gap-3 border-b border-border px-4 py-3">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isDanger ? 'text-error' : 'text-accent'}`} />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-text-primary">{dialog.title}</h2>
                {dialog.message && (
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-muted">{dialog.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => close(dialog.mode === 'alert' ? true : null)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {dialog.mode === 'prompt' && (
              <div className="px-4 py-3">
                <input
                  autoFocus
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') close(inputValue)
                    if (e.key === 'Escape') close(null)
                  }}
                  placeholder={dialog.placeholder}
                  className="w-full rounded border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 px-4 py-3">
              {dialog.mode !== 'alert' && (
                <button
                  type="button"
                  onClick={() => close(null)}
                  className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                >
                  {dialog.cancelText ?? '取消'}
                </button>
              )}
              <button
                type="button"
                onClick={() => close(dialog.mode === 'prompt' ? inputValue : true)}
                className={`rounded px-3 py-1.5 text-sm font-medium text-white ${
                  isDanger ? 'bg-error hover:bg-error/90' : 'bg-accent hover:bg-accent-hover'
                }`}
              >
                {dialog.confirmText ?? (dialog.mode === 'alert' ? '知道了' : '确认')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}
