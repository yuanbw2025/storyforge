import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 as fixture } from '../helpers/open-local-voice'
import { finishTtrpgOpenVoiceIntentForKernelV1 } from '../../src/lib/ttrpg/open-voice-intent-receipt'
import * as core from '../../src/lib/product/runtime-core'
import * as source from '../../src/lib/product-production/preview-source'

describe('R-TTRPGOPEN10 original voice intent reuses exact pure replay', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('avoids another event replay while still verifying the source and refuses changed original event bytes behind an unchanged head', async () => {
    const s = await fixture()
    const replay = vi.spyOn(core, 'replayProductRuntimeEvents')
    const verify = vi.spyOn(source, 'verifyProductRuntimeSessionSourceV1')
    const before = await core.readProductRuntimeState(s.owner.sessionId)
    const first = await finishTtrpgOpenVoiceIntentForKernelV1(s.input, true)
    const second = await finishTtrpgOpenVoiceIntentForKernelV1(s.input, true)
    expect(second.receipt).toEqual(first.receipt)
    expect(replay).toHaveBeenCalledTimes(0)
    expect(verify).toHaveBeenCalledTimes(2)
    const event = (await db.productRuntimeEvents.where('sessionId').equals(s.owner.sessionId).sortBy('sequence'))[0]
    await db.productRuntimeEvents.update(event.id!, { payloadJson: '{}' })
    await expect(finishTtrpgOpenVoiceIntentForKernelV1(s.input, true)).rejects.toThrow()
    expect(replay).toHaveBeenCalledTimes(1)
    const session = (await db.productRuntimeSessions.get(s.owner.sessionId))!
    expect(JSON.parse(session.runtimeHeadStateJson!)).toEqual(before)
    expect(await db.productMediaAssets.count()).toBe(0)
    expect((await db.agentRunEvents.toArray()).some(e => e.type === 'model.requested')).toBe(false)
  })
})
