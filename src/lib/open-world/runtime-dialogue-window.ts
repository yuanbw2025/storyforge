export const TEXT_OPEN_WORLD_RUNTIME_DIALOGUE_WINDOW_V1 = {
  playerChars: 1_000,
  npcChars: 4_000,
  totalChars: 6_000,
  records: 12,
} as const

type DialogueSpeaker = 'player' | 'npc'

export function textOpenWorldRuntimeDialogueRecordLimitV1(speaker: DialogueSpeaker): number {
  const { playerChars, npcChars } = TEXT_OPEN_WORLD_RUNTIME_DIALOGUE_WINDOW_V1
  return speaker === 'player' ? playerChars : npcChars
}

/** Take the newest contiguous, complete exchanges without rewriting evidence. */
export function selectTextOpenWorldRuntimeDialogueWindowV1<T extends { speaker: DialogueSpeaker; text: string }>(
  turns: readonly T[],
): T[] {
  const { records, totalChars } = TEXT_OPEN_WORLD_RUNTIME_DIALOGUE_WINDOW_V1
  let start = turns.length
  let total = 0
  while (start >= 2 && turns.length - start + 2 <= records) {
    const player = turns[start - 2]!
    const npc = turns[start - 1]!
    if (player.speaker !== 'player' || npc.speaker !== 'npc') break
    const playerLength = player.text.normalize('NFC').trim().length
    const npcLength = npc.text.normalize('NFC').trim().length
    if (!playerLength || playerLength > textOpenWorldRuntimeDialogueRecordLimitV1('player')
      || !npcLength || npcLength > textOpenWorldRuntimeDialogueRecordLimitV1('npc')
      || total + playerLength + npcLength > totalChars) break
    total += playerLength + npcLength
    start -= 2
  }
  return turns.slice(start)
}
