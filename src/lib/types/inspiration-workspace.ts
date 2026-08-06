export type InspirationSourceKind = 'author' | 'reference' | 'research' | 'other'
export type InspirationResultMode = 'single' | 'multiworld'

export interface InspirationFragment {
  id: string
  text: string
  label: string
  sourceKind: InspirationSourceKind
  createdAt: number
}

export interface InspirationVersion {
  id: string
  parentVersionId: string | null
  mode: InspirationResultMode
  fragmentIds: string[]
  resultJson: string
  createdAt: number
}

/** CM-1：每项目一份增量灵感工作区，碎片和版本用有界 JSON 保存。 */
export interface InspirationWorkspace {
  id?: number
  projectId: number
  workId?: number | null
  fragments: string
  versions: string
  createdAt: number
  updatedAt: number
}
