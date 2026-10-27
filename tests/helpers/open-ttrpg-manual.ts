import type { ProductRuntimePackageWithTtrpgV2 } from '../../src/lib/ttrpg/content-version'
import { cloneTtrpgCompatibleOpeningTemplateV1,cloneTtrpgCompatibleOpeningTemplateWithEffectsV2 } from '../../src/lib/ttrpg/open-compatible-opening-contract'
import { seedOpenTtrpgSessionV1,OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { consentTtrpgOpenTableSeatV1,consentTtrpgOpenHostSeatV1,startTtrpgOpenTableV1,readTtrpgOpenTableV1,readTtrpgOpenManualActionCatalogV1 } from '../../src/lib/ttrpg/open-table-service'
export async function seedManualTableV1(configure?: Parameters<typeof seedOpenTtrpgSessionV1>[1]) {
  const f = await seedOpenTtrpgSessionV1('人工规则桌面',p => { p.ttrpg!.campaign.gmMode = 'human';p.ttrpg!.campaign.runtimePolicy.enabled = false;configure?.(p) })
  const input = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER },host = { ...input,viewerKey: 'viewer.gm' }
  await consentTtrpgOpenTableSeatV1({ ...input,aiAdviceAllowed: false });await consentTtrpgOpenHostSeatV1(host)
  await startTtrpgOpenTableV1({ ...host,acceptedItemKeys: (await readTtrpgOpenTableV1({ scope: f.scope,sessionId: f.sessionId })).requiredItemKeys })
  return { f,input,host,catalog: await readTtrpgOpenManualActionCatalogV1(input) }
}
export function firstManualRequestV1(catalog: Awaited<ReturnType<typeof readTtrpgOpenManualActionCatalogV1>>,route: 'existing-action' | 'generic-check' = 'existing-action') {
  const rule = catalog.rules.find(r => r.route === route && r.available && r.targets.length)!
  const effectBindings: Record<string,Record<string,string | null>> = Object.fromEntries(rule.templateKeys.map(key => [key,{}]))
  for (const p of rule.parameters) (effectBindings[p.templateKey] ??= {})[p.parameterKey] = p.options[0]?.key ?? null
  return { request: { ...(rule.interactionKey ? { interactionKey: rule.interactionKey } : {}),route,ruleKey: rule.ruleKey,actorKey: catalog.actorKey,targetKey: rule.targets[0].key,controllerMode: 'human' as const,effectBindings },rule }
}

/** Explicit legacy published-content fixture; this bypasses normal author admission only in tests. */
export function configureManualDiscoveryDirectionsV1(p: ProductRuntimePackageWithTtrpgV2) {
    const campaign = p.ttrpg!.campaign,original = campaign.situationTemplates[0]
    original.interventionPoints[0].affordanceHint = '比较公开的两种保管方向'
    original.interventionPoints[1].visibleTo = 'private';original.interventionPoints[1].knownByActorKeys = ['companion.1']
    original.interventionPoints[1].affordanceHint = 'PRIVATE_POINT_HINT'
    original.evidence[0].title = 'PRIVATE_CLUE_TITLE';original.evidence[0].description = 'PRIVATE_CLUE_TEXT'
    original.evidence[0].discoveryPolicy.allowedAudience = 'private'
    original.evidence[0].discoveryPolicy.recipientActorKeys = ['hero']
    original.evidence[0].discoveryPolicy.requiresPlayerConfirmation = true
    original.evidence[0].discoveryPolicy.failForwardEffectPlanRef = 'direction.failure'
    original.evidence[0].discoverableBy.push(p.ttrpg!.rulePack.content.genericChecks[0].checkKey)
    original.evidence[0].discoveryPolicy.paths.push({ kind: 'generic-check',key: p.ttrpg!.rulePack.content.genericChecks[0].checkKey,
      interventionPointKey: original.interventionPoints[0].pointKey })
    campaign.effectPlanTemplates.push({ planKey: 'direction.failure',degree: 'failure',ruleRef: p.ttrpg!.rulePack.content.ruleSystemId,
      reason: 'PRIVATE_RULE_REASON',audience: 'actor:hero',parameters: [],alternatives: [],effects: [{ effectKey: 'direction.knowledge',
        family: 'knowledge',operation: 'knowledge.discover',targetRef: 'hero',evidenceRef: original.evidence[0].clueRef }] })
    const legacy = cloneTtrpgCompatibleOpeningTemplateV1(original,'direction.legacy','PRIVATE_OLD_AUTHOR_TITLE')
    const current = cloneTtrpgCompatibleOpeningTemplateWithEffectsV2({ original,effectPlanTemplates: campaign.effectPlanTemplates,
      templateKey: 'direction.current',title: 'PRIVATE_NEW_AUTHOR_TITLE' })
    campaign.situationTemplates.push(legacy,current.template)
    campaign.effectPlanTemplates.push(...current.effectPlanTemplates)
    campaign.openingSituationKeys = [legacy.templateKey,current.template.templateKey]
}
export function seedManualDiscoveryDirectionsV1() {
  return seedManualTableV1(configureManualDiscoveryDirectionsV1)
}
