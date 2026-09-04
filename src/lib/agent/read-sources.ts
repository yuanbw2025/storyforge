import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import type { OutlineNode } from '../types'
import { countWords, htmlToPlainText } from '../utils/html'
import { readOwnedRows } from '../workspace/scope'

export const AGENT_SEARCH_KINDS = [
  'chapter',
  'character',
  'outline',
  'codex',
  'location',
] as const

export type AgentSearchKind = typeof AGENT_SEARCH_KINDS[number]

const MAX_OUTLINE_NODES = 240
const MAX_SEARCH_HITS = 10
const MAX_SEARCH_QUERY_CHARS = 100
const MAX_SEARCH_EXCERPT_CHARS = 180

function normalizeWorldGroupId(value: number | null | undefined): number | null {
  return value ?? null
}

function effectiveOutlineWorld(
  node: OutlineNode,
  byId: ReadonlyMap<number, OutlineNode>,
): number | null {
  let current: OutlineNode | undefined = node
  const visited = new Set<number>()
  while (current) {
    if (current.worldGroupId != null) return current.worldGroupId
    if (current.parentId == null || visited.has(current.parentId)) return null
    visited.add(current.parentId)
    current = byId.get(current.parentId)
  }
  return null
}

function excerptAround(text: string, query: string): string {
  const plain = htmlToPlainText(text).replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  const lower = plain.toLocaleLowerCase()
  const at = lower.indexOf(query.toLocaleLowerCase())
  if (at < 0) return plain.slice(0, MAX_SEARCH_EXCERPT_CHARS)
  const half = Math.floor(MAX_SEARCH_EXCERPT_CHARS / 2)
  const start = Math.max(0, at - half)
  const end = Math.min(plain.length, start + MAX_SEARCH_EXCERPT_CHARS)
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}

function matches(text: string, query: string): boolean {
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

export async function readAgentWorkStatus(input: AssembleContextInput): Promise<string> {
  const project = await db.projects.get(input.projectId)
  if (!project || !input.scope) return ''
  const work = await db.works.get(input.scope.workId)
  if (!work || work.projectId !== input.projectId || work.worldId !== input.scope.worldId) return ''

  const [
    worldGroups,
    worldviews,
    storyCores,
    characters,
    outlineNodes,
    chapters,
    foreshadows,
    references,
  ] = await Promise.all([
    readOwnedRows<any>(input.scope, 'worldGroups', { owner: 'world' }).then(rows => rows.length),
    readOwnedRows<any>(input.scope, 'worldviews', { owner: 'world' }).then(rows => rows.length),
    readOwnedRows<any>(input.scope, 'storyCores', { owner: 'work' }).then(rows => rows.length),
    readOwnedRows<any>(input.scope, 'characters', { owner: 'world' }).then(rows => rows.length),
    readOwnedRows<any>(input.scope, 'outlineNodes', { owner: 'work' }).then(rows => rows.length),
    readOwnedRows<any>(input.scope, 'chapters', { owner: 'work' }),
    readOwnedRows<any>(input.scope, 'foreshadows', { owner: 'work' }).then(rows => rows.length),
    readOwnedRows<any>(input.scope, 'references', { owner: 'work' }).then(rows => rows.length),
  ])
  const writtenChapters = chapters.filter(chapter => htmlToPlainText(chapter.content || '').trim())
  const totalWords = chapters.reduce((sum, chapter) => (
    sum + (chapter.wordCount || countWords(htmlToPlainText(chapter.content || '')))
  ), 0)

  return [
    '【作品概况】',
    `作品：${work.title}`,
    `状态：${work.status}；模式：${project.enableMultiWorld ? '多世界' : '单世界'}`,
    `字数：${totalWords}/${work.targetWordCount}`,
    `章节：${chapters.length}（已有正文 ${writtenChapters.length}）`,
    `世界组：${worldGroups}；世界观：${worldviews}；故事核心：${storyCores}`,
    `角色：${characters}；大纲节点：${outlineNodes}；伏笔：${foreshadows}；参考资料：${references}`,
  ].join('\n')
}

export async function readAgentWorldGroups(input: AssembleContextInput): Promise<string> {
  if (!input.scope) return ''
  const [groups, links] = await Promise.all([
    readOwnedRows<any>(input.scope, 'worldGroups', { owner: 'world' }).then(rows => rows.sort((a, b) => a.order - b.order)),
    readOwnedRows<any>(input.scope, 'worldGroupLinks', { owner: 'world' }),
  ])
  if (!groups.length) return '【世界组】\n单世界项目：默认主世界（worldGroupId=null）'
  const names = new Map(groups.flatMap(group => group.id == null ? [] : [[group.id, group.name] as const]))
  const lines = groups.map(group => (
    `- #${group.id ?? '?'} ${group.name}｜${group.type}${group.description ? `：${group.description.slice(0, 180)}` : ''}`
  ))
  if (links.length) {
    lines.push(
      '【世界连接】',
      ...links.slice(0, 80).map(link => (
        `- ${names.get(link.fromGroupId) ?? `#${link.fromGroupId}`} → ${names.get(link.toGroupId) ?? `#${link.toGroupId}`}｜${link.linkType}${link.name ? `：${link.name}` : ''}`
      )),
    )
  }
  return ['【世界组】', ...lines].join('\n')
}

export async function readAgentOutlineTree(input: AssembleContextInput): Promise<string> {
  if (!input.scope) return ''
  const rows = await readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' })
  if (!rows.length) return ''
  const byId = new Map(rows.flatMap(node => node.id == null ? [] : [[node.id, node] as const]))
  const targetWorld = normalizeWorldGroupId(input.worldGroupId)
  const visibleIds = new Set<number>()
  for (const node of rows) {
    if (node.id == null || effectiveOutlineWorld(node, byId) !== targetWorld) continue
    let current: OutlineNode | undefined = node
    const visited = new Set<number>()
    while (current?.id != null && !visited.has(current.id)) {
      if (effectiveOutlineWorld(current, byId) !== targetWorld) break
      visibleIds.add(current.id)
      visited.add(current.id)
      current = current.parentId == null ? undefined : byId.get(current.parentId)
    }
  }
  const visible = rows
    .filter(node => node.id != null && visibleIds.has(node.id))
    .sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0))
  const children = new Map<number | null, OutlineNode[]>()
  for (const node of visible) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  const lines: string[] = ['【大纲树】']
  const seen = new Set<number>()
  const walk = (parentId: number | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (node.id == null || seen.has(node.id) || lines.length > MAX_OUTLINE_NODES) continue
      seen.add(node.id)
      const summary = node.summary.trim()
      lines.push(`${'  '.repeat(Math.min(depth, 8))}- #${node.id} [${node.type}] ${node.title}${summary ? `：${summary.slice(0, 220)}` : ''}`)
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  if (visible.length > seen.size) {
    for (const node of visible) {
      if (node.id == null || seen.has(node.id) || lines.length > MAX_OUTLINE_NODES) continue
      lines.push(`- #${node.id} [${node.type}] ${node.title}（父节点缺失或成环）`)
    }
  }
  if (lines.length > MAX_OUTLINE_NODES) lines.push('…（大纲树已按节点上限截断）')
  return lines.join('\n')
}

