import { seedOpenTtrpgSessionV1,OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { consentTtrpgOpenTableSeatV1,consentTtrpgOpenHostSeatV1,startTtrpgOpenTableV1,readTtrpgOpenTableV1,readTtrpgOpenManualActionCatalogV1 } from '../../src/lib/ttrpg/open-table-service'
export async function seedManualTableV1() {
  const f = await seedOpenTtrpgSessionV1('人工规则桌面',p => { p.ttrpg!.campaign.gmMode = 'human';p.ttrpg!.campaign.runtimePolicy.enabled = false })
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
