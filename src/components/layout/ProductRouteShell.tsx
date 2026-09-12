import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import ApplicationHeader, { type ApplicationView } from './ApplicationHeader'
import './application-shell.css'

export interface ProductRouteNavItem {
  id: string
  label: string
  detail?: string
  icon: LucideIcon
  active?: boolean
  to?: string
  onClick?: () => void
}

interface Props {
  active: ApplicationView
  title: string
  caption: string
  items: ProductRouteNavItem[]
  children: ReactNode
  tone?: 'paper' | 'immersive'
}

export default function ProductRouteShell({ active, title, caption, items, children, tone = 'paper' }: Props) {
  const navigate = useNavigate()
  const selectGlobalView = (view: ApplicationView) => {
    navigate(view === 'home' ? '/' : `/?view=${view}`)
  }

  return <div className="sf-bronze-shell sf-product-route-shell" data-testid="product-route-shell">
    <ApplicationHeader active={active} onSelect={selectGlobalView} compact />
    <div className="sf-product-route-body">
      <aside className="sf-product-route-sidebar" aria-label={`${title}功能导航`} data-testid="product-route-context-nav">
        <div className="sf-product-route-identity">
          <span>{caption}</span>
          <strong>{title}</strong>
        </div>
        <nav>
          {items.map(item => {
            const Icon = item.icon
            const content = <><Icon aria-hidden="true" /><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span></>
            return item.to
              ? <Link key={item.id} to={item.to} className={item.active ? 'active' : undefined} aria-current={item.active ? 'page' : undefined}>{content}</Link>
              : <button key={item.id} type="button" onClick={item.onClick} className={item.active ? 'active' : undefined} aria-pressed={item.active || undefined}>{content}</button>
          })}
        </nav>
        <p className="sf-product-route-motto">故事，让更辽阔的人生在此相遇。</p>
      </aside>
      <div className="sf-product-route-content" data-tone={tone}>
        {children}
      </div>
    </div>
  </div>
}
