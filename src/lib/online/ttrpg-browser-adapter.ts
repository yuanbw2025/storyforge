import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import {
  changeTtrpgSafetyStatus,
  commitTtrpgEffectPlanV2,
  proposeTtrpgEffectChoiceV2,
  resolveTtrpgEffectChoiceV2,
  commitTtrpgItemCommandV2,
  commitTtrpgHumanGmNarrationV1,
  completeTtrpgCampaignEnding,
  discoverTtrpgClue,
  openTtrpgCampaignScene,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  recordTtrpgHumanResponseV2,
  completeTtrpgRestV2,
  startTtrpgCampaignSessionV2,
  completeTtrpgCampaignSessionV2,
  resolveTtrpgRuleAction,
  submitTtrpgActionIntentV2,
  updateTtrpgTabletopV1,
} from '../ttrpg/runtime-api'
import { parseTtrpgCampaignContentV1 } from '../ttrpg/campaign'
import { parseRulePackV1 } from '../ttrpg/rule-pack'
import {
  createTtrpgAutomaticSessionRecapsV2,
  createTtrpgViewerProjectionV1,
} from '../ttrpg/viewer-projection'
import type { RulePackV1, TtrpgCampaignContentV1 } from '../types'
import {
  OnlineRoomAuthorityError,
  type OnlineRoomCommandKindV1,
  type OnlineRoomDomainAdapterV1,
  type OnlineRoomDomainEventV1,
  type OnlineRoomMemberV1,
} from './room-authority'
import { VerifiableOnlineDiceV1, type OnlineDiceCommitmentSeriesV1 } from './verifiable-dice'
import {
  createPrivateTtrpgActorActionEventV1,
  createPublicTtrpgActionEventV1,
} from './ttrpg-public-action'
import {
  createOnlineTtrpgHumanResponseVisiblePayloadsV1,
  parseOnlineTtrpgHumanResponseCommandV1,
} from './ttrpg-human-response'
import {
  buildOnlineTtrpgItemCommandV1,
  createOnlineTtrpgItemVisiblePayloadsV1,
} from './ttrpg-item-command'
import {
  createOnlineTtrpgRestVisiblePayloadV1,
  parseOnlineTtrpgRestCommandV1,
} from './ttrpg-rest-command'
import {
  buildOnlineTtrpgEffectCommandV1,
  buildOnlineTtrpgEffectChoiceProposalCommandV1,
  createOnlineTtrpgEffectChoiceVisiblePayloadsV1,
  createOnlineTtrpgEffectVisiblePayloadsV1,
  parseOnlineTtrpgEffectChoiceResolutionCommandV1,
} from './ttrpg-effect-command'
import {
  parseOnlineTtrpgCampaignSessionCompleteV1,
  parseOnlineTtrpgCampaignSessionStartV1,
} from './ttrpg-campaign-session-command'

interface TtrpgRoomChatEntryV1 {
  sequence: number
  memberId: string
  displayName: string
  role: OnlineRoomMemberV1['role']
  actorKey: string | null
  text: string
}

export interface BrowserTtrpgRoomAdapterInspectionV1 {
  releaseHash: string
  productRuntimeSessionId: number
  diceCommitments: OnlineDiceCommitmentSeriesV1
}

