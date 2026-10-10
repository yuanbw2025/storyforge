import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router'
const Entry = lazy(() => import('./ProductExtensionDock'))
const products = new Set(['world','short','script','comic','motion','town','ttrpg','chat','avg','adventure','openworld'])
/** Shared authoring entry only. No DB access or runtime import when plugins are off. */
export default function ProductExtensionEntry() {
  const location = useLocation(), [,product,page] = location.pathname.split('/')
  if (localStorage.getItem('storyforge.plugins.preview') !== '1' || !products.has(product) || /^(play|player|runtime|session|test|preview)$/.test(page ?? '') || new URLSearchParams(location.search).has('session')) return null
  return <Suspense fallback={null}><Entry key={`${location.pathname}${location.search}`} product={product}/></Suspense>
}
