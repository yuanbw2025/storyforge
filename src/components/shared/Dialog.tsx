import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

const noopDialog: DialogContextValue = {
  alert: async () => {},
  confirm: async () => false,
  prompt: async () => null,
}

const DialogContext = createContext<DialogContextValue>(noopDialog)

function normalizeOptions(options: DialogOptions | string): DialogOptions {
  return typeof options === 'string' ? { title: options } : options
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [inputValue, setInputValue] = useState('')
  const currentDialog = useRef<DialogState | null>(null)
  const mounted = useRef(true)

  const open = useCallback((mode: DialogMode, options: DialogOptions | string) => new Promise<boolean | string | null>((resolve) => {
    if (!mounted.current) { resolve(null); return }
    // Replacing a question cancels its caller; a hidden question cannot grant
    // permission later or leave a destructive operation waiting indefinitely.
    currentDialog.current?.resolve(null)
    const next = normalizeOptions(options)
    const pending = { ...next, mode, resolve }
    currentDialog.current = pending
    setInputValue(next.defaultValue ?? '')
    setDialog(pending)
  }), [])

  const close = useCallback((expected: DialogState, value: boolean | string | null) => {
    if (currentDialog.current !== expected) return
    currentDialog.current = null
    setDialog(current => current === expected ? null : current)
    expected.resolve(value)
  }, [])

  // Restore the live owner before child passive effects open a new question
  // during StrictMode's cleanup/setup cycle.
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const pending = currentDialog.current
      currentDialog.current = null
      pending?.resolve(null)
      if (pending) setDialog(current => current === pending ? null : current)
    }
  }, [])

  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(dialog, dialog.mode === 'alert' ? true : null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dialog, close])

  const api = useMemo<DialogContextValue>(() => ({
    alert: async (options) => { await open('alert', options) },
    confirm: async (options) => Boolean(await open('confirm', options)),
    prompt: async (options) => {
      const value = await open('prompt', options)
      return typeof value === 'string' ? value : null
    },
  }), [open])

  useEffect(() => {
    return setBackupDialogAdapter({
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

        // Keep the explicit negative button distinct from X/Escape/unmount.
        // The public Boolean confirm API intentionally does not expose this.
        const wantBackup = await open('confirm', {
          title: '是否立即下载备份(JSON 文件到本地)?',
          message: '立即备份成功后继续；如果已经自行备份，可选择「已备份，继续」。关闭此窗口将取消当前操作。',
          confirmText: '立即备份',
          cancelText: '已备份，继续',
        })
        if (wantBackup === true) return 'proceed-backup-now'
        return wantBackup === false ? 'proceed-already-backed-up' : 'cancel'
      },
      confirm: api.confirm,
    })
  }, [api, open])

  const isDanger = dialog?.tone === 'danger'
  const Icon = isDanger ? AlertTriangle : Info

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 px-4">
          <div
            className="w-full max-w-lg rounded-3xl border border-border bg-bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storyforge-dialog-title"
          >
            <div className="flex items-start gap-3 border-b border-border px-6 py-5">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isDanger ? 'text-error' : 'text-accent'}`} />
              <div className="min-w-0 flex-1">
                <h2 id="storyforge-dialog-title" className="font-serif text-xl text-text-primary">{dialog.title}</h2>
                {dialog.message && (
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-muted">{dialog.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => close(dialog, dialog.mode === 'alert' ? true : null)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {dialog.mode === 'prompt' && (
              <div className="px-6 py-5">
                <input
                  autoFocus
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') close(dialog, inputValue)
                    if (e.key === 'Escape') close(dialog, null)
                  }}
                  placeholder={dialog.placeholder}
                  className="w-full rounded-xl border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 px-6 py-5">
              {dialog.mode !== 'alert' && (
                <button
                  type="button"
                  onClick={() => close(dialog, dialog.mode === 'confirm' ? false : null)}
                  className="rounded-full border border-border px-5 py-2.5 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                >
                  {dialog.cancelText ?? '取消'}
                </button>
              )}
              <button
                type="button"
                onClick={() => close(dialog, dialog.mode === 'prompt' ? inputValue : true)}
                className={`rounded-full px-5 py-2.5 text-sm font-medium text-white ${
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
  return useContext(DialogContext)
}
