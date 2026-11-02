import { useHistoricalStore } from '../../stores/historical'
import { useStoryTimelineStore } from '../../stores/story-timeline'
import { db } from '../db/schema'
import { readOwnedRows, resolveScopeLike, resolveWorldOwnerScopeLike, scopeTransactionTables } from '../workspace/scope'
import type { HistoricalTimelineEvent, StoryTimelineEvent } from '../types'
import { checkActiveProfile } from './store'
import type { ExtensionProfile, HistoryEntry } from './types'

export async function domainScope(profile: ExtensionProfile) {
  const project = await db.projects.get(profile.projectId)
  const work = await db.works.get(profile.workId ?? project?.activeWorkId ?? -1)
  if (!work || work.projectId !== profile.projectId || (profile.worldId && work.worldId !== profile.worldId)) throw new Error('插件对应的作品或世界已改变')
  return resolveScopeLike({ projectId: profile.projectId, worldId: work.worldId, workId: work.id! })
}
async function historyProfile(profile: ExtensionProfile): Promise<ExtensionProfile> {
  const current = await checkActiveProfile(profile)
  if (current.projectId !== profile.projectId || current.worldId !== profile.worldId || current.workId !== profile.workId || current.ownerKey !== profile.ownerKey) {
    throw new Error('插件对应的历史作用域已改变')
  }
  return current
}

export async function listHistory(profile: ExtensionProfile): Promise<HistoryEntry[]> {
  const current = await historyProfile(profile)
  if (current.worldId != null) {
    const scope = await resolveWorldOwnerScopeLike({ projectId: current.projectId, worldId: current.worldId })
    return (await readOwnedRows<HistoricalTimelineEvent>(scope, 'historicalTimelineEvents', { owner: 'world' })).map(row => ({ id: row.id!, title: row.title, description: row.description, time: row.date, revision: row.updatedAt }))
  }
  const scope = await domainScope(current)
  return (await readOwnedRows<StoryTimelineEvent>(scope, 'storyTimelineEvents', { owner: 'work' })).map(row => ({ id: row.id!, title: row.title, description: row.description ?? '', time: row.storyTime ?? '', revision: row.createdAt }))
}
/** Explicit author edits through a scoped domain action, never an AI adoption shortcut. */
export async function createHistory(profile: ExtensionProfile, input: Omit<HistoryEntry, 'id' | 'revision'>): Promise<void> {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.description !== 'string' || input.description.length > 20000 || typeof input.time !== 'string' || input.time.length > 200) throw new Error('历史条目的标题、时间或正文无效')
  await db.transaction('rw', scopeTransactionTables(db.extensionProfiles, db.historicalTimelineEvents, db.storyTimelineEvents), async () => {
    const current = await historyProfile(profile)
    if (current.worldId != null) {
      const scope = await resolveWorldOwnerScopeLike({ projectId: current.projectId, worldId: current.worldId })
      await useHistoricalStore.getState().addEvent( { projectId: profile.projectId, title: input.title.trim(), description: input.description, date: input.time, era: '自定义', year: Number(input.time) || 0, isHistorical: false, worldGroupId: null }, scope)
    } else {
      const scope = await domainScope(current)
      const rows = await readOwnedRows<StoryTimelineEvent>(scope, 'storyTimelineEvents', { owner: 'work' })
      await useStoryTimelineStore.getState().addEvent( { projectId: profile.projectId, title: input.title.trim(), description: input.description, storyTime: input.time, importance: 2, chapterId: null, order: Math.max(0, ...rows.map(row => row.order)) + 1 }, scope)
    }
  })
}