export async function readAgentSearchResults(input: AssembleContextInput): Promise<string> {
  const query = input.searchQuery?.trim().slice(0, MAX_SEARCH_QUERY_CHARS) ?? ''
  if (query.length < 2) return ''
  const requestedKinds = input.searchKinds?.filter((kind): kind is AgentSearchKind => (
    AGENT_SEARCH_KINDS.includes(kind as AgentSearchKind)
  ))
  const kinds = new Set<AgentSearchKind>(requestedKinds?.length ? requestedKinds : AGENT_SEARCH_KINDS)
  const limit = Math.max(1, Math.min(MAX_SEARCH_HITS, Math.floor(input.searchLimit ?? 5)))
  const [chapters, characters, outlineNodes, codexEntries, locations] = await Promise.all([
    kinds.has('chapter') && input.scope ? readOwnedRows<any>(input.scope, 'chapters', { owner: 'work' }) : [],
    kinds.has('character') && input.scope ? readOwnedRows<any>(input.scope, 'characters', { owner: 'world' }) : [],
    kinds.has('outline') && input.scope ? readOwnedRows<any>(input.scope, 'outlineNodes', { owner: 'work' }) : [],
    kinds.has('codex') && input.scope ? readOwnedRows<any>(input.scope, 'codexEntries', { owner: 'world' }) : [],
    kinds.has('location') && input.scope ? readOwnedRows<any>(input.scope, 'importantLocations', { owner: 'world' }) : [],
  ])
  const nodeById = new Map(outlineNodes.flatMap(node => node.id == null ? [] : [[node.id, node] as const]))
  if (!outlineNodes.length && chapters.length && input.scope) {
    const projectNodes = await readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' })
    for (const node of projectNodes) if (node.id != null) nodeById.set(node.id, node)
  }
  const targetWorld = normalizeWorldGroupId(input.worldGroupId)
  const hits: Array<{ kind: AgentSearchKind; id: number; title: string; excerpt: string }> = []
  const add = (kind: AgentSearchKind, id: number | undefined, title: string, body: string) => {
    if (id == null || hits.length >= limit || !matches(`${title}\n${body}`, query)) return
    hits.push({ kind, id, title, excerpt: excerptAround(body || title, query) })
  }

  for (const chapter of chapters) {
    const node = nodeById.get(chapter.outlineNodeId)
    if (!node || effectiveOutlineWorld(node, nodeById) !== targetWorld) continue
    add('chapter', chapter.id, chapter.title, chapter.content)
  }
  for (const character of characters) {
    if (!character.isCrossWorld && normalizeWorldGroupId(character.homeWorldGroupId) !== targetWorld) continue
    add('character', character.id, character.name, [
      character.shortDescription,
      character.identity,
      character.personality,
      character.background,
      character.motivation,
      character.arc,
    ].filter(Boolean).join('\n'))
  }
  for (const node of outlineNodes) {
    if (effectiveOutlineWorld(node, nodeById) !== targetWorld) continue
    add('outline', node.id, node.title, node.summary)
  }
  for (const entry of codexEntries) {
    if (entry.worldGroupId != null && entry.worldGroupId !== targetWorld) continue
    add('codex', entry.id, entry.name, `${entry.summary}\n${entry.description}`)
  }
  for (const location of locations) {
    add('location', location.id, location.name, `${location.description}\n${location.significance}`)
  }

  if (!hits.length) return `【项目内搜索】\n未找到“${query}”`
  return [
    `【项目内搜索】“${query}”（最多 ${limit} 条）`,
    ...hits.map(hit => `- [${hit.kind}#${hit.id}] ${hit.title}${hit.excerpt ? `：${hit.excerpt}` : ''}`),
  ].join('\n')
}