function fail(code: string, message: string): never {
  throw new OnlineRoomAuthorityError(code, message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('domain_protocol', `${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== fields.length || actual.some(field => !fields.includes(field))) {
    fail('domain_protocol', `${label} 字段不符合闭集协议`)
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') fail('domain_protocol', `${label} 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) fail('domain_protocol', `${label} 为空或过长`)
  return result
}

function key(value: unknown, label: string): string {
  const result = text(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) fail('domain_protocol', `${label} 无效`)
  return result
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    fail('domain_protocol', `${label} 无效`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail('domain_protocol', `${label} 必须是 boolean`)
  return value
}

function publicEvent(kind: OnlineRoomCommandKindV1, payload: unknown): {
  eventType: string
  publicPayload: unknown
} {
  return { eventType: `ttrpg.${kind}`, publicPayload: structuredClone(payload) }
}

/**
 * Binds the authoritative room protocol to the existing formal browser TTRPG
 * runtime. This is the real local-host bridge used by the current pure-client
 * product: every rules mutation still goes through the frozen ProductRelease and
 * canonical product-runtime event log. It deliberately omits checkpoint hooks so a
 * deployment cannot mistake IndexedDB for a transactional server room store.
 */
export class BrowserFormalTtrpgRoomAdapterV1 implements OnlineRoomDomainAdapterV1 {
  private readonly chat: TtrpgRoomChatEntryV1[] = []

  private constructor(
    private readonly productRuntimeSessionId: number,
    private readonly releaseHash: string,
    private readonly rulePack: RulePackV1,
    private readonly campaign: TtrpgCampaignContentV1,
    private readonly dice: VerifiableOnlineDiceV1,
    private readonly memberIdForActor: (actorKey: string) => string | null,
  ) {}

  static async create(input: {
    roomId: string
    releaseHash: string
    productRuntimeSessionId: number
    maximumCommittedRolls?: number
    memberIdForActor?: (actorKey: string) => string | null
  }): Promise<BrowserFormalTtrpgRoomAdapterV1> {
    if (!Number.isInteger(input.productRuntimeSessionId) || input.productRuntimeSessionId < 1) {
      fail('domain_configuration', 'productRuntimeSessionId 无效')
    }
    const session = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
    const release = session?.productReleaseId == null ? null : await db.productReleases.get(session.productReleaseId)
    if (!session || session.kind !== 'ttrpg' || !release || release.contentHash !== input.releaseHash) {
      fail('release_mismatch', '在线房间必须绑定未改变的正式 TTRPG ProductRelease')
    }
    const manifest = await verifyProductReleaseManifestV1(release.manifestJson)
    if (manifest.productType !== 'ttrpg' || !manifest.runtimePackage.ttrpg
      || manifest.packageHash !== session.runtimeSourceHash) {
      fail('release_mismatch', '在线房间的正式 TTRPG RuntimePackage 不一致')
    }
    const rulePack = parseRulePackV1(manifest.runtimePackage.ttrpg.rulePack.content)
    const campaign = parseTtrpgCampaignContentV1(manifest.runtimePackage.ttrpg.campaign, rulePack)
    const state = await readProductRuntimeState(session.id!)
    if (!state.ttrpg?.product?.sessionZero.completed) {
      fail('domain_configuration', '创建在线房间前必须完成 Session Zero 与角色编组')
    }
    const dice = await VerifiableOnlineDiceV1.create({
      roomId: input.roomId,
      releaseHash: input.releaseHash,
      maximumRolls: input.maximumCommittedRolls,
    })
    return new BrowserFormalTtrpgRoomAdapterV1(
      session.id!, input.releaseHash, rulePack, campaign, dice, input.memberIdForActor ?? (() => null),
    )
  }

  inspect(): BrowserTtrpgRoomAdapterInspectionV1 {
    return {
      releaseHash: this.releaseHash,
      productRuntimeSessionId: this.productRuntimeSessionId,
      diceCommitments: structuredClone(this.dice.commitments),
    }
  }

  async apply(input: Parameters<OnlineRoomDomainAdapterV1['apply']>[0]): Promise<OnlineRoomDomainEventV1> {
    if (input.releaseHash !== this.releaseHash) fail('release_mismatch', '命令 Release 与房间适配器不一致')
    const payload = record(input.command.payload, `${input.command.kind}.payload`)
    const version = await readProductRuntimeStateVersion(this.productRuntimeSessionId)
    const commandId = `online:${await hashCanonicalValue({
      roomId: input.roomId,
      memberId: input.member.memberId,
      requestId: input.command.requestId,
    })}`
    let visible = publicEvent(input.command.kind, { accepted: true })
    let gmPrivatePayload: unknown = null
    let privatePayloadByMemberId: Record<string, unknown> | undefined
    try {
      if (input.command.kind === 'safety.pause') {
        exact(payload, ['reason'], 'safety.pause.payload')
        const reason = text(payload.reason, 'reason', 2_000)
        await changeTtrpgSafetyStatus({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          status: 'paused', reason, changedBy: input.member.actorKey ?? input.member.memberId,
        })
        visible = publicEvent(input.command.kind, { status: 'paused', reason })
      } else if (input.command.kind === 'safety.resume') {
        exact(payload, [], 'safety.resume.payload')
        await changeTtrpgSafetyStatus({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          status: 'active', changedBy: input.member.memberId,
        })
        visible = publicEvent(input.command.kind, { status: 'active' })
      } else if (input.command.kind === 'scene.open') {
        exact(payload, ['sceneKey'], 'scene.open.payload')
        const sceneKey = key(payload.sceneKey, 'sceneKey')
        await openTtrpgCampaignScene({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey,
        })
        const scene = this.campaign.scenes.find(item => item.sceneKey === sceneKey)!
        visible = publicEvent(input.command.kind, {
          sceneKey, title: scene.title, description: scene.description, locationKey: scene.locationKey,
        })
      } else if (input.command.kind === 'clue.reveal') {
        exact(payload, ['clueKey', 'actorKey', 'visibility'], 'clue.reveal.payload')
        const clueKey = key(payload.clueKey, 'clueKey')
        const actorKey = key(payload.actorKey, 'actorKey')
        const visibility = payload.visibility
        if (visibility !== 'private' && visibility !== 'party') fail('domain_protocol', 'visibility 无效')
        if (input.member.role === 'player' && (input.command.actorKey !== actorKey || visibility !== 'private')) {
          fail('forbidden', '玩家只能为自己的角色发现私密线索')
        }
        await discoverTtrpgClue({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          clueKey, actorKey, visibility,
        })
        const clue = this.campaign.clues.find(item => item.clueKey === clueKey)!
        const disclosed = {
          clueKey, title: clue.title, description: clue.description,
          conclusionKey: clue.conclusionKey, actorKey, visibility,
        }
        if (visibility === 'party') visible = publicEvent(input.command.kind, disclosed)
        else {
          visible = publicEvent(input.command.kind, { visibility: 'private', discovered: true })
          gmPrivatePayload = disclosed
          const targetMemberId = input.member.role === 'player'
            ? input.member.memberId
            : input.members.find(member => member.role === 'player' && member.actorKey === actorKey)?.memberId
              ?? this.memberIdForActor(actorKey)
          if (targetMemberId) privatePayloadByMemberId = { [targetMemberId]: disclosed }
        }
      } else if (input.command.kind === 'rule.action') {
        exact(payload, ['actionKey', 'targetKey', 'difficulty', 'situationalModifier'], 'rule.action.payload')
        const actorKey = input.command.actorKey == null ? '' : key(input.command.actorKey, 'actorKey')
        if (!actorKey) fail('domain_protocol', 'rule.action 必须绑定 actorKey')
        const actionKey = key(payload.actionKey, 'actionKey')
        const targetKey = payload.targetKey == null ? null : key(payload.targetKey, 'targetKey')
        await resolveTtrpgRuleAction({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          actionKey, actorKey, targetKey,
          difficulty: optionalNumber(payload.difficulty, 'difficulty'),
          situationalModifier: optionalNumber(payload.situationalModifier, 'situationalModifier'),
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const history = state.ttrpg?.product?.actionHistory ?? []
        const result = history[history.length - 1]
        if (!result) fail('domain_state', '规则行动没有生成正式结果')
        visible = publicEvent(
          input.command.kind,
          createPublicTtrpgActionEventV1(result),
        )
        gmPrivatePayload = result
        const targetMemberId = input.members.find(
          member => member.role === 'player' && member.actorKey === actorKey,
        )?.memberId ?? this.memberIdForActor(actorKey)
        if (targetMemberId) {
          privatePayloadByMemberId = {
            [targetMemberId]: createPrivateTtrpgActorActionEventV1(result),
          }
        }
      } else if (input.command.kind === 'intent.submit') {
        exact(payload, [
          'intentKey', 'rawInput', 'actionKey', 'targetKey', 'goal', 'method',
          'difficulty', 'situationalModifier', 'rollVisibility',
        ], 'intent.submit.payload')
        const actorKey = input.command.actorKey == null ? '' : key(input.command.actorKey, 'actorKey')
        if (!actorKey) fail('domain_protocol', 'intent.submit 必须绑定 actorKey')
        const actionKey = payload.actionKey == null ? null : key(payload.actionKey, 'actionKey')
        const targetKey = payload.targetKey == null ? null : key(payload.targetKey, 'targetKey')
        const goal = payload.goal == null ? null : text(payload.goal, 'goal', 2_000)
        const method = payload.method == null ? null : text(payload.method, 'method', 2_000)
        const rollVisibility = payload.rollVisibility == null ? undefined : payload.rollVisibility
        if (rollVisibility != null && rollVisibility !== 'public' && rollVisibility !== 'gm-only') {
          fail('domain_protocol', 'rollVisibility 无效')
        }
        const participant = input.member.role === 'gm'
          ? await db.ttrpgSessionParticipants
              .where('sessionId').equals(this.productRuntimeSessionId)
              .filter(row => row.role === 'gm').first()
          : await db.ttrpgSessionParticipants
              .where('sessionId').equals(this.productRuntimeSessionId)
              .filter(row => row.role === 'player' && row.actorKey === actorKey).first()
        if (!participant) fail('domain_state', '在线席位没有对应的正式 TTRPG participant')
        const event = await submitTtrpgActionIntentV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          intentKey: key(payload.intentKey, 'intentKey'),
          actorKey,
          rawInput: text(payload.rawInput, 'rawInput', 10_000),
          actionKey,
          targetKey,
          goal,
          method,
          difficulty: optionalNumber(payload.difficulty, 'difficulty'),
          situationalModifier: optionalNumber(payload.situationalModifier, 'situationalModifier'),
          rollVisibility,
          submittedBy: {
            role: input.member.role === 'gm' ? 'gm' : 'player',
            viewerKey: participant.viewerKey,
          },
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const result = event.type === 'ttrpg.rule.action.resolved'
          ? state.ttrpg?.product?.actionHistory.find(item => item.eventSequence === event.sequence)
          : state.ttrpg?.product?.intentReceipts?.find(item => item.eventSequence === event.sequence)
        if (!result) fail('domain_state', '行动意图没有生成唯一终态回执')
        if ('actionKey' in result) {
          visible = publicEvent(input.command.kind, createPublicTtrpgActionEventV1(result))
        } else {
          visible = publicEvent(input.command.kind, {
            actorKey,
            terminalStatus: result.terminalStatus,
            receiptKey: result.receiptKey,
          })
        }
        gmPrivatePayload = result
        const targetMemberId = input.members.find(
          member => member.role === 'player' && member.actorKey === actorKey,
        )?.memberId ?? this.memberIdForActor(actorKey)
        if (targetMemberId) {
          privatePayloadByMemberId = {
            [targetMemberId]: 'actionKey' in result
              ? createPrivateTtrpgActorActionEventV1(result)
              : result,
          }
        }
      } else if (input.command.kind === 'human.response') {
        const responseCommand = parseOnlineTtrpgHumanResponseCommandV1(payload)
        const actorKey = input.command.actorKey == null ? '' : key(input.command.actorKey, 'actorKey')
        if (!actorKey || input.member.role !== 'player' || input.member.actorKey !== actorKey) {
          fail('forbidden', '真人回应必须来自角色本人的已认证玩家席位')
        }
        const participant = await db.ttrpgSessionParticipants
          .where('sessionId').equals(this.productRuntimeSessionId)
          .filter(row => row.role === 'player' && row.actorKey === actorKey)
          .first()
        if (!participant) fail('domain_state', '在线席位没有对应的正式 TTRPG participant')
        const event = await recordTtrpgHumanResponseV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          actionSequence: responseCommand.actionSequence,
          actionReceiptKey: responseCommand.actionReceiptKey,
          actorKey,
          kind: responseCommand.responseKind,
          text: responseCommand.text,
          audience: responseCommand.audience,
          viewerKey: participant.viewerKey,
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const response = state.ttrpg?.product?.humanResponses?.find(
          item => item.eventSequence === event.sequence,
        )
        if (!response) fail('domain_state', '真人回应没有生成正式回执')
        const routed = createOnlineTtrpgHumanResponseVisiblePayloadsV1({
          response,
          ownerMemberId: input.member.memberId,
        })
        visible = publicEvent(input.command.kind, routed.publicPayload)
        gmPrivatePayload = routed.gmPrivatePayload
        privatePayloadByMemberId = routed.privatePayloadByMemberId
      } else if (input.command.kind === 'item.command') {
        const actorKey = input.member.role === 'gm'
          ? 'gm'
          : input.command.actorKey == null ? '' : key(input.command.actorKey, 'actorKey')
        if (!actorKey) fail('domain_protocol', 'item.command 必须绑定操作者')
        const command = buildOnlineTtrpgItemCommandV1({
          payload,
          commandId,
          eventSequence: version.sequence + 1,
        })
        const event = await commitTtrpgItemCommandV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          command,
          requestedBy: { role: input.member.role === 'gm' ? 'gm' : 'player', actorKey },
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const receipt = state.ttrpg?.product?.itemHistory?.find(
          item => item.eventSequence === event.sequence,
        )
        if (!receipt) fail('domain_state', '物品命令没有生成正式回执')
        const routed = createOnlineTtrpgItemVisiblePayloadsV1({
          receipt,
          members: input.members,
          requesterMemberId: input.member.memberId,
        })
        visible = publicEvent(input.command.kind, routed.publicPayload)
        gmPrivatePayload = routed.gmPrivatePayload
        privatePayloadByMemberId = routed.privatePayloadByMemberId
      } else if (input.command.kind === 'rest.complete') {
        const rest = parseOnlineTtrpgRestCommandV1(payload)
        const event = await completeTtrpgRestV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          restKey: rest.restKey,
          kind: rest.restKind,
          actorKeys: rest.actorKeys,
          reason: rest.reason,
          gmKey: 'gm',
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const receipt = state.ttrpg?.product?.restHistory?.find(
          item => item.eventSequence === event.sequence,
        )
        if (!receipt) fail('domain_state', '休息命令没有生成正式回执')
        visible = publicEvent(input.command.kind, createOnlineTtrpgRestVisiblePayloadV1(receipt))
        gmPrivatePayload = receipt
      } else if (input.command.kind === 'effects.apply') {
        const effectCommand = buildOnlineTtrpgEffectCommandV1({ payload, commandId })
        const event = await commitTtrpgEffectPlanV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          plan: effectCommand.plan,
          actionSequence: effectCommand.actionSequence,
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const entry = state.ttrpg?.product?.effectLedger?.entries.find(
          item => item.eventSequence === event.sequence,
        )
        if (!entry) fail('domain_state', '后果计划没有生成正式效果账本回执')
        const routed = createOnlineTtrpgEffectVisiblePayloadsV1({
          entry,
          members: input.members,
        })
        visible = publicEvent(input.command.kind, routed.publicPayload)
        gmPrivatePayload = routed.gmPrivatePayload
        privatePayloadByMemberId = routed.privatePayloadByMemberId
      } else if (input.command.kind === 'effects.choice.propose') {
        const proposal = buildOnlineTtrpgEffectChoiceProposalCommandV1({ payload, commandId })
        const event = await proposeTtrpgEffectChoiceV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          plan: proposal.plan,
          actionSequence: proposal.actionSequence,
          ownerActorKey: proposal.ownerActorKey,
          gmKey: 'gm',
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const choice = state.ttrpg?.product?.effectLedger?.pendingChoices.find(
          item => item.proposedEventSequence === event.sequence,
        )
        if (!choice) fail('domain_state', '后果选择提议没有进入正式账本')
        const routed = createOnlineTtrpgEffectChoiceVisiblePayloadsV1({ choice, members: input.members })
        visible = publicEvent(input.command.kind, routed.publicPayload)
        gmPrivatePayload = routed.gmPrivatePayload
        privatePayloadByMemberId = routed.privatePayloadByMemberId
      } else if (input.command.kind === 'effects.choice.resolve') {
        const resolution = parseOnlineTtrpgEffectChoiceResolutionCommandV1(payload)
        const actorKey = input.command.actorKey ?? input.member.actorKey
        if (!actorKey) fail('domain_protocol', '后果选择缺少角色身份')
        const event = await resolveTtrpgEffectChoiceV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          choiceKey: resolution.choiceKey,
          selectedEffectKey: resolution.selectedEffectKey,
          requestedBy: { role: input.member.role === 'gm' ? 'gm' : 'player', actorKey },
          gmKey: input.member.role === 'gm' ? 'gm' : undefined,
        })
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const entry = state.ttrpg?.product?.effectLedger?.entries.find(
          item => item.eventSequence === event.sequence,
        )
        if (!entry) fail('domain_state', '玩家后果选择没有生成正式效果账本回执')
        const routed = createOnlineTtrpgEffectVisiblePayloadsV1({ entry, members: input.members })
        visible = publicEvent(input.command.kind, routed.publicPayload)
        gmPrivatePayload = routed.gmPrivatePayload
        privatePayloadByMemberId = routed.privatePayloadByMemberId
      } else if (input.command.kind === 'campaign.session.start') {
        const start = parseOnlineTtrpgCampaignSessionStartV1(payload)
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const campaignState = state.ttrpg?.campaign
        if (!campaignState) fail('domain_state', '正式战役缺少长期连续性状态')
        const participantKeys = campaignState.roster
          .filter(entry => entry.status === 'active')
          .map(entry => entry.characterKey)
        const ordinal = campaignState.playSessions.length + 1
        const sessionKey = `session.${ordinal}`
        await startTtrpgCampaignSessionV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          sessionKey,
          title: start.title,
          participantKeys,
          gmKey: 'gm',
        })
        visible = publicEvent(input.command.kind, {
          sessionKey, ordinal, title: start.title, participantKeys, status: 'active',
        })
        gmPrivatePayload = { sessionKey, ordinal, title: start.title, participantKeys }
      } else if (input.command.kind === 'campaign.session.complete') {
        const completion = parseOnlineTtrpgCampaignSessionCompleteV1(payload)
        const state = await readProductRuntimeState(this.productRuntimeSessionId)
        const campaignState = state.ttrpg?.campaign
        const sessionKey = campaignState?.activeSessionKey
        const playSession = campaignState?.playSessions.find(item => item.sessionKey === sessionKey)
        if (!sessionKey || !playSession) fail('domain_rejected', '当前没有可完成的长期战役分场')
        if (
          completion.memoryAudience.startsWith('actor:') &&
          !playSession.participantKeys.includes(completion.memoryAudience.slice('actor:'.length))
        ) fail('domain_protocol', '跨场私人记忆必须属于本场参与角色')
        const automatic = createTtrpgAutomaticSessionRecapsV2({
          state,
          campaign: this.campaign,
          rulePack: this.rulePack,
          sessionKey,
          participantKeys: playSession.participantKeys,
        })
        const summary = completion.publicNote
          ? `${automatic.publicSummary}\n主持公开补充：${completion.publicNote}`.slice(0, 20_000)
          : automatic.publicSummary
        await completeTtrpgCampaignSessionV2({
          sessionId: this.productRuntimeSessionId,
          commandId,
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          sessionKey,
          summary,
          memories: [
            ...automatic.memories,
            ...(completion.memorySummary ? [{
              memoryKey: `memory.${sessionKey}.online.${version.sequence + 1}`,
              subjectKey: completion.memoryAudience.startsWith('actor:')
                ? completion.memoryAudience.slice('actor:'.length)
                : state.ttrpg!.product!.campaignKey,
              summary: completion.memorySummary,
              audience: completion.memoryAudience,
            }] : []),
          ],
          gmKey: 'gm',
        })
        visible = publicEvent(input.command.kind, {
          sessionKey, status: 'completed', summary,
        })
        gmPrivatePayload = {
          sessionKey, status: 'completed', summary,
          gmSummary: automatic.gmSummary,
          privateMemory: completion.memorySummary || null,
          privateMemoryAudience: completion.memorySummary ? completion.memoryAudience : null,
        }
      } else if (input.command.kind === 'ai.player.run') {
        fail(
          'domain_configuration',
          '浏览器本地主机没有部署级 AI 玩家执行器；请使用已配置模型服务的权威托管房间',
        )
      } else if (input.command.kind === 'ai.gm.act') {
        fail(
          'domain_configuration',
          '浏览器本地主机没有部署级 AI GM NPC 行动执行器；请使用已配置模型服务的权威托管房间',
        )
      } else if (input.command.kind === 'ai.gm.narrate') {
        fail(
          'domain_configuration',
          '浏览器本地主机没有部署级 AI GM 执行器；请使用已配置模型服务的权威托管房间',
        )
      } else if (input.command.kind === 'gm.narrate') {
        exact(payload, ['actionSequence', 'text'], 'gm.narrate.payload')
        if (!Number.isInteger(payload.actionSequence) || Number(payload.actionSequence) < 1) {
          fail('domain_protocol', 'actionSequence 无效')
        }
        const narration = text(payload.text, 'text', 20_000)
        await commitTtrpgHumanGmNarrationV1({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          actionSequence: Number(payload.actionSequence), text: narration, gmKey: input.member.memberId,
        })
        visible = publicEvent(input.command.kind, {
          actionSequence: payload.actionSequence, text: narration, source: 'human-gm',
        })
      } else if (input.command.kind === 'ending.choose') {
        exact(payload, ['endingKey'], 'ending.choose.payload')
        const endingKey = key(payload.endingKey, 'endingKey')
        await completeTtrpgCampaignEnding({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          endingKey, completedBy: input.member.memberId,
        })
        const ending = this.campaign.endings.find(item => item.endingKey === endingKey)!
        visible = publicEvent(input.command.kind, { endingKey, title: ending.title, epilogue: ending.epilogue })
      } else if (input.command.kind === 'chat.message') {
        exact(payload, ['text'], 'chat.message.payload')
        const message = text(payload.text, 'text', 4_000)
        const entry: TtrpgRoomChatEntryV1 = {
          sequence: input.sequence, memberId: input.member.memberId,
          displayName: input.member.displayName, role: input.member.role,
          actorKey: input.member.actorKey, text: message,
        }
        this.chat.push(entry)
        if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500)
        visible = publicEvent(input.command.kind, entry)
      } else if (input.command.kind === 'dice.request') {
        exact(payload, ['expression'], 'dice.request.payload')
        const receipt = await this.dice.roll(text(payload.expression, 'expression', 32))
        visible = publicEvent(input.command.kind, {
          actorKey: input.command.actorKey, requestedBy: input.member.memberId, receipt,
        })
      } else if (input.command.kind === 'tabletop.move') {
        exact(payload, ['tokenKey', 'x', 'y'], 'tabletop.move.payload')
        await updateTtrpgTabletopV1({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          role: input.member.role === 'gm' ? 'gm' : 'player',
          actorKey: input.command.actorKey ?? input.member.memberId,
          operation: {
            kind: 'move-token', tokenKey: key(payload.tokenKey, 'tokenKey'),
            x: optionalNumber(payload.x, 'x')!, y: optionalNumber(payload.y, 'y')!,
          },
        })
        visible = publicEvent(input.command.kind, { tabletopUpdated: true })
      } else if (input.command.kind === 'tabletop.fog') {
        exact(payload, ['fogKey', 'revealed'], 'tabletop.fog.payload')
        await updateTtrpgTabletopV1({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          role: 'gm', actorKey: input.member.memberId,
          operation: { kind: 'set-fog', fogKey: key(payload.fogKey, 'fogKey'), revealed: boolean(payload.revealed, 'revealed') },
        })
        visible = publicEvent(input.command.kind, { tabletopUpdated: true })
      } else if (input.command.kind === 'tabletop.layer') {
        exact(payload, ['layerKey', 'visible'], 'tabletop.layer.payload')
        await updateTtrpgTabletopV1({
          sessionId: this.productRuntimeSessionId, commandId,
          baseSequence: version.sequence, baseStateHash: version.stateHash,
          role: 'gm', actorKey: input.member.memberId,
          operation: { kind: 'set-layer', layerKey: key(payload.layerKey, 'layerKey'), visible: boolean(payload.visible, 'visible') },
        })
        visible = publicEvent(input.command.kind, { tabletopUpdated: true })
      }
    } catch (error) {
      if (error instanceof OnlineRoomAuthorityError) throw error
      fail('domain_rejected', error instanceof Error ? error.message : '正式 TTRPG 命令被拒绝')
    }
    const state = await readProductRuntimeState(this.productRuntimeSessionId)
    const resultingStateHash = await hashCanonicalValue({
      releaseHash: this.releaseHash,
      roomSequence: input.sequence,
      productRuntimeState: state,
      chat: this.chat,
      diceNextRollIndex: this.dice.exportServerCheckpoint().nextRollIndex,
    })
    return {
      ...visible,
      gmPrivatePayload,
      privatePayloadByMemberId,
      resultingStateHash,
    }
  }

  async project(input: Parameters<OnlineRoomDomainAdapterV1['project']>[0]): Promise<unknown> {
    if (input.releaseHash !== this.releaseHash) fail('release_mismatch', '投影 Release 与房间适配器不一致')
    const state = await readProductRuntimeState(this.productRuntimeSessionId)
    const participants = await db.ttrpgSessionParticipants
      .where('sessionId').equals(this.productRuntimeSessionId).toArray()
    return {
      schema: 'storyforge.online-ttrpg-projection',
      version: 1,
      roomSequence: input.sequence,
      campaign: createTtrpgViewerProjectionV1({
        state,
        campaign: this.campaign,
        rulePack: this.rulePack,
        role: input.member.role,
        actorKey: input.member.actorKey,
        participantControllers: Object.fromEntries(
          participants.flatMap(participant =>
            participant.role === 'player' && participant.actorKey
              ? [[participant.actorKey, participant.controller]]
              : [],
          ),
        ),
      }),
      recentChat: structuredClone(this.chat.slice(-100)),
      diceCommitments: structuredClone(this.dice.commitments),
    }
  }
}
