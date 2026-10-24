import {chatHistoryIdV1, type ChatHistoryKindV1} from './history-selection'

/** Index an already authorized collection for repeated budget trials. Preserve
 * original order and all rows sharing an identity; this never selects sources
 * or changes their dependency closure. The index lives for one projection. */
export function indexChatHistoryRowsV1<T>(rows: readonly T[], kind: ChatHistoryKindV1, key: (row: T) => string) {
  const index = new Map<string, {row: T; order: number}[]>()
  rows.forEach((row, order) => {
    const id = chatHistoryIdV1(kind, key(row)), existing = index.get(id)
    if (existing) existing.push({row, order})
    else index.set(id, [{row, order}])
  })
  return (selected: ReadonlySet<string>): T[] => {
    const included: {row: T; order: number}[] = []
    for (const id of selected) for (const row of index.get(id) ?? []) included.push(row)
    return included.sort((a, b) => a.order - b.order).map(item => item.row)
  }
}
