import { useCompanionStore } from '../../stores/companion'
import type { VoicePhase } from '../../lib/longform-voice/session'

export const COMPANION_POSES = {
  idle: { position: '0% 0%', label: '陪你构思' },
  listening: { position: '50% 0%', label: '正在倾听' },
  thinking: { position: '100% 0%', label: '正在思考' },
  speaking: { position: '0% 100%', label: '正在朗读' },
  ready: { position: '50% 100%', label: '候选待你确认' },
  error: { position: '100% 100%', label: '需要处理' },
} as const
export type CompanionPose = keyof typeof COMPANION_POSES
export function companionPose(phase: VoicePhase, busy: boolean, pending: boolean, error: boolean): CompanionPose {
  if (phase === 'listening' || phase === 'requesting') return 'listening'
  if (phase === 'speaking') return 'speaking'
  if (busy || phase === 'transcribing' || phase === 'preparing') return 'thinking'
  if (error) return 'error'
  return pending ? 'ready' : 'idle'
}
export default function CompanionPortrait({ pose, compact = false }: { pose: CompanionPose; compact?: boolean }) {
  const portrait = useCompanionStore((state) => state.preferences.portrait)
  const visible = useCompanionStore((state) => state.preferences.visible)
  if (!visible) return null
  return (
    <span
      role="img" aria-label={'墨灵 · ' + COMPANION_POSES[pose].label}
      className={`companion-portrait ${compact ? 'companion-portrait-compact' : ''} ${portrait ? 'companion-portrait-custom' : ''}`}
      data-pose={pose}
      style={{
        backgroundImage: `url("${portrait || import.meta.env.BASE_URL + 'companion/moling-atlas.png'}")`,
        backgroundPosition: portrait ? 'center' : COMPANION_POSES[pose].position,
      }}
    />
  )
}
