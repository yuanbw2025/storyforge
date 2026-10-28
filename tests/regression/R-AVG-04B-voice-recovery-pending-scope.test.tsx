import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceRecoveryPanel from '../../src/components/avg/VoiceRecoveryPanel'
import { db } from '../../src/lib/db/schema'
import * as service from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { parseAvgVoiceRecoveryV1 } from '../../src/lib/avg/voice-recovery-contract'
import { avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'
import { avgVoiceAssemblyGateIdsV3 } from '../../src/lib/avg/voice-assembly-contract'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'

// Strict real packet codecs, isolated native Work preparation and a controlled
// view projection. The metadata-only proof is never an admitted producer,
// playable clip, adoption or permission to resume a historical Run.
let host: HTMLDivElement, root: Root | undefined
const fetcher = vi.fn(() => { throw new Error('Readonly pending recovery must not dispatch') })
beforeEach(async () => {
  await db.delete(); await db.open(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetcher); fetcher.mockClear()
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined; host?.remove(); db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function renderCase(pendingRetained: boolean, executionRetained: boolean) {
  const workspace = avgAuthorWorkspaceFixture(), owner = await prepareNativeAvgAssembly(workspace)
  const base = parseProductProductionBriefV3(owner.details.brief!.briefJson), policy = await avgVoicePolicyFixtureV3()
  policy.avgAssembly.sceneKeys = [...base.avgAssembly!.sceneKeys]
  const original = structuredClone(policy.avgAssembly), retained = structuredClone(original)
  const requirementKey = retained.voice.batch.requirements[0].requirementKey
  retained.voice.recovery = parseAvgVoiceRecoveryV1({ schema: 'storyforge.avg.voice-recovery', version: 1,
    sourceBuildNumber: 1, sourceBuildRevision: 9, sourceBriefHash: 'a'.repeat(64), sourcePlanHash: 'b'.repeat(64),
    sourceControlEpoch: 1, sourceVoiceHash: await hashProductProductionValueV2(original.voice),
    retained: [{ requirementKey, proof: { schema: 'storyforge.avg.historical-raw-voice-proof', version: 1,
      buildNumber: 1, briefHash: 'a'.repeat(64), planHash: 'b'.repeat(64), controlEpoch: 1,
      taskKey: `avg.voice.generate.${requirementKey}`, artifactKey: `avg.voice.raw.${requirementKey}`, artifactVersion: 1,
      contentHash: 'c'.repeat(64), inputHash: 'd'.repeat(64), producerReceiptHash: 'e'.repeat(64),
      candidateHash: 'f'.repeat(64), proofHash: '1'.repeat(64) } }], rerunRequirementKeys: [],
    declaration: '工程面板投影，不提供真实原音频或当前采用授权。' }, retained.voice.batch)
  const packet = async (keep: boolean) => {
    const assembly = keep ? retained : original
    return parseProductProductionBriefV3({ ...base, ...policy, intent: { ...base.intent, ...policy.intent },
      avgAssembly: await encodeAvgStoredAssemblyBriefV3(assembly), productionBudget: avgVoiceProductionBudgetV3(assembly),
      completionContract: { ...policy.completionContract, requiredGateIds: avgVoiceAssemblyGateIdsV3(assembly) },
      ...(keep ? { evolution: { schema: 'storyforge.product-evolution-impact', version: 1,
        base: { kind: 'recovery-build', buildNumber: 1, briefHash: 'a'.repeat(64), planHash: 'b'.repeat(64), controlEpoch: 1 },
        userGoal: 'Readonly pending voice recovery projection', affectedLanes: ['audio'] } } : {}) })
  }
  const pending = await packet(pendingRetained), execution = await packet(executionRetained)
  const view = { draft: { revision: 3, editorJson: JSON.stringify(workspace) }, artifacts: [], details: {
    ...owner.details, production: { ...owner.details.production, status: 'brief-ready' },
    brief: { ...owner.details.brief, revision: 2, briefJson: JSON.stringify(pending) },
    build: { id: 7, buildNumber: 1, stateRevision: 9, briefRevision: 1, status: 'cancelled', previewHash: '' },
    executionBrief: execution } } as unknown as ComponentProps<typeof VoiceRecoveryPanel>['view']
  const read = vi.spyOn(service, 'readAvgVoiceRecoveryOptionsV1').mockRejectedValue(new Error('工程控制：原件来源尚未复验'))
  const prepare = vi.spyOn(service, 'prepareAvgVoiceRecoveryBriefV1').mockRejectedValue(new Error('No preparation authorized by this view'))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<VoiceRecoveryPanel scope={owner.scope} view={view} disabled={false} visible
    onPending={vi.fn()} onAction={async action => { await action() }} onReload={async () => {}} onNotice={vi.fn()} />))
  return { read, prepare, scope: owner.scope, productionId: owner.productionId }
}
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)
describe('AVG pending voice recovery grammar stays separate from the stopped Build', () => {
  it('shows the saved retained plan from the pending Brief even when the stopped execution has no recovery', async () => {
    const s = await renderCase(true, false)
    expect(host.textContent).toContain('保留 1 句原音频；重录 0 句')
    expect(button('重新核对保留与重录')).toBeDefined()
    expect(s.read).not.toHaveBeenCalled(); expect(s.prepare).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  }, 10_000)
  it('does not project historical retention onto a pending Brief that has no retained plan', async () => {
    const s = await renderCase(false, true)
    expect(button('重新核对保留与重录')).toBeUndefined()
    expect(host.textContent).not.toContain('图音恢复方案已保存')
    expect(s.read).not.toHaveBeenCalled(); expect(s.prepare).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  }, 10_000)
  it('reopens only source verification and keeps failed source reads from preparing or dispatching', async () => {
    const s = await renderCase(true, false), reopen = button('重新核对保留与重录')
    expect(reopen).toBeDefined()
    await act(async () => reopen!.click())
    expect(s.read).toHaveBeenCalledOnce(); expect(s.read).toHaveBeenCalledWith(s.scope, s.productionId)
    expect(host.textContent).toContain('原件来源尚未复验')
    expect(s.prepare).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  }, 10_000)
})
