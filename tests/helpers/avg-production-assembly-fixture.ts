import { db } from '../../src/lib/db/schema'
import { createAvgDraftV1, selectAvgWorldV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1, stageAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { avgAuthorWorkspaceFixture } from './avg-author-stage-fixture'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import type { AvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'

/** Uses actual S2/start/Plan/author commands; never seeds Build/Preview/Run rows. */
export async function prepareNativeAvgAssembly(workspace: AvgAuthorWorkspaceV1 = avgAuthorWorkspaceFixture()) {
  const owner = await createAvgDraftV1('作者系统与表现组装')
  const world = await createMistHarborWorld()
  const selected = await selectAvgWorldV1(owner.scope,0,world.worldReleaseId)
  const saved = await saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,workspace)
  const details = await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:saved.revision})
  return { ...owner,productionId:details.production.id!,details }
}
export async function startNativeAvgAssembly(s: Awaited<ReturnType<typeof prepareNativeAvgAssembly>>) {
  const details = await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:s.details.brief!.briefHash})
  return { ...s,details,buildId:details.build!.id! }
}
export async function confirmNativeAvgInputs(s: Awaited<ReturnType<typeof startNativeAvgAssembly>>) {
  const workspace = JSON.parse((await readAvgDraftV1(s.scope)).editorJson!) as AvgAuthorWorkspaceV1
  for (const artifactKey of ['avg.system.plan',...workspace.systemPlan.scenes.map(scene=>`avg.content.scene-script.${scene.key}`),'avg.author.stage']) {
    const draft = await readAvgDraftV1(s.scope)
    const candidate = await stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:draft.revision,artifactKey,
      declaration:'作者确认原创工程文本、规则与演出；媒资来源与授权见准确清单。'})
    const build = (await db.productBuilds.get(s.buildId))!, production = (await db.productProductions.get(s.productionId))!
    const result = await executeProductProductionCommand({scope:s.scope,productionId:s.productionId,command:{ type:'adopt-avg-artifact',
      commandId:`avg.author.confirm.${crypto.randomUUID()}`,expectedStateRevision:production.stateRevision,expectedBuildRevision:build.stateRevision,
      controlEpoch:build.controlEpoch,buildNumber:build.buildNumber,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash as string }})
    if (!result.ok) throw new Error(JSON.stringify(result))
  }
  return readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
}
