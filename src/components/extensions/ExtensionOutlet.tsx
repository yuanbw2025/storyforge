import { lazy, Suspense, type ComponentProps } from 'react'
import type ExtensionSurfaceType from './ExtensionSurface'
const Surface = lazy(() => import('./ExtensionSurface'))
/** Keep the ordinary authoring path free of package loading and plugin DB queries. */
export default function ExtensionOutlet(props: ComponentProps<typeof ExtensionSurfaceType>) {
  if (localStorage.getItem('storyforge.plugins.preview') !== '1') return props.children
  return <Suspense fallback={props.children}><Surface {...props}/></Suspense>
}
