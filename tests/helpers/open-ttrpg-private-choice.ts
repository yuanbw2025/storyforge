import { setup,start } from './open-ttrpg-knowledge'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
export async function seedPrivateChoiceFixtureV1(options: { humanGm?: boolean; hidden?: boolean } = {}) {
  const f = await setup({ generic: true,cost: true,failForward: true },pkg => {
    pkg.ttrpg!.campaign.gmMode = options.humanGm === false ? 'ai' : 'human'
    pkg.ttrpg!.campaign.informationPolicy.hiddenDice = 'gm-only'
    pkg.ttrpg!.campaign.characterTemplates[1].playerProfile!.secret = 'OTHER-PRIVATE-PROFILE'
    const t = pkg.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'plan.discovery.cost')!
    t.alternatives = [{ alternativeKey: 'small',title: '少量消耗',effects: t.effects },{ alternativeKey: 'large',title: '更多消耗',effects: t.effects.map(e => e.family === 'numeric' ? { ...e,amount: 2 } : e) }];t.effects = []
    if (options.hidden) { t.audience = 'gm';t.reason = 'PRIVATE-GM-REASON';t.alternatives[0].title = 'PRIVATE-GM-CHOICE' }
  })
  const command = await start(f);await resumeTtrpgOpenOperationV1(command)
  const player = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER },host = { ...player,viewerKey: options.humanGm === false ? OPEN_HUMAN_VIEWER : 'viewer.gm' }
  return { f,command,player,host,locator: { operationKey: command.operationKey,kind: 'knowledge' as const,templateKey: 'plan.discovery.cost' } }
}
