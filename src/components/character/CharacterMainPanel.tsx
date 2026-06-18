import CharacterPanel from './CharacterPanel'
import type { Project } from '../../lib/types'

export default function CharacterMainPanel({ project }: { project: Project }) {
  return <CharacterPanel project={project} view="main" />
}
