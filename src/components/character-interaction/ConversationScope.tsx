import type {CharacterInteractionRuntimeState} from '../../lib/types'

export function chatAudienceLabel(keys: string[] | null | undefined, interaction: CharacterInteractionRuntimeState): string {
  return keys == null ? '所有在场角色' : keys.filter(key => key !== interaction.playerKey)
    .map(key => interaction.profiles.find(p => p.participantKey === key)?.name ?? key).join('、')
}

export default function ConversationScope(props: {
  interaction: CharacterInteractionRuntimeState
  audienceKeys?: string[] | null
  disabled: boolean
  presenceDisabled: boolean
  onAudienceChange: (keys: string[] | null) => void
  onPresenceChange: (key: string, present: boolean) => void
}) {
  const {interaction, audienceKeys} = props
  const active = interaction.activeScene?.activeParticipantKeys ?? []
  const unavailable = audienceKeys?.some(key => !active.includes(key))
  return <div className="mb-2 space-y-2 text-xs" data-testid="chat-conversation-scope">
    <div className="flex flex-wrap items-center justify-between gap-2"><label className="chat-audience-choice">对话范围
      <select aria-label="对话范围" value={audienceKeys == null ? '' : JSON.stringify(audienceKeys)} disabled={props.disabled}
        onChange={event => props.onAudienceChange(event.target.value ? JSON.parse(event.target.value) : null)}
        className="ml-2 max-w-full rounded border border-border bg-bg-base p-2">
        <option value="">所有在场角色</option>
        {interaction.profiles.map(profile => <option key={profile.participantKey} value={JSON.stringify([profile.participantKey])}>与 {profile.name} 私聊{active.includes(profile.participantKey) ? '' : '（已离场）'}</option>)}
        {audienceKeys && audienceKeys.length !== 1 && <option value={JSON.stringify(audienceKeys)}>指定：{chatAudienceLabel(audienceKeys, interaction)}</option>}
      </select></label>
      <details><summary className="cursor-pointer py-2 text-text-muted">在场角色</summary><div className="mt-2 space-y-2">
        <p className="text-text-muted">调整谁参与当前对话；回归不会补听离场时的消息。</p>
        {interaction.profiles.map(profile => <div key={profile.participantKey} className="flex items-center justify-between gap-3">
          <span>{profile.name} · {active.includes(profile.participantKey) ? '在场' : '离场'}</span>
          <button type="button" disabled={props.presenceDisabled} onClick={() => props.onPresenceChange(profile.participantKey, !active.includes(profile.participantKey))}
            className="rounded border border-border px-3 py-2 disabled:opacity-40">{active.includes(profile.participantKey) ? `让 ${profile.name} 离场` : `让 ${profile.name} 回归`}</button>
        </div>)}
      </div></details>
    </div>
    {audienceKeys != null && <p className="text-text-muted">与 {chatAudienceLabel(audienceKeys, interaction)} 私聊；新回复、继续和新情境沿用此范围。切回公开不会公开旧私聊。</p>}
    {unavailable && <p role="status" className="text-warning">收件人已离场。草稿仍按原私聊保存；等其回归，或明确更换对话范围后再发送。</p>}
    {!active.length && <p role="status" className="text-text-muted">当前无人参与对话，可让角色回归后继续。</p>}
  </div>
}
