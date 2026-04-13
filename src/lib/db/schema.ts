import Dexie, { type Table } from 'dexie'
import type {
  Project,
  Worldview,
  StoryCore,
  PowerSystem,
  Character,
  Faction,
  OutlineNode,
  Chapter,
  Foreshadow,
} from '../types'

class StoryForgeDB extends Dexie {
  projects!: Table<Project>
  worldviews!: Table<Worldview>
  storyCores!: Table<StoryCore>
  powerSystems!: Table<PowerSystem>
  characters!: Table<Character>
  factions!: Table<Faction>
  outlineNodes!: Table<OutlineNode>
  chapters!: Table<Chapter>
  foreshadows!: Table<Foreshadow>

  constructor() {
    super('storyforge')

    this.version(1).stores({
      projects: '++id, name, createdAt, updatedAt',
      worldviews: '++id, projectId',
      storyCores: '++id, projectId',
      powerSystems: '++id, projectId',
      characters: '++id, projectId, name, role',
      factions: '++id, projectId, name',
      outlineNodes: '++id, projectId, parentId, order, type',
      chapters: '++id, projectId, outlineNodeId, order, status',
      foreshadows: '++id, projectId, status, type',
    })
  }
}

export const db = new StoryForgeDB()
