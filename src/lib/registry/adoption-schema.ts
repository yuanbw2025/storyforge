/**
 * ADOPTION_SCHEMAS(Phase 1.2a) · 集合写回策略登记。
 *
 * 单例表走 FIELD_REGISTRY 定位记录;集合表必须在这里登记 identity / 去重 /
 * 自动盖章 / FK 校验策略。
 */
import type { CollectionAdoptionSpec } from './types'

export const ADOPTION_SCHEMAS: CollectionAdoptionSpec[] = [
  {
    target: 'characters',
    identity: { kind: 'composite', fields: ['homeWorldGroupId', 'name'] },
    duplicatePolicy: 'merge',
    required: ['name', 'roleWeight', 'moralAxis', 'orderAxis'],
    autoStamps: ['projectId', 'homeWorldGroupId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'foreshadows',
    identity: 'name',
    duplicatePolicy: 'merge',
    required: ['name', 'type', 'status', 'description'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'plantChapterId', target: 'chapters' },
      { field: 'resolveChapterId', target: 'chapters' },
      { field: 'expectedResolveChapterId', target: 'chapters' },
    ],
  },
  {
    target: 'outlineNodes',
    identity: { kind: 'composite', fields: ['parentId', 'type', 'title'] },
    duplicatePolicy: 'skip',
    required: ['type', 'title'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'parentId', target: 'outlineNodes' }],
  },
  {
    target: 'chapters',
    identity: { kind: 'composite', fields: ['outlineNodeId', 'title'] },
    duplicatePolicy: 'update',
    required: ['outlineNodeId', 'title'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'outlineNodeId', target: 'outlineNodes' }],
  },
  {
    target: 'detailedOutlines',
    identity: { kind: 'composite', fields: ['outlineNodeId'] },
    duplicatePolicy: 'update',
    required: ['outlineNodeId'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'outlineNodeId', target: 'outlineNodes' }],
    arrayMemberChecks: [
      { field: 'appearingCharacterIds', itemTarget: 'characters' },
      { field: 'foreshadowIds', itemTarget: 'foreshadows' },
    ],
  },
  {
    target: 'storyArcs',
    identity: 'name',
    duplicatePolicy: 'merge',
    required: ['name', 'type'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'codexCategories',
    identity: { kind: 'composite', fields: ['domain', 'parentId', 'name'] },
    duplicatePolicy: 'skip',
    required: ['domain', 'name'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'parentId', target: 'codexCategories' }],
  },
  {
    target: 'codexEntries',
    identity: { kind: 'composite', fields: ['categoryId', 'name'] },
    duplicatePolicy: 'merge',
    required: ['categoryId', 'name'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'categoryId', target: 'codexCategories' }],
  },
  {
    target: 'importantLocations',
    identity: 'name',
    duplicatePolicy: 'merge',
    required: ['name'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'parentId', target: 'importantLocations' }],
  },
  {
    target: 'itemLedger',
    identity: { kind: 'composite', fields: ['chapterId', 'itemName', 'action', 'note'] },
    duplicatePolicy: 'skip',
    required: ['itemName', 'action', 'quantity'],
    autoStamps: ['projectId', 'createdAt'],
    fkChecks: [{ field: 'chapterId', target: 'chapters' }],
  },
  {
    target: 'storyTimelineEvents',
    identity: { kind: 'composite', fields: ['chapterId', 'title'] },
    duplicatePolicy: 'update',
    required: ['title', 'importance'],
    autoStamps: ['projectId', 'createdAt'],
    fkChecks: [{ field: 'chapterId', target: 'chapters' }],
  },
  {
    target: 'stateCards',
    identity: { kind: 'composite', fields: ['category', 'entityName'] },
    duplicatePolicy: 'merge',
    required: ['category', 'entityName', 'fields'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'lastChapterId', target: 'chapters' }],
  },
]

export const ADOPTION_BY_TARGET: ReadonlyMap<string, CollectionAdoptionSpec> = new Map(
  ADOPTION_SCHEMAS.map(s => [s.target, s] as const),
)
