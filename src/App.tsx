import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'

const ProductHubPage = lazy(() => import('./pages/ProductHubPage'))
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const TtrpgCommunityPage = lazy(() => import('./pages/TtrpgCommunityPage'))
const TtrpgSessionPage = lazy(() => import('./pages/TtrpgSessionPage'))
const SettingsRoutePage = lazy(() => import('./pages/SettingsRoutePage'))

function RouteFallback() {
  return <div className="min-h-screen bg-bg-base flex items-center justify-center text-sm text-text-muted">加载中…</div>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Suspense fallback={<RouteFallback />}><ProductHubPage /></Suspense>} />
      <Route path="/play" element={<Suspense fallback={<RouteFallback />}><TtrpgCommunityPage /></Suspense>} />
      <Route path="/play/session/:sessionId" element={<Suspense fallback={<RouteFallback />}><TtrpgSessionPage /></Suspense>} />
      <Route path="/play/:gameKey" element={<Suspense fallback={<RouteFallback />}><TtrpgCommunityPage /></Suspense>} />
      <Route path="/settings" element={<Suspense fallback={<RouteFallback />}><SettingsRoutePage /></Suspense>} />
      <Route path="/workspace/:projectId" element={<Suspense fallback={<RouteFallback />}><WorkspacePage /></Suspense>} />
    </Routes>
  )
}
