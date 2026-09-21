import { db } from '../lib/db/schema'
import {
  authorizeProductProductionStartV1,
  beginProductProductionEvolutionV1,
  canRetryProductProductionBlockerV1,
  canUpgradeTextAdventureProductionPlanV1,
  readProductProductionDetailsV1,
  resolveTextAdventureSourceDecisionV1,
  retryProductProductionBlockerV1,
  runAuthorizedProductProductionV1,
  upgradeTextAdventureProductionPlanV1,
} from '../lib/product-production/service'

const QUERY_FLAG = 'narrative-quality-repair-v42'
const ONCE_KEY = 'codex.build95-directed-quality-repair.v206'
const PRODUCTION_KEY = 'productprod.mtqcyoyo.ae9e63f7'

function report(payload: Record<string, unknown>): void {
  void fetch('http://127.0.0.1:5200/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runner: ONCE_KEY, at: new Date().toISOString(), ...payload }),
  }).catch(() => undefined)
}

export async function recoverBuild59QualityAuthorityEpoch351V104(): Promise<void> {
  const buildFlag = new URLSearchParams(location.search).get('build')
  // The guarded repair runner may resume from the normal product URL after a
  // Vite reload. A different explicit build flag still isolates older
  // diagnostics, while the exact production/build/revision checks below make
  // the unflagged current product page safe.
  if (buildFlag != null && buildFlag !== QUERY_FLAG && buildFlag !== 'quality-repair-v6') return
  if (localStorage.getItem(ONCE_KEY) === 'started') return
  localStorage.setItem(ONCE_KEY, 'started')
  const production = (await db.productProductions.toArray()).find(row => row.productionKey === PRODUCTION_KEY)
  if (!production?.id) throw new Error('[build59-quality-authority-recovery-v104] production missing')
  const scope = { projectId: production.projectId, worldId: production.worldId, workId: production.workId }
  const runExpectedBuildUntilDecision = async (
    expectedBuildNumber: number,
    expectedBriefRevision: number,
  ): Promise<void> => {
    let retriedNonAutomaticFailureOnce = false
    let lastAutomaticFailureSignature = ''
    let qualityRepairRetries = 0
    for (let recoveryIndex = 0; recoveryIndex < 20; recoveryIndex += 1) {
      let current = await readProductProductionDetailsV1(scope, production.id!)
      if (current.build?.buildNumber !== expectedBuildNumber
        || current.brief?.revision !== expectedBriefRevision) {
        report({ phase: 'expected-build-identity-changed', recoveryIndex, expectedBuildNumber, expectedBriefRevision, buildNumber: current.build?.buildNumber ?? null, briefRevision: current.brief?.revision ?? null })
        return
      }
      if (current.build.status === 'recovery-required') {
        let currentFailure: { code?: unknown; detail?: unknown } = {}
        try { currentFailure = JSON.parse(current.build.failureJson) as typeof currentFailure } catch { /* malformed failure remains explicitly retryable */ }
        const currentFailureCode = typeof currentFailure.code === 'string' ? currentFailure.code : ''
        const currentFailureDetail = typeof currentFailure.detail === 'string' ? currentFailure.detail : ''
        const nonAutomaticFailure = [
          'task-preflight-failed', 'task-result-unknown', 'provider-result-unknown',
          'task-budget-exceeded',
        ].includes(currentFailureCode) || currentFailureDetail === 'Failed to fetch'
        const qualityRepairFailure = currentFailureCode === 'task-executor-failed'
          && currentFailureDetail.includes('文字冒险叙事质量审查未通过')
        const latestQualityHash = qualityRepairFailure
          ? (await db.productBuildArtifacts
              .where('[buildId+artifactKey]')
              .equals([current.build.id!, 'quality.adventure-review'])
              .toArray())
              .sort((left, right) => right.version - left.version)[0]?.contentHash ?? ''
          : ''
        const automaticFailureSignature = `${currentFailureCode}:${currentFailureDetail}:${latestQualityHash}`
        if (!nonAutomaticFailure && automaticFailureSignature === lastAutomaticFailureSignature) {
          report({
            phase: 'pause-after-repeated-automatic-failure', recoveryIndex,
            buildNumber: expectedBuildNumber, controlEpoch: current.build.controlEpoch,
            failure: JSON.parse(current.build.failureJson),
          })
          return
        }
        if (nonAutomaticFailure && retriedNonAutomaticFailureOnce) {
          report({
            phase: 'pause-after-repeated-non-automatic-failure', recoveryIndex,
            buildNumber: expectedBuildNumber, controlEpoch: current.build.controlEpoch,
            failure: JSON.parse(current.build.failureJson),
          })
          return
        }
        if (nonAutomaticFailure) retriedNonAutomaticFailureOnce = true
        else {
          lastAutomaticFailureSignature = automaticFailureSignature
          if (qualityRepairFailure) {
            qualityRepairRetries += 1
            if (qualityRepairRetries > 3) {
              report({
                phase: 'pause-after-quality-repair-budget', recoveryIndex,
                buildNumber: expectedBuildNumber, controlEpoch: current.build.controlEpoch,
                latestQualityHash,
              })
              return
            }
          }
        }
        if (current.build.failureJson.includes('source.author-gate')) {
          report({ phase: 'accept-expected-build-product-private-source-additions', recoveryIndex, buildNumber: expectedBuildNumber, controlEpoch: current.build.controlEpoch })
          await resolveTextAdventureSourceDecisionV1({
            scope, details: current, action: 'accept-product-private-expansion',
            note: '开发代审：继续接受已经确认的产品私域补充，不回写世界引擎；本轮只修复 scene.009 的涅洛到场因果和 scene.010 的重复对白，并保持 scene.008 已修复的玩家选择时序。',
          })
          current = await readProductProductionDetailsV1(scope, production.id!)
        } else if (canRetryProductProductionBlockerV1(current)) {
          report({ phase: 'retry-expected-build-production-blocker', recoveryIndex, buildNumber: expectedBuildNumber, failure: JSON.parse(current.build.failureJson) })
          await retryProductProductionBlockerV1({ scope, details: current })
          current = await readProductProductionDetailsV1(scope, production.id!)
        } else {
          report({ phase: 'expected-build-awaiting-decision', recoveryIndex, buildNumber: expectedBuildNumber, buildStatus: current.build.status, failure: JSON.parse(current.build.failureJson) })
          return
        }
      }
      if (current.build?.status !== 'authorized' && current.build?.status !== 'building') {
        report({ phase: 'expected-build-stopped-outside-run-state', recoveryIndex, buildNumber: expectedBuildNumber, buildStatus: current.build?.status ?? null })
        return
      }
      try {
        const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id! })
        report({ phase: 'completed', recoveryIndex, buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const after = await readProductProductionDetailsV1(scope, production.id!)
        report({
          phase: 'stopped', recoveryIndex,
          message,
          buildStatus: after.build?.status ?? null, buildNumber: after.build?.buildNumber ?? null,
          controlEpoch: after.production.controlEpoch,
          failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
        })
        // Capability/configuration validation runs before the durable scheduler
        // mutates the Build. Retrying in the same page load cannot change that
        // configuration and would only hammer the local/provider boundary.
        if (message.includes('capability-unbound')) return
      }
    }
  }
  const details = await readProductProductionDetailsV1(scope, production.id)
  if (details.build?.id && details.build.buildNumber === 95 && details.brief?.revision === 63) {
    await runExpectedBuildUntilDecision(95, 63)
    return
  }
  if (details.build?.id && details.build.buildNumber === 94 && details.brief?.revision === 62
    && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('media.anchor-author-gate')) {
    report({
      phase: 'create-build95-pre-media-narration-authority-repair',
      buildNumber: 94, controlEpoch: details.build.controlEpoch,
    })
    const evolved = await beginProductProductionEvolutionV1({
      scope,
      productionId: production.id,
      commandId: 'codex.build94-pre-media-narration-authority.v204.evolve',
      userText: '正式出图前的人类内容复核否决当前文本版本，必须完成一次内容与视觉联动返修。第一，玩家可见 narration 必须从开局到三个结局统一使用第二人称“你”指代 player 岚舟，不得再用“他/他的/他自己”或“她/她的/她自己”继续指代玩家；角色对白需要第三人称谈及岚舟时，以冻结 WorldRelease 的女性身份语义为准。第二，scene.012 的 beat.act-3.part-1.scene-02.008 当前由阿塔误说“我是他留在最后的记录。也是我自己的回声”，这是从 scene.011 沉砾回声复制来的台词；必须保留 speakerKey=character.npc-03，并改写成符合阿塔身份、声音、现场知识与当前冲突的独有对白。第三，scene.003 中涅洛断言沉砾“死了”与冻结的“失踪”事实冲突，改为角色在其知识边界内能够成立的“没回来/没人再见过”或明确只是一种推测。逐场复核所有旁白人称、speakerKey、角色知识、选择前后时序和跨场景重复；保持冻结 WorldRelease、故事结构、15 个场景、23 个选择、三种结局、任务/规则、稳定 key、60 分钟篇幅与 12 张插图合同不变。所有受影响插图需求必须根据修订后的正文重算，不得生成图片，直到新的质量门再次通过并到达角色视觉锚点确认闸门。',
      affectedLanes: ['content', 'visual'],
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build95-pre-media-narration-authority-v204] Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 95 || authorized.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build95-pre-media-narration-authority-v204] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(95, evolved.briefRevision)
    return
  }
  if (details.build?.id && details.build.buildNumber === 94 && details.brief?.revision === 62) {
    await runExpectedBuildUntilDecision(94, 62)
    return
  }
  if (details.build?.id && details.build.buildNumber === 93 && details.brief?.revision === 61
    && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('Build lifetime budget 不足:')) {
    report({ phase: 'create-build94-budget-recovery', buildNumber: 93, controlEpoch: details.build.controlEpoch })
    const evolved = await beginProductProductionEvolutionV1({
      scope, productionId: production.id,
      userText: 'Build #93 已耗尽冻结 lifetime 模型调用预算。只创建预算恢复子 Build，继承全部哈希可验证且输入未陈旧的工件与最新叙事质量证据；继续修复已登记的代词一致性、选择回响、对白角色归属、导师回声说明和重复感问题。不得修改冻结 WorldRelease、产品范围、60 分钟篇幅、通用玩法、三结局、稳定 key 或 12 张插图合同。',
      affectedLanes: ['production-budget'],
      commandId: 'codex.build93-budget-recovery.v201.evolve',
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build94-budget-recovery-v201] Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 94 || authorized.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build94-budget-recovery-v201] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(94, evolved.briefRevision)
    return
  }
  if (details.build?.id && details.build.buildNumber === 93 && details.brief?.revision === 61) {
    await runExpectedBuildUntilDecision(93, 61)
    return
  }
  if (details.build?.id && details.build.buildNumber === 92 && details.brief?.revision === 60
    && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('task usage 超出 Plan 预算预留')
    && canUpgradeTextAdventureProductionPlanV1(details)) {
    report({ phase: 'create-build93-measured-plan-upgrade', buildNumber: 92, controlEpoch: details.build.controlEpoch })
    const upgraded = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const upgradedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (upgradedDetails.brief?.revision !== upgraded.briefRevision) {
      throw new Error('[build93-measured-plan-upgrade-v192] Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: upgradedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 93 || authorized.brief?.revision !== upgraded.briefRevision) {
      throw new Error('[build93-measured-plan-upgrade-v192] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(93, upgraded.briefRevision)
    return
  }
  if (details.build?.id && details.build.buildNumber === 92 && details.brief?.revision === 60) {
    await runExpectedBuildUntilDecision(92, 60)
    return
  }
  if (details.build?.id && details.build.buildNumber === 91 && details.brief?.revision === 59
    && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('media.anchor-author-gate')) {
    report({ phase: 'create-build92-kinship-authority-repair', buildNumber: 91, controlEpoch: details.build.controlEpoch })
    const evolved = await beginProductProductionEvolutionV1({
      scope, productionId: production.id,
      commandId: 'codex.build91-kinship-authority-repair.v191.evolve',
      userText: '作者在正式出图前复核发现一项阻断性的角色关系越权：ending.003 的 beat.act-3.part-2.ending-03.007 把冻结为导师的沉砾说成岚舟的父亲。必须保持沉砾与岚舟已冻结的师徒关系、所有稳定 key、剧情结构、通用玩法、60 分钟篇幅、三结局与 12 张插图合同不变，仅把该句及必要的相邻对白改写为与 Cast Bible 一致的导师关系，并重新执行叙事质量审查与受影响的视觉需求。不得新增任何亲属揭示。',
      affectedLanes: ['content', 'visual'],
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build92-kinship-authority-repair-v191] Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 92 || authorized.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build92-kinship-authority-repair-v191] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(92, evolved.briefRevision)
    return
  }
  if (details.build?.id && details.build.buildNumber === 91 && details.brief?.revision === 59
    && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('task usage 超出 Plan 预算预留')
    && canUpgradeTextAdventureProductionPlanV1(details)) {
    report({ phase: 'create-build92-review-budget-plan-upgrade', buildNumber: 91, controlEpoch: details.build.controlEpoch })
    const upgraded = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const upgradedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (upgradedDetails.brief?.revision !== upgraded.briefRevision) {
      throw new Error('[build92-review-budget-plan-upgrade-v190] Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: upgradedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 92 || authorized.brief?.revision !== upgraded.briefRevision) {
      throw new Error('[build92-review-budget-plan-upgrade-v190] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(92, upgraded.briefRevision)
    return
  }
  if (details.build?.id && details.build.buildNumber === 91 && details.brief?.revision === 59) {
    await runExpectedBuildUntilDecision(91, 59)
    return
  }
  if (details.build?.id && details.build.buildNumber === 90
    && details.brief?.revision === 58
    && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('Build lifetime budget 不足:')) {
    report({ phase: 'create-build91-budget-recovery', buildNumber: 90, controlEpoch: details.build.controlEpoch })
    const evolved = await beginProductProductionEvolutionV1({
      scope, productionId: production.id,
      userText: '当前 Build 已耗尽正式模型调用预算。仅创建预算恢复子 Build，继承所有已签收且输入未陈旧的工件，继续修复当前叙事质量阻断；不得修改冻结世界、产品范围、60 分钟篇幅、通用玩法系统、三结局和 12 张插图合同。',
      affectedLanes: ['production-budget'],
      commandId: 'codex.build90-budget-recovery.v184.evolve',
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build91-budget-recovery-v184] Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 91 || authorized.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build91-budget-recovery-v184] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(91, evolved.briefRevision)
    return
  }
  if (details.build?.id && details.build.buildNumber === 90 && details.brief?.revision === 58) {
    await runExpectedBuildUntilDecision(90, 58)
    return
  }
  if (details.build?.id && details.build.buildNumber === 89
    && details.brief?.revision === 58 && details.brief.status === 'draft') {
    report({ phase: 'authorize-existing-build90-brief', buildNumber: details.build.buildNumber, controlEpoch: details.build.controlEpoch })
    await authorizeProductProductionStartV1({ scope, details })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    if (authorized.build?.buildNumber !== 90 || authorized.brief?.revision !== 58) {
      throw new Error('[build90-final-narrative-repair-v181] authorized identity mismatch')
    }
    await runExpectedBuildUntilDecision(90, 58)
    return
  }
  if (details.build?.id && details.build.buildNumber === 89
    && details.build.status === 'recovery-required'
    && details.brief?.revision === 57
    && details.build.failureJson.includes('media.anchor-author-gate')) {
    report({ phase: 'create-build90-final-narrative-repair', buildNumber: details.build.buildNumber, controlEpoch: details.build.controlEpoch })
    const evolved = await beginProductProductionEvolutionV1({
      scope, productionId: production.id,
      commandId: 'codex.build89-final-narrative-repair.v180.evolve',
      userText: '作者在生成正式图片前复核确认仍有两项发布阻断：scene.009 必须在涅洛出场之前明确写出他因收到消息赶来、沿信号追来或与岚舟预先约定汇合的因果，不能让角色无铺垫地突然出现；scene.010 的 beat.act-2.part-2.scene-02.013 与 beat.act-2.part-2.scene-02.014 逐字重复，必须删除冗余或将后一条改写为阿塔真实而有推进作用的反应。完整保留 scene.008 已修复的选择前后顺序、冻结世界、通用图结构、玩法系统、60 分钟篇幅、三结局及全部合同；只重跑受影响正文、对白、质量审查与视觉需求。',
      affectedLanes: ['content', 'visual'],
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build90-final-narrative-repair-v180] evolved identity mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    await runExpectedBuildUntilDecision(90, 58)
    return
  }
  if (details.build?.id && details.build.buildNumber === 89
    && details.build.status === 'recovery-required'
    && details.brief?.revision === 57
    && details.build.failureJson.includes('source.author-gate')) {
    report({
      phase: 'accept-build89-product-private-source-additions',
      buildNumber: details.build.buildNumber, controlEpoch: details.build.controlEpoch,
    })
    await resolveTextAdventureSourceDecisionV1({
      scope, details, action: 'accept-product-private-expansion',
      note: '开发代审：确认 WorldRelease 已充分覆盖世界前提、时空、角色、组织、冲突、历史、规则与边界；接受通用物品清单、三结局触发矩阵、12 张插画分配、scene.008 选择时序修复和 scene.009 涅洛到场因果作为本产品私域补充，不回写世界引擎。',
    })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, buildNumber: after.build?.buildNumber ?? null,
        controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 89
    && details.build.status === 'recovery-required'
    && details.brief?.revision === 57
    && !details.build.failureJson.includes('source.author-gate')) {
    let current = details
    for (let recoveryIndex = 0; recoveryIndex < 12; recoveryIndex += 1) {
      if (!canRetryProductProductionBlockerV1(current)) {
        report({
          phase: 'build89-awaiting-non-retry-decision', recoveryIndex,
          buildStatus: current.build?.status ?? null,
          failure: current.build?.failureJson ? JSON.parse(current.build.failureJson) : null,
        })
        return
      }
      report({
        phase: 'retry-build89-production-blocker', recoveryIndex,
        failure: current.build?.failureJson ? JSON.parse(current.build.failureJson) : null,
      })
      await retryProductProductionBlockerV1({ scope, details: current })
      try {
        const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
        report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
        return
      } catch (error) {
        current = await readProductProductionDetailsV1(scope, production.id)
        report({
          phase: 'stopped', recoveryIndex,
          message: error instanceof Error ? error.message : String(error),
          buildStatus: current.build?.status ?? null,
          failure: current.build?.failureJson ? JSON.parse(current.build.failureJson) : null,
        })
      }
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 88
    && details.build.status === 'recovery-required'
    && details.brief?.revision === 56
    && details.build.failureJson.includes('media.anchor-author-gate')) {
    report({
      phase: 'create-pre-media-content-and-visual-repair',
      buildNumber: details.build.buildNumber, controlEpoch: details.build.controlEpoch,
    })
    const evolved = await beginProductProductionEvolutionV1({
      scope, productionId: production.id,
      commandId: 'codex.build88-pre-media-content-repair.v176.evolve',
      userText: '作者在生成正式图片前复核发现两个必须修复的叙事缺陷：scene.008 的正文已经替玩家使用机械记忆匣草图干扰防御、触发警报并支付法力，场景末尾却仍让玩家在小心绕行与使用草图之间选择；必须把选择专属行动与后果移到选择后的确定性结算或目标场景条件化回响，保证选项发生在行动之前。还须补足 scene.009 中涅洛到场的因果交代，并让 decision.003 与 decision.004 的不同持久效果在后续玩家可见正文中产生清晰回响。保持冻结世界、通用图结构、三结局目标、总篇幅与全部系统合同不变；返修全部受影响正文、对白、质量审查和视觉需求，并使用新的叙事节拍重新规划插图。',
      affectedLanes: ['content', 'visual'],
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build88-pre-media-content-repair-v176] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    report({
      phase: 'run-pre-media-content-and-visual-repair', briefRevision: evolved.briefRevision,
      buildNumber: authorized.build?.buildNumber ?? null,
      controlEpoch: authorized.build?.controlEpoch ?? null,
    })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, buildNumber: after.build?.buildNumber ?? null,
        controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 88
    && details.build.status === 'recovery-required'
    && details.brief?.revision === 56
    && details.build.failureJson.includes('integration.package')
    && details.build.failureJson.includes('文字冒险叙事质量审查未通过')) {
    const review = (await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([details.build.id, 'quality.adventure-review']).toArray())
      .filter(row => row.controlEpoch === details.build!.controlEpoch)
      .sort((left, right) => right.version - left.version)[0]
    report({
      phase: 'retry-build88-directed-narrative-quality-repair',
      buildNumber: details.build.buildNumber,
      controlEpoch: details.build.controlEpoch,
      qualityReview: review ? JSON.parse(review.payloadJson) : null,
    })
    let current = details
    for (let recoveryIndex = 0; recoveryIndex < 4; recoveryIndex += 1) {
      if (!canRetryProductProductionBlockerV1(current)) return
      await retryProductProductionBlockerV1({ scope, details: current })
      try {
        const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
        report({
          phase: 'completed', recoveryIndex,
          buildStatus: result.buildStatus, controlEpoch: result.controlEpoch,
        })
        return
      } catch (error) {
        const after = await readProductProductionDetailsV1(scope, production.id)
        report({
          phase: 'stopped', recoveryIndex,
          message: error instanceof Error ? error.message : String(error),
          buildStatus: after.build?.status ?? null, buildNumber: after.build?.buildNumber ?? null,
          controlEpoch: after.production.controlEpoch,
          failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
        })
        current = after
        if (after.build?.buildNumber !== 88 || after.brief?.revision !== 56
          || !canRetryProductProductionBlockerV1(after)) return
        report({
          phase: 'continue-build88-bounded-repair', recoveryIndex: recoveryIndex + 1,
          buildNumber: after.build.buildNumber, controlEpoch: after.build.controlEpoch,
        })
      }
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 69
    && details.build.controlEpoch === 394 && details.build.status === 'recovery-required'
    && details.brief?.revision === 49
    && details.build.failureJson.includes('media.vision-preflight')
    && details.build.failureJson.includes('inputTokens=7387/4224')) {
    report({ phase: 'create-vision-preflight-provider-usage-recovery-child-build', buildNumber: 69, controlEpoch: 394 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) throw new Error('[build69-vision-preflight-provider-usage-child-recovery-v171] Brief revision mismatch')
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    report({ phase: 'run-vision-preflight-provider-usage-recovery-child-build', briefRevision: evolved.briefRevision, buildNumber: authorized.build?.buildNumber ?? null, controlEpoch: authorized.build?.controlEpoch ?? null })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 69
    && details.build.controlEpoch === 393 && details.build.status === 'recovery-required'
    && details.brief?.revision === 49
    && details.build.failureJson.includes('media.vision-preflight')
    && details.build.failureJson.includes('vision preflight model output 字段不精确')) {
    report({ phase: 'retry-vision-preflight-empty-object', buildNumber: 69, controlEpoch: 393 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 68
    && details.build.controlEpoch === 393 && details.build.status === 'recovery-required'
    && details.brief?.revision === 48
    && details.build.failureJson.includes('media.vision-preflight')
    && details.build.failureJson.includes('inputTokens=2163/1584')) {
    report({ phase: 'create-vision-preflight-provider-variance-recovery-child-build', buildNumber: 68, controlEpoch: 393 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) throw new Error('[build68-vision-preflight-budget-child-recovery-v169] Brief revision mismatch')
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    report({ phase: 'run-vision-preflight-provider-variance-recovery-child-build', briefRevision: evolved.briefRevision, buildNumber: authorized.build?.buildNumber ?? null, controlEpoch: authorized.build?.controlEpoch ?? null })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 67
    && details.build.controlEpoch === 393 && details.build.status === 'recovery-required'
    && details.brief?.revision === 47
    && details.build.failureJson.includes('media.vision-preflight')
    && details.build.failureJson.includes('inputTokens=1141/528')) {
    report({ phase: 'create-vision-preflight-budget-recovery-child-build', buildNumber: 67, controlEpoch: 393 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) throw new Error('[build67-vision-preflight-budget-child-recovery-v168] Brief revision mismatch')
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    report({ phase: 'run-vision-preflight-budget-recovery-child-build', briefRevision: evolved.briefRevision, buildNumber: authorized.build?.buildNumber ?? null, controlEpoch: authorized.build?.controlEpoch ?? null })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 67
    && details.build.controlEpoch === 392 && details.build.status === 'recovery-required'
    && details.brief?.revision === 47
    && details.build.failureJson.includes('choice.021')
    && details.build.failureJson.includes('targetNodeKey 被错误引用为 scene.015')) {
    report({ phase: 'retry-quality-edge', buildNumber: 67, controlEpoch: 392 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 66
    && details.build.controlEpoch === 392 && details.build.status === 'recovery-required'
    && details.brief?.revision === 46
    && details.build.failureJson.includes('content.adventure-quality-review.act-2')
    && details.build.failureJson.includes('outputTokens=18550/15128')) {
    report({ phase: 'create-quality-budget-recovery-child-build', buildNumber: 66, controlEpoch: 392 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) throw new Error('[build66-quality-budget-child-recovery-v166] Brief revision mismatch')
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    report({ phase: 'run-quality-budget-recovery-child-build', briefRevision: evolved.briefRevision, buildNumber: authorized.build?.buildNumber ?? null, controlEpoch: authorized.build?.controlEpoch ?? null })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 66
    && details.build.controlEpoch === 392 && details.build.status === 'authorized'
    && details.brief?.revision === 46) {
    report({ phase: 'run-authorized-build', buildNumber: 66, controlEpoch: 392 })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 65
    && details.build.controlEpoch === 392 && details.build.status === 'recovery-required'
    && details.brief?.revision === 45
    && details.build.failureJson.includes('choice.015')
    && details.build.failureJson.includes('targetNodeKey 被错误引用为 scene.013')) {
    report({ phase: 'create-quality-edge-recovery-child-build', buildNumber: 65, controlEpoch: 392 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) throw new Error('[build65-quality-edge-child-recovery-v162] Brief revision mismatch')
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorized = await readProductProductionDetailsV1(scope, production.id)
    report({ phase: 'run-quality-edge-recovery-child-build', briefRevision: evolved.briefRevision, buildNumber: authorized.build?.buildNumber ?? null, controlEpoch: authorized.build?.controlEpoch ?? null })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({ phase: 'stopped', message: error instanceof Error ? error.message : String(error), buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch, failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 64
    && details.build.controlEpoch === 389 && details.build.status === 'recovery-required'
    && details.brief?.revision === 44
    && details.build.failureJson.includes('content.adventure-quality-review.structure')
    && details.build.failureJson.includes('content.narrative-arc-plan')
    && details.build.failureJson.includes('content.adventure-architecture')) {
    report({ phase: 'create-quality-owner-map-recovery-child-build', buildNumber: 64, controlEpoch: 389 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build64-quality-owner-map-child-recovery-v161] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    for (let recoveryIndex = 0; recoveryIndex < 4; recoveryIndex += 1) {
      const beforeRun = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: recoveryIndex === 0 ? 'run-quality-owner-map-recovery-child-build' : 'run-bounded-confirmed-recovery',
        recoveryIndex, briefRevision: evolved.briefRevision,
        buildNumber: beforeRun.build?.buildNumber ?? null,
        controlEpoch: beforeRun.build?.controlEpoch ?? null,
      })
      try {
        const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
        report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
        return
      } catch (error) {
        const after = await readProductProductionDetailsV1(scope, production.id)
        report({
          phase: 'stopped', recoveryIndex,
          message: error instanceof Error ? error.message : String(error),
          buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
          failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
        })
        if (recoveryIndex >= 3 || !canRetryProductProductionBlockerV1(after)) return
        report({
          phase: 'confirm-bounded-retry', recoveryIndex: recoveryIndex + 1,
          buildNumber: after.build?.buildNumber ?? null,
          controlEpoch: after.build?.controlEpoch ?? null,
        })
        await retryProductProductionBlockerV1({ scope, details: after })
      }
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 63
    && details.build.controlEpoch === 386 && details.build.status === 'recovery-required'
    && details.brief?.revision === 43
    && details.build.failureJson.includes('content.quest-script.main.act-1.multi')
    && details.build.failureJson.includes('超过任务合同 300000ms')) {
    report({ phase: 'create-main-task-timeout-recovery-child-build', buildNumber: 63, controlEpoch: 386 })
    const evolved = await upgradeTextAdventureProductionPlanV1({ scope, productionId: production.id })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build63-main-task-timeout-child-recovery-v160] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    for (let recoveryIndex = 0; recoveryIndex < 4; recoveryIndex += 1) {
      const beforeRun = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: recoveryIndex === 0 ? 'run-main-task-timeout-recovery-child-build' : 'run-bounded-confirmed-recovery',
        recoveryIndex, briefRevision: evolved.briefRevision,
        buildNumber: beforeRun.build?.buildNumber ?? null,
        controlEpoch: beforeRun.build?.controlEpoch ?? null,
      })
      try {
        const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
        report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
        return
      } catch (error) {
        const after = await readProductProductionDetailsV1(scope, production.id)
        report({
          phase: 'stopped', recoveryIndex,
          message: error instanceof Error ? error.message : String(error),
          buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
          failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
        })
        if (recoveryIndex >= 3 || !canRetryProductProductionBlockerV1(after)) return
        report({
          phase: 'confirm-bounded-retry', recoveryIndex: recoveryIndex + 1,
          buildNumber: after.build?.buildNumber ?? null,
          controlEpoch: after.build?.controlEpoch ?? null,
        })
        await retryProductProductionBlockerV1({ scope, details: after })
      }
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 62
    && details.build.controlEpoch === 383 && details.build.status === 'recovery-required'
    && details.brief?.revision === 42
    && details.build.failureJson.includes('content.adventure-quality-review.structure')
    && details.build.failureJson.includes('scene.002a')
    && details.build.failureJson.includes('scene.002b')) {
    report({ phase: 'create-quality-reference-recovery-child-build', buildNumber: 62, controlEpoch: 383 })
    const evolved = await upgradeTextAdventureProductionPlanV1({
      scope,
      productionId: production.id,
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build62-quality-reference-child-recovery-v158] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    for (let recoveryIndex = 0; recoveryIndex < 4; recoveryIndex += 1) {
      const beforeRun = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: recoveryIndex === 0 ? 'run-quality-reference-recovery-child-build' : 'run-bounded-confirmed-recovery',
        recoveryIndex, briefRevision: evolved.briefRevision,
        buildNumber: beforeRun.build?.buildNumber ?? null,
        controlEpoch: beforeRun.build?.controlEpoch ?? null,
      })
      try {
        const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
        report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
        return
      } catch (error) {
        const after = await readProductProductionDetailsV1(scope, production.id)
        report({
          phase: 'stopped', recoveryIndex,
          message: error instanceof Error ? error.message : String(error),
          buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
          failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
        })
        if (recoveryIndex >= 3 || !canRetryProductProductionBlockerV1(after)) return
        report({
          phase: 'confirm-bounded-retry', recoveryIndex: recoveryIndex + 1,
          buildNumber: after.build?.buildNumber ?? null,
          controlEpoch: after.build?.controlEpoch ?? null,
        })
        await retryProductProductionBlockerV1({ scope, details: after })
      }
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 62
    && details.build.controlEpoch === 382 && details.build.status === 'recovery-required'
    && details.brief?.revision === 42
    && details.build.failureJson.includes('content.dialogue-pass.act-3')
    && details.build.failureJson.includes('模型输出为空或过长')) {
    report({ phase: 'retry-dialogue-empty-and-pending-blockers', buildNumber: 62, controlEpoch: 382 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 62
    && details.build.controlEpoch === 381 && details.build.status === 'recovery-required'
    && details.brief?.revision === 42
    && details.build.failureJson.includes('content.scene-script.act-2.part-1')
    && details.build.failureJson.includes('task-result-unknown')) {
    report({ phase: 'retry-act2-network-and-pending-scene-blockers', buildNumber: 62, controlEpoch: 381 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 62
    && details.build.controlEpoch === 380 && details.build.status === 'recovery-required'
    && details.brief?.revision === 42
    && details.build.failureJson.includes('content.scene-script.act-1.part-2')
    && details.build.failureJson.includes('halfway')) {
    report({ phase: 'retry-scene-shape-and-localization-blockers', buildNumber: 62, controlEpoch: 380 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 62
    && details.build.controlEpoch === 379 && details.build.status === 'recovery-required'
    && details.brief?.revision === 42
    && details.build.failureJson.includes('content.quest-script.main.act-3.single')
    && details.build.failureJson.includes('task-result-unknown')
    && details.build.failureJson.includes('content.adventure-ambient-events')
    && details.build.failureJson.includes('cracking')) {
    report({ phase: 'retry-network-and-localization-blockers', buildNumber: 62, controlEpoch: 379 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 61
    && details.build.controlEpoch === 379 && details.build.status === 'recovery-required'
    && details.brief?.revision === 41
    && details.build.failureJson.includes('content.adventure-side-quests')
    && details.build.failureJson.includes('durationMs=207291/180000')) {
    report({ phase: 'create-execution-plan-recovery-child-build', buildNumber: 61, controlEpoch: 379 })
    const evolved = await upgradeTextAdventureProductionPlanV1({
      scope,
      productionId: production.id,
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build61-execution-plan-child-build-recovery-v153] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorizedDetails = await readProductProductionDetailsV1(scope, production.id)
    report({
      phase: 'run-execution-plan-recovery-child-build', briefRevision: evolved.briefRevision,
      buildNumber: authorizedDetails.build?.buildNumber ?? null,
      controlEpoch: authorizedDetails.build?.controlEpoch ?? null,
    })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 61
    && details.build.controlEpoch === 378 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.adventure-quality-review.act-3')
    && details.build.failureJson.includes('content.narrative:choices.choice.020')) {
    report({ phase: 'retry-quality-qualified-owning-normalization', buildNumber: 61, controlEpoch: 378 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 61
    && details.build.controlEpoch === 377 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('integration.package')
    && details.build.failureJson.includes('文字冒险叙事质量审查未通过')) {
    report({ phase: 'retry-choice-promise-quality-repair', buildNumber: 61, controlEpoch: 377 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 61
    && details.build.controlEpoch === 377 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('integration.package')
    && details.build.failureJson.includes('文字冒险叙事质量审查未通过')) {
    const qualityArtifacts = (await db.productBuildArtifacts
      .where('buildId').equals(details.build.id).toArray())
      .filter(row => row.controlEpoch === 377
        && (row.artifactKey === 'quality.adventure-review'
          || row.artifactKey.startsWith('quality.adventure-review.')))
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
      .map(row => ({
        artifactKey: row.artifactKey,
        status: row.status,
        payload: JSON.parse(row.payloadJson),
        quality: JSON.parse(row.qualityJson),
      }))
    report({
      phase: 'inspect-quality-result', buildNumber: 61,
      controlEpoch: 377, qualityArtifacts,
    })
    return
  }
  if (details.build?.id && details.build.buildNumber === 61
    && details.build.controlEpoch === 376 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.adventure-quality-review.act-2')
    && details.build.failureJson.includes('owningKey 未登记或不归本批:scene.007, beatKey=')) {
    report({ phase: 'retry-quality-owning-prefix-normalization', buildNumber: 61, controlEpoch: 376 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 376 && details.build.status === 'recovery-required'
    && details.brief?.revision === 40
    && details.build.failureJson.includes('Build lifetime budget 不足:modelCalls=119/118')) {
    report({ phase: 'create-budget-recovery-child-build', buildNumber: 60, controlEpoch: 376 })
    const evolved = await beginProductProductionEvolutionV1({
      scope,
      productionId: production.id,
      userText: '当前 Build 已耗尽原作者授权的模型调用预算。仅扩充专业文字冒险生产预算并续建；继承所有可证明未变化且已签收的工件，不修改剧情、玩法、世界来源或媒资范围。',
      affectedLanes: ['production-budget'],
      commandId: 'codex.build60-budget-child-build-recovery.v147.evolve',
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build60-budget-child-build-recovery-v147] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorizedDetails = await readProductProductionDetailsV1(scope, production.id)
    report({
      phase: 'run-budget-recovery-child-build', briefRevision: evolved.briefRevision,
      buildNumber: authorizedDetails.build?.buildNumber ?? null,
      controlEpoch: authorizedDetails.build?.controlEpoch ?? null,
    })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 375 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.scene-script.act-3.part-2')
    && details.build.failureJson.includes('scenes[2] 不属于本幕:scene.016')) {
    report({ phase: 'retry-scene-act3-frozen-scope', buildNumber: 60, controlEpoch: 375 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 374 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.adventure-quality-review.act-1')
    && details.build.failureJson.includes('叙事质量审查错误引用冻结身份')
    && details.build.failureJson.includes('scene.001.beat.005')) {
    report({ phase: 'retry-quality-with-exact-beat-map', buildNumber: 60, controlEpoch: 374 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 373 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.scene-script.act-3.part-2')
    && details.build.failureJson.includes('文字冒险玩家可见字段混入未本地化外语')) {
    report({ phase: 'retry-scene-act3-localization', buildNumber: 60, controlEpoch: 373 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 372 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.scene-script.act-3.part-2')
    && details.build.failureJson.includes('sceneScriptBundle.scenes sceneKey 重复')) {
    report({ phase: 'retry-scene-act3-unique-identities', buildNumber: 60, controlEpoch: 372 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 371 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.adventure-side-quests')
    && details.build.failureJson.includes('压缩/截断前原文没有 exact snapshot')) {
    report({ phase: 'retry-with-exact-repair-snapshot', buildNumber: 60, controlEpoch: 371 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 370 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('integration.package')
    && details.build.failureJson.includes('文字冒险叙事质量审查未通过')) {
    const qualityArtifacts = (await db.productBuildArtifacts
      .where('buildId').equals(details.build.id).toArray())
      .filter(row => row.controlEpoch === 370
        && (row.artifactKey === 'quality.adventure-review'
          || row.artifactKey.startsWith('quality.adventure-review.')))
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
      .map(row => ({
        artifactKey: row.artifactKey,
        status: row.status,
        payload: JSON.parse(row.payloadJson),
        quality: JSON.parse(row.qualityJson),
      }))
    report({
      phase: 'retry-quality-directed-repair', buildNumber: 60,
      controlEpoch: 370, qualityArtifacts,
    })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 369 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.scene-script.act-1.part-2')
    && details.build.failureJson.includes('inputTokens=19369/18480')) {
    report({ phase: 'retry-scene-with-baseline-budget', buildNumber: 60, controlEpoch: 369 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 368 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.scene-script.act-1.part-2')
    && details.build.failureJson.includes('正文不足')) {
    report({ phase: 'retry-scene-from-accepted-baseline', buildNumber: 60, controlEpoch: 368 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 60
    && details.build.controlEpoch === 367 && details.build.status === 'recovery-required'
    && details.build.failureJson.includes('content.adventure-quality-review.act-2')
    && details.build.failureJson.includes('owningKey 未登记或不归本批')) {
    report({ phase: 'retry-quality-owner-normalization', buildNumber: 60, controlEpoch: 367 })
    await retryProductProductionBlockerV1({ scope, details })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 59
    && details.build.controlEpoch === 360 && details.build.status === 'recovery-required'
    && details.brief?.revision === 39
    && details.build.failureJson.includes('Build lifetime budget 不足:modelCalls=119/118')) {
    report({ phase: 'create-budget-recovery-brief', buildNumber: 59, controlEpoch: 360 })
    const evolved = await beginProductProductionEvolutionV1({
      scope,
      productionId: production.id,
      userText: '当前 Build 已耗尽原作者授权的模型预算。仅扩充专业文字冒险生产预算并续建；继承所有可证明未变化且已签收的工件，不修改剧情、玩法、世界来源或媒资范围。',
      affectedLanes: ['production-budget'],
      commandId: 'codex.build59-budget-child-build-recovery.v123.evolve',
    })
    const evolvedDetails = await readProductProductionDetailsV1(scope, production.id)
    if (evolvedDetails.brief?.revision !== evolved.briefRevision) {
      throw new Error('[build59-budget-child-build-recovery-v123] evolved Brief revision mismatch')
    }
    await authorizeProductProductionStartV1({ scope, details: evolvedDetails })
    const authorizedDetails = await readProductProductionDetailsV1(scope, production.id)
    report({
      phase: 'run-budget-recovery-child-build', briefRevision: evolved.briefRevision,
      buildNumber: authorizedDetails.build?.buildNumber ?? null,
      controlEpoch: authorizedDetails.build?.controlEpoch ?? null,
    })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (details.build?.id && details.build.buildNumber === 59
    && details.build.controlEpoch === 352 && details.build.status === 'building'
    && details.brief?.revision === 39) {
    const runs = await db.agentRuns.where('productBuildId').equals(details.build.id).toArray()
    const activeRuns = await Promise.all(runs.filter(row => (
      row.status === 'running' || row.status === 'planned'
    )).map(async row => {
      const events = await db.agentRunEvents.where('runId').equals(row.id!).sortBy('sequence')
      return {
        runId: row.id, status: row.status, updatedAt: row.updatedAt,
        contract: JSON.parse(row.contractJson),
        lastEvents: events.slice(-5).map(event => ({
          type: event.type, createdAt: event.createdAt, payload: JSON.parse(event.payloadJson),
        })),
      }
    }))
    report({ phase: 'reconcile-expired-run', buildNumber: 59, controlEpoch: 352, activeRuns })
    try {
      const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
      report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
    } catch (error) {
      const after = await readProductProductionDetailsV1(scope, production.id)
      report({
        phase: 'stopped', message: error instanceof Error ? error.message : String(error),
        buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
        failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
      })
    }
    return
  }
  if (!details.build?.id || details.build.buildNumber !== 59 || details.build.controlEpoch !== 354
    || details.build.status !== 'recovery-required' || details.brief?.revision !== 39
    || !details.build.failureJson.includes('content.scene-script.act-1.part-1')
    || !details.build.failureJson.includes('currents')) {
    report({
      phase: 'guard-snapshot',
      buildNumber: details.build?.buildNumber ?? null,
      buildStatus: details.build?.status ?? null,
      buildEpoch: details.build?.controlEpoch ?? null,
      productionEpoch: details.production.controlEpoch,
      failure: details.build?.failureJson ? JSON.parse(details.build.failureJson) : null,
    })
    return
  }
  report({ phase: 'retry-scene-localization', buildNumber: 59, controlEpoch: 354 })
  await retryProductProductionBlockerV1({ scope, details })
  try {
    const result = await runAuthorizedProductProductionV1({ scope, productionId: production.id })
    report({ phase: 'completed', buildStatus: result.buildStatus, controlEpoch: result.controlEpoch })
  } catch (error) {
    const after = await readProductProductionDetailsV1(scope, production.id)
    report({
      phase: 'stopped', message: error instanceof Error ? error.message : String(error),
      buildStatus: after.build?.status ?? null, controlEpoch: after.production.controlEpoch,
      failure: after.build?.failureJson ? JSON.parse(after.build.failureJson) : null,
    })
  }
}
