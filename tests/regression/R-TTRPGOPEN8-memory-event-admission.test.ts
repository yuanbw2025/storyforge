import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { appendProductRuntimeEvent, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { PRODUCT_RUNTIME_EVENT_TYPES } from '../../src/lib/types'

describe('R-TTRPGOPEN8 closed memory event admission', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('registering E15 grants no generic append authority and leaves both state and memory storage unchanged', async () => {
    const f = await readyOpenTtrpgSessionV1('closed memory event'), before = await readProductRuntimeState(f.sessionId)
    expect(PRODUCT_RUNTIME_EVENT_TYPES).toContain('ttrpg.memory.recorded')
    await expect(appendProductRuntimeEvent({ sessionId: f.sessionId, type: 'ttrpg.memory.recorded', payload: { summary: '绕过确认' } })).rejects.toThrow()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
  })
})
