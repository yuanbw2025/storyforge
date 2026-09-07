import { lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'

const SettingsPage = lazy(() => import('../components/settings/SettingsPage'))

export default function SettingsRoutePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedReturn = params.get('returnTo') ?? ''
  const returnTo = /^\/play(?:\/[a-zA-Z0-9./-]+)?$/.test(requestedReturn) && !requestedReturn.includes('..') ? requestedReturn : '/'

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="border-b border-border px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(returnTo)}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={returnTo === '/' ? '返回首页' : '返回冒险'}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-base font-semibold text-text-primary">设置</h1>
          <p className="text-xs text-text-muted">配置 AI 服务商、模型和本地偏好。</p>
        </div>
      </header>
      <Suspense fallback={<div className="p-6 text-sm text-text-muted">设置加载中…</div>}>
        <SettingsPage />
      </Suspense>
    </div>
  )
}
