import { readyOpenTtrpgSessionV1,OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
export async function seedTableConversationV1(humanGm = true) {
  const f = await readyOpenTtrpgSessionV1('本桌讨论与规则询问',p => {
    p.ttrpg!.campaign.gmMode = humanGm ? 'human' : 'ai';p.ttrpg!.campaign.runtimePolicy.enabled = false
    p.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
  })
  const input = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER }
  return { f,input,host: { ...input,viewerKey: humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER },other: { ...input,viewerKey: 'viewer.seat.companion.1' } }
}
