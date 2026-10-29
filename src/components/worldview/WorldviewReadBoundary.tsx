import { useState, type ReactNode } from 'react'
import { useWorldviewStore } from '../../stores/worldview'

/** Preserve the previous readback while an explicit retry verifies current data. */
export default function WorldviewReadBoundary({ onRetry, children }: { onRetry: () => Promise<void>; children: ReactNode }) {
  const { loading, loadError: error } = useWorldviewStore()
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    try { await onRetry() }
    catch { /* The store retains the read error and canonical values. */ }
    finally { setRetrying(false) }
  }
  return <>
    {error && <div role="alert" className="mb-3 rounded-lg border border-red-500/20 p-3 text-sm text-error">
      设定读取未完成：{error}。已有内容未被改写，请重新读取后继续编辑。
      <button type="button" disabled={loading || retrying} className="ml-3 underline disabled:opacity-50" onClick={() => { void retry() }}>重新读取设定</button>
    </div>}
    <fieldset aria-label="设定读取保护" disabled={loading || !!error} inert={loading || !!error} className="contents">{children}</fieldset>
  </>
}
