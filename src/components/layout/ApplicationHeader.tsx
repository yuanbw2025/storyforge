import { BookOpenText, ChevronDown, Flame, Gamepad2, Globe2, Home, Menu, MessageCircle, Plus, Search, Settings, Store, Swords } from 'lucide-react'
import { useNavigate } from 'react-router'
import './application-shell.css'

export type ApplicationView = 'home' | 'novel' | 'worlds' | 'ttrpg' | 'chat' | 'town' | 'text-games' | 'market'

const PRIMARY_VIEWS: Array<{ id: ApplicationView; label: string; icon: typeof Home }> = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'novel', label: '长篇创作', icon: BookOpenText },
  { id: 'worlds', label: '世界引擎', icon: Globe2 },
]

const MORE_VIEWS: Array<{ id: ApplicationView; label: string; icon: typeof Home }> = [
  { id: 'ttrpg', label: '跑团', icon: Swords },
  { id: 'chat', label: '角色聊天', icon: MessageCircle },
  { id: 'town', label: '后日谈小镇', icon: Home },
  { id: 'text-games', label: '文字游戏', icon: Gamepad2 },
  { id: 'market', label: '社区市场', icon: Store },
]

interface Props {
  active: ApplicationView
  onSelect?: (view: ApplicationView) => void
  isVisible?: (view: ApplicationView) => boolean
  onCreate?: () => void
  onSearch?: () => void
  compact?: boolean
}

export default function ApplicationHeader({ active, onSelect, isVisible, onCreate, onSearch, compact = false }: Props) {
  const navigate = useNavigate()
  const select = (view: ApplicationView) => {
    if (onSelect) {
      onSelect(view)
      return
    }
    window.location.assign(`${import.meta.env.BASE_URL}${view === 'home' ? '' : `?view=${view}`}`)
  }
  const moreViews = MORE_VIEWS.filter(view => isVisible?.(view.id) ?? true)
  const isMoreActive = moreViews.some(view => view.id === active)

  return <header className="sf-app-header" data-compact={compact || undefined}>
    <div className="sf-app-header-inner">
      <button className="sf-app-brand" onClick={() => select('home')} aria-label="返回 StoryForge 首页">
        <span className="sf-app-brand-mark"><Flame aria-hidden="true" /></span>
        <span className="sf-app-brand-copy"><strong>StoryForge</strong><small>故事熔炉</small></span>
      </button>
      <nav className="sf-app-global-nav" aria-label="产品页签">
        {PRIMARY_VIEWS.filter(view => isVisible?.(view.id) ?? true).map(view => {
          const Icon = view.icon
          return <button
            key={view.id}
            type="button"
            onClick={() => select(view.id)}
            className={active === view.id ? 'active' : ''}
            aria-current={active === view.id ? 'page' : undefined}
            data-testid={`product-tab-${view.id}`}
          ><Icon aria-hidden="true" /><span>{view.label}</span></button>
        })}
        {moreViews.length > 0 && <details className="sf-app-more-nav">
          <summary className={isMoreActive ? 'active' : ''} data-testid="product-more-menu"><Menu aria-hidden="true" /><span>更多功能</span><ChevronDown aria-hidden="true" /></summary>
          <div className="sf-app-more-menu">
            {moreViews.map(view => {
              const Icon = view.icon
              return <button
                key={view.id}
                type="button"
                onClick={event => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  select(view.id)
                }}
                className={active === view.id ? 'active' : ''}
                data-testid={`product-tab-${view.id}`}
              ><Icon aria-hidden="true" /><span>{view.label}</span></button>
            })}
          </div>
        </details>}
      </nav>
      <div className="sf-app-header-actions">
        {onSearch && <button className="sf-app-search" type="button" onClick={onSearch} title="搜索作品、世界与人物" aria-label="搜索世界"><Search aria-hidden="true" /><span>搜索作品、世界、人物或灵感…</span></button>}
        {onCreate && <button className="sf-app-create" type="button" onClick={onCreate}><Plus aria-hidden="true" /><span>新建</span></button>}
        <button className="sf-app-settings" type="button" onClick={() => navigate('/settings')} title="通用设置"><Settings aria-hidden="true" /><span>通用设置</span></button>
      </div>
    </div>
  </header>
}
