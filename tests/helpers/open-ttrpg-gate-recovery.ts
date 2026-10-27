/** Actual frozen evidence policy, not a direct edit of running knowledge or gate results. */
import { setupChecksFixtureV1 } from './open-ttrpg-checks'
export async function setupGateHintFixtureV1(options: { unavailable?: boolean; privateRecipient?: boolean; multiHuman?: boolean } = {}) {
  return setupChecksFixtureV1({ multiHuman: options.multiHuman }, pkg => {
    const s = pkg.ttrpg!.campaign.situationTemplates[0]
    s.interventionPoints.forEach(p => { p.targetsObstacleKeys = ['lamp'] })
    const e = s.evidence[1];e.coversObstacleKeys = ['door'];e.isRequired = false
    e.discoveryPolicy.failForwardEffectPlanRef = options.unavailable ? null : 'plan.success'
    e.discoveryPolicy.allowedAudience = 'private';e.discoveryPolicy.recipientActorKeys = options.privateRecipient ? ['companion.1'] : ['hero'];e.discoveryPolicy.requiresPlayerConfirmation = true
    e.title = '规则允许的补充观察';e.description = 'RECOVERY-PRIVATE-OBSERVATION'
  }, async f => { delete f.request.discovery })
}
