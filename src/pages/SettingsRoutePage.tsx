import { Navigate, useLocation, useSearchParams } from 'react-router'
import { safeSettingsReturn } from '../components/navigation/retired-routes'
import { parseTextOpenWorldSettingsReturnV1 } from '../lib/open-world/creator-settings-navigation'
export default function SettingsRoutePage() {
  const location = useLocation()
  const [params] = useSearchParams()
  const next = new URLSearchParams()
  const target = safeSettingsReturn(params.get('returnTo'))
  if (target) next.set('returnTo', target)
  if (params.has('project')) next.set('project', params.get('project')!)
  const creatorReturn = parseTextOpenWorldSettingsReturnV1(location.state)
  return <Navigate
    replace
    to={`/home/settings${next.size ? `?${next}` : ''}`}
    state={creatorReturn ? { storyforgeProductHubReturn: creatorReturn } : null}
  />
}
