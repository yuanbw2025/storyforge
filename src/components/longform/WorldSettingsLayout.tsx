import { createContext, useContext, type ReactNode } from 'react'
import './world-settings-layout.css'

/** Admission belongs to WorkspacePage's already-resolved Work/mode/module.
 * Consumers receive presentation only; no product or data-owner inference. */
const Context = createContext<{ tools: ReactNode } | null>(null)
export const WorldSettingsLayoutProvider = Context.Provider
export const useWorldSettingsLayout = () => useContext(Context)

export function WorldSettingsToolbar({ title, search, actions }: {
  title: ReactNode; search?: ReactNode; actions?: ReactNode
}) {
  const layout = useWorldSettingsLayout()
  if (!layout) return null
  return <header className="lf-world-toolbar">
    <div className="lf-world-toolbar-heading"><h3>{title}</h3><p>设定作为后续创作依据。</p></div>
    {search && <div className="lf-world-toolbar-search">{search}</div>}
    <div className="lf-world-toolbar-actions">{actions}{layout.tools}</div>
  </header>
}
