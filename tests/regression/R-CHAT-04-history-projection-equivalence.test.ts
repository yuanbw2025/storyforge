import {createHash} from 'node:crypto'
import {expect, it} from 'vitest'
import {indexChatHistoryRowsV1} from '../../src/lib/character-interaction/history-projection-rows'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {chatHistorySelectionFixture} from '../helpers/chat-history-selection'
import baseline from '../acceptance/character-chat-v140-projection-baseline.json'

it('preserves source order and duplicate identities without adding unknown or other-kind rows', () => {
  const rows = [{key: 'second', text: 'one'}, {key: 'first', text: 'two'}, {key: 'second', text: 'three'}]
  const select = indexChatHistoryRowsV1(rows, 'facts', row => row.key)
  expect(select(new Set(['facts:first', 'facts:unknown', 'goals:second', 'facts:second']))).toEqual(rows)
  expect(select(new Set(['facts:second']))).toEqual([rows[0], rows[2]])
  expect(select(new Set(['goals:second']))).toEqual([])
  // Sorting is confined to the temporary selection, never the source array.
  expect(rows.map(row => row.text)).toEqual(['one', 'two', 'three'])
})

for (const row of baseline) it(`preserves the frozen V139 projection bytes: ${row.version}/${row.actor}/${row.maxCharacters}`, () => {
  const state = chatHistorySelectionFixture()
  const retrievalVersion = row.version as 'chat-relevance-v8' | 'chat-relevance-v9' | 'chat-relevance-v10'
  let output: string
  try {
    output = JSON.stringify({
      actor: buildInteractionContextWindow(state, row.actor, {retrievalVersion, maxCharacters: row.maxCharacters}),
      review: selectChatCoordinatorContextV1(state, {retrievalVersion, actorKey: row.actor,
        text: JSON.stringify({evidenceFactKeys: ['observed-40'], goalKey: 'closed-1'})}),
    })
  } catch (error) {output = `ERROR:${(error as Error).message}`}
  expect(output.length).toBe(row.bytes)
  expect(createHash('sha256').update(output).digest('hex')).toBe(row.sha256)
})
