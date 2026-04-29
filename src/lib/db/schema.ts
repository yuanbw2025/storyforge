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
  Geography,
  History,
  ItemSystem,
  CreativeRules,
  CharacterRelation,
  Snapshot,
  Reference,
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
  geographies!: Table<Geography>
  histories!: Table<History>
  itemSystems!: Table<ItemSystem>
  creativeRules!: Table<CreativeRules>
  characterRelations!: Table<CharacterRelation>
  snapshots!: Table<Snapshot>
  references!: Table<Reference>

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

    this.version(2).stores({
      geographies: '++id, projectId',
      histories: '++id, projectId',
      itemSystems: '++id, projectId',
      creativeRules: '++id, projectId',
    })

    this.version(3).stores({
      characterRelations: '++id, projectId, fromCharacterId, toCharacterId',
    })

    this.version(4).stores({
      snapshots: '++id, projectId, type, createdAt',
    })

    // v5: 新增参考书目表，projects 表支持 genres[] / status / coverImage
    this.version(5).stores({
      references: '++id, projectId, type, createdAt',
    })
  }
}

export const db = new StoryForgeDB()
