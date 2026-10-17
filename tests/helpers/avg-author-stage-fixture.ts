import { db } from '../../src/lib/db/schema'
import { seedAvgAuthorSystem, stageAvgAuthorSystem } from './avg-author-system-fixture'
import { avgNativeScripts } from './avg-native-fixture'
import { avgSystemFixture } from './avg-system-fixture'
import { authorFixtureCommand } from './avg-author-artifact-fixture'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import type { AvgAuthorStageV1, AvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'

export function avgAuthorStageFixture(): AvgAuthorStageV1 {
  return { schema: 'storyforge.avg.author-stage', version: 1, aspectRatio: '16:9', stage: { version: 1, cues: [], assets: [] } }
}
export function avgAuthorWorkspaceFixture(): AvgAuthorWorkspaceV1 {
  return { schema: 'storyforge.avg.author-workspace', version: 1, basePreviewHash: null,
    systemPlan: avgSystemFixture(), scripts: avgNativeScripts(), presentation: avgAuthorStageFixture() }
}
export async function stageInput(s: Awaited<ReturnType<typeof seedAvgAuthorSystem>>) {
  const build = (await db.productBuilds.get(s.buildId))!
  return { scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
}
export async function confirmAuthorStageFixture(s: Awaited<ReturnType<typeof seedAvgAuthorSystem>>, candidate: Awaited<ReturnType<typeof stageAvgAuthorSystem>>, commandId = crypto.randomUUID()) {
  return executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, candidate, commandId) })
}
/** Controlled author-adoption seam only; not the production planner or final workbench. */
export async function seedAvgAuthorStageInputs() {
  const s = await seedAvgAuthorSystem()
  const build = (await db.productBuilds.get(s.buildId))!
  const brief = (await db.productProductionBriefs.where('productionId').equals(s.productionId).first())!
  const rule = s.plan.tasks[0]!
  const scripts = avgNativeScripts()
  const tasks = [rule, ...scripts.map(script => ({ ...rule, taskKey: `script.${script.sceneKey}`, kind: 'avg-author-scene-script', lane: 'content' as const,
    outputArtifactKeys: [`avg.content.scene-script.${script.sceneKey}`], subjectLockKeys: [`avg.content.scene-script.${script.sceneKey}`],
    inputArtifactKeys: ['avg.system.plan'], dependsOn: [rule.taskKey], requiredReceipts: [{ taskKey: rule.taskKey, receiptHash: null }] }))]
  const dependencies = tasks.map(task => task.taskKey)
  tasks.push({ ...rule, taskKey: 'author.stage', kind: 'avg-author-stage', lane: 'visual', outputArtifactKeys: ['avg.author.stage'],
    subjectLockKeys: ['avg.author.stage'], inputArtifactKeys: tasks.flatMap(task => task.outputArtifactKeys), dependsOn: dependencies,
    requiredReceipts: dependencies.map(taskKey => ({ taskKey, receiptHash: null })) })
  const plan = parseProductProductionPlanV3({ ...s.plan, tasks, terminalTaskKey: 'author.stage' }, parseProductProductionBriefV3(brief.briefJson), build.briefHash)
  await db.productBuilds.update(s.buildId, { planJson: canonicalProductProductionJsonV2(plan), planHash: await hashProductProductionValueV2(plan) })
  const ruleCandidate = await stageAvgAuthorSystem(s)
  if (!(await confirmAuthorStageFixture(s, ruleCandidate)).ok) throw new Error('rule adoption failed')
  for (const payload of scripts) {
    const candidate = await stageAvgAuthorArtifactV1({ ...(await stageInput(s)), taskKey: `script.${payload.sceneKey}`,
      artifactKey: `avg.content.scene-script.${payload.sceneKey}`, kind: 'narrative', payload, declaration: '原创工程句；未签文学验收' })
    if (!(await confirmAuthorStageFixture(s, candidate)).ok) throw new Error('script adoption failed')
  }
  return { ...s, plan }
}
export async function stageAuthorStageFixture(s: Awaited<ReturnType<typeof seedAvgAuthorStageInputs>>, payload = avgAuthorStageFixture()) {
  return stageAvgAuthorArtifactV1({ ...(await stageInput(s)), taskKey: 'author.stage', artifactKey: 'avg.author.stage', kind: 'presentation',
    payload, declaration: '作者确认演出和授权媒资；不代表艺术或商业评审' })
}

/** Browser-only genuine decoding probe. Original swatch/tone, not commercial art or speech. */
export async function importAuthorStageMediaFixture(s: Awaited<ReturnType<typeof seedAvgAuthorStageInputs>>) {
  const { importAvgMediaForAssemblyV1 } = await import('../../src/lib/avg/editor-service')
  const { avgReadingAudioFixture, avgReadingFixture } = await import('./avg-reading-fixture')
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18
  const context = canvas.getContext('2d')!; context.fillStyle = '#18213b'; context.fillRect(0,0,32,18)
  const png = await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas failed')), 'image/png'))
  const audio = await avgReadingAudioFixture(850)
  const base = { scope: s.scope, license: 'CC0-1.0 original engineering fixture', altText: '原创校准媒资；非商业质量', characterTag: '' }
  const image = await importAvgMediaForAssemblyV1({ ...base, name: '原创色块背景', data: await png.arrayBuffer(), mimeType: 'image/png', kind: 'background' })
  const voice = await importAvgMediaForAssemblyV1({ ...base, name: '原创校准音（非人声）', data: audio.data, mimeType: 'audio/wav', kind: 'voice' })
  const presentation = avgAuthorStageFixture()
  presentation.stage.assets = [image,voice]
  presentation.stage.cues = [{ cueKey: 'background.desk', beatKey: 'line.desk', type: 'set-background', assetKey: image.assetKey,
    phase: 'before', durationMs: 0, order: 0, easing: 'linear' }]
  presentation.reading = avgReadingFixture({ voices: [{ ...avgReadingFixture().voices[0], assetKey: voice.assetKey }] })
  return { presentation, image, voice }
}
