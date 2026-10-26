import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ProductFrame from '../navigation/ProductFrame'
import type { Project } from '../../lib/types'

export default function AdventureProductFrame(props: {
  projects: Project[]
  projectId?: number
  libraryPath: string
  productionPath: string
  producing: boolean
  page: string
  navigation: readonly { label: string; path: string; active?: boolean }[]
  onChooseProject(id: string): void
  children: ReactNode
}) {
  return <ProductFrame product="adventure" title="文字冒险" page={props.page}
    productPath={props.libraryPath} navigationLabel="文字冒险制作导航"
    className="adventure-product-page" navigation={props.navigation}>
    <div className="adventure-workspace-toolbar">
      <nav aria-label="文字冒险导航">
        <Link to={props.libraryPath} aria-current={!props.producing ? 'page' : undefined}>作品与试玩</Link>
        <Link to={props.productionPath} aria-current={props.producing ? 'page' : undefined}>创作工作台</Link>
      </nav>
      <label className="adventure-workspace-select">工作区
        <select aria-label="创作工作区" value={props.projectId ?? ''} onChange={event => props.onChooseProject(event.target.value)}>
          <option value="">选择工作区</option>
          {props.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
    </div>
    {props.children}
  </ProductFrame>
}
