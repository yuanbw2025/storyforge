import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useSearchParams } from 'react-router'

import { retiredHomeDestination } from './components/navigation/retired-routes'
import ResumeTracker from './components/home/ResumeTracker'

const AiTownPage = lazy(() => import('./pages/AiTownPage'))
const TtrpgPage = lazy(() => import('./pages/TtrpgPage'))
const CharacterChatPage = lazy(() => import('./pages/CharacterChatPage'))
const AvgPage = lazy(() => import('./pages/AvgPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const WorldEnginePage = lazy(() => import('./pages/WorldEnginePage'))
const MotionMaterialsPage = lazy(() => import('./pages/MotionMaterialsPage'))
const MistHarborPage = lazy(() => import('./pages/MistHarborPage'))
const CommunityPage = lazy(() => import('./pages/CommunityPage'))
const TextGameDevelopmentPage = lazy(() => import('./pages/TextGameDevelopmentPage'))
const ComicPage = lazy(() => import('./pages/ComicPage'))
const ScreenplayPage = lazy(() => import('./pages/ScreenplayPage'))
const ShortformPage = lazy(() => import('./pages/ShortformPage'))
const LongformLibraryPage = lazy(() => import('./pages/LongformLibraryPage'))
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const TtrpgCommunityPage = lazy(() => import('./pages/TtrpgCommunityPage'))
const TtrpgSessionPage = lazy(() => import('./pages/TtrpgSessionPage'))
const SettingsRoutePage = lazy(() => import('./pages/SettingsRoutePage'))

function RouteFallback() {
  return <div className="min-h-screen bg-bg-base flex items-center justify-center text-sm text-text-muted">加载中…</div>
}

function HomeRoute() {
  const [params] = useSearchParams()
  const destination = retiredHomeDestination(params)
  return destination ? <Navigate replace to={destination}/> : <HomePage/>
}

export default function App() {
  return (
    <>
    <ResumeTracker/>
    <Routes>
      <Route path="/community/:pageId?" element={<Suspense fallback={<RouteFallback/>}><CommunityPage/></Suspense>}/>
      <Route path="/adventure/:pageId?" element={<Suspense fallback={<RouteFallback/>}><TextGameDevelopmentPage/></Suspense>}/>
      <Route path="/openworld/:pageId?" element={<Suspense fallback={<RouteFallback/>}><TextGameDevelopmentPage openWorld/></Suspense>}/>
      <Route path="/motion/:pageId?" element={<Suspense fallback={<RouteFallback />}><MotionMaterialsPage/></Suspense>}/>
      <Route path="/town/:pageId?" element={<Suspense fallback={<RouteFallback />}><AiTownPage /></Suspense>}/>
      <Route path="/ttrpg/:pageId?" element={<Suspense fallback={<RouteFallback />}><TtrpgPage /></Suspense>}/>
      <Route path="/chat/:pageId?" element={<Suspense fallback={<RouteFallback />}><CharacterChatPage /></Suspense>}/>
      <Route path="/avg/:pageId?" element={<Suspense fallback={<RouteFallback />}><AvgPage /></Suspense>}/>
      <Route path="/home/:pageId?" element={<Suspense fallback={<RouteFallback />}><HomePage /></Suspense>}/>
      <Route path="/world/:pageId?" element={<Suspense fallback={<RouteFallback />}><WorldEnginePage /></Suspense>}/>
      <Route path="/comic/:pageId?" element={<Suspense fallback={<RouteFallback />}><ComicPage /></Suspense>}/>
      <Route path="/script/:pageId?" element={<Suspense fallback={<RouteFallback />}><ScreenplayPage /></Suspense>}/>
      <Route path="/" element={<Suspense fallback={<RouteFallback />}><HomeRoute /></Suspense>} />
      <Route path="/play" element={<Suspense fallback={<RouteFallback />}><TtrpgCommunityPage /></Suspense>} />
      <Route path="/play/session/:sessionId" element={<Suspense fallback={<RouteFallback />}><TtrpgSessionPage /></Suspense>} />
      <Route path="/play/mist-harbor" element={<Suspense fallback={<RouteFallback />}><MistHarborPage /></Suspense>} />
      <Route path="/play/:gameKey" element={<Suspense fallback={<RouteFallback />}><TtrpgCommunityPage /></Suspense>} />
      <Route path="/settings" element={<Suspense fallback={<RouteFallback />}><SettingsRoutePage /></Suspense>} />
      <Route path="/short/:pageId?" element={<Suspense fallback={<RouteFallback />}><ShortformPage /></Suspense>} />
      <Route path="/long" element={<Suspense fallback={<RouteFallback />}><LongformLibraryPage /></Suspense>} />
      <Route path="/workspace/:projectId" element={<Suspense fallback={<RouteFallback />}><WorkspacePage /></Suspense>} />
    </Routes>
    </>
  )
}
