import { lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Bot, Database, Palette, SlidersHorizontal } from 'lucide-react'
import ApplicationHeader from '../components/layout/ApplicationHeader'

const SettingsPage = lazy(() => import('../components/settings/SettingsPage'))

export default function SettingsRoutePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedReturn = params.get('returnTo') ?? ''
  const returnTo = /^\/play(?:\/[a-zA-Z0-9./-]+)?$/.test(requestedReturn) && !requestedReturn.includes('..') ? requestedReturn : '/'
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="sf-settings-shell sf-bronze-shell">
      <ApplicationHeader
        active="home"
        compact
        onSelect={view => window.location.assign(`${import.meta.env.BASE_URL}${view === 'home' ? '' : `?view=${view}`}`)}
      />
      <div className="sf-settings-body">
        <aside className="sf-settings-nav" aria-label="设置导航">
          <button onClick={() => navigate(returnTo)}><ArrowLeft aria-hidden="true" /><span><strong>{returnTo === '/' ? '返回首页' : '返回冒险'}</strong><small>回到刚才的工作区</small></span></button>
          <div className="sf-context-caption">通用设置</div>
          <button className="active" onClick={() => scrollTo('settings-ai')}><Bot aria-hidden="true" /><span><strong>模型与连接</strong><small>服务商、密钥和预设</small></span></button>
          <button onClick={() => scrollTo('settings-routing')}><SlidersHorizontal aria-hidden="true" /><span><strong>默认策略</strong><small>任务路由与预算</small></span></button>
          <button onClick={() => scrollTo('settings-appearance')}><Palette aria-hidden="true" /><span><strong>外观与操作</strong><small>主题和使用偏好</small></span></button>
          <button onClick={() => scrollTo('settings-storage')}><Database aria-hidden="true" /><span><strong>工作区与数据</strong><small>本机保存和导入导出</small></span></button>
        </aside>
        <main className="sf-settings-content">
          <div className="sf-settings-heading">
            <div className="sf-eyebrow">GLOBAL PREFERENCES</div>
            <h1>通用设置</h1>
            <p>这里只管理跨产品共用的模型连接、默认路由、主题和本机数据。具体产品的来源适配、生产参数与发布配置仍在对应产品内管理。</p>
          </div>
          <Suspense fallback={<div className="p-6 text-sm text-text-muted">设置加载中…</div>}>
            <SettingsPage />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
