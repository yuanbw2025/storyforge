import { useMemo, useSyncExternalStore } from 'react'
import { Accessibility, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import {
  createTextOpenWorldPlayerPreferencesStoreV1,
  TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1,
} from '../../lib/open-world/player-preferences'

export interface TextOpenWorldPlayerPreferencesPanelProps {
  productionKey: string
  audioAvailable: boolean
}

export default function TextOpenWorldPlayerPreferencesPanel(
  props: TextOpenWorldPlayerPreferencesPanelProps,
) {
  const preferencesStore = useMemo(
    () => createTextOpenWorldPlayerPreferencesStoreV1({ productionKey: props.productionKey }),
    [props.productionKey],
  )
  const preferences = useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getSnapshot,
    preferencesStore.getServerSnapshot,
  )

  return <section
    className="open-world-save-settings-preferences"
    data-testid="text-open-world-player-preferences"
    aria-labelledby="text-open-world-preferences-heading"
  >
    <header>
      <span><Accessibility aria-hidden="true" /><strong id="text-open-world-preferences-heading">阅读与声音</strong></span>
      <button type="button" onClick={() => preferencesStore.reset()}>
        <RotateCcw aria-hidden="true" />恢复默认
      </button>
    </header>

    <div className="open-world-save-settings-fields">
      <label>
        <span>叙事正文字号 <output>{preferences.fontSizePx}px</output></span>
        <input
          type="range"
          min={TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.fontSizePx.minimum}
          max={TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.fontSizePx.maximum}
          step={1}
          value={preferences.fontSizePx}
          onChange={event => preferencesStore.write({ fontSizePx: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>叙事正文行距 <output>{preferences.lineHeight.toFixed(2)}</output></span>
        <input
          type="range"
          min={TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.lineHeight.minimum}
          max={TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.lineHeight.maximum}
          step={0.05}
          value={preferences.lineHeight}
          onChange={event => preferencesStore.write({ lineHeight: Number(event.currentTarget.value) })}
        />
      </label>
      <label className="open-world-save-settings-toggle">
        <input
          type="checkbox"
          checked={preferences.highContrast}
          onChange={event => preferencesStore.write({ highContrast: event.currentTarget.checked })}
        />
        <span>高对比度</span>
      </label>
      <label className="open-world-save-settings-toggle">
        <input
          type="checkbox"
          checked={preferences.reducedMotion}
          onChange={event => preferencesStore.write({ reducedMotion: event.currentTarget.checked })}
        />
        <span>减少动画</span>
      </label>
      <label className="open-world-save-settings-toggle">
        <input
          type="checkbox"
          checked={preferences.muted}
          onChange={event => preferencesStore.write({ muted: event.currentTarget.checked })}
        />
        <span>{preferences.muted
          ? <><VolumeX aria-hidden="true" />已静音</>
          : <><Volume2 aria-hidden="true" />声音开启</>}</span>
      </label>
      <label>
        <span>音量 <output>{Math.round(preferences.volume * 100)}%</output></span>
        <input
          type="range"
          min={TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.volume.minimum}
          max={TEXT_OPEN_WORLD_PLAYER_PREFERENCE_LIMITS_V1.volume.maximum}
          step={0.05}
          value={preferences.volume}
          disabled={preferences.muted}
          onChange={event => preferencesStore.write({ volume: Number(event.currentTarget.value) })}
        />
      </label>
    </div>

    <div className="open-world-save-settings-disclosure">
      <p><strong>难度：</strong>标准（由当前 Release 冻结，首版不提供难度切换）</p>
      <p><strong>运行方式：</strong>确定性规则无需模型即可完整游玩；模型凭证仍只在全局 AI 设置中管理。</p>
      <p>{props.audioAvailable
        ? '当前 Release 含音频槽；静音和音量只改变本机播放，不写入存档。'
        : '当前播放器尚未接入音频播放；静音和音量偏好会保留给同一作品的后续版本。'}</p>
      <small>以上偏好只保存在此浏览器，并按作品隔离；不会进入世界、存档、提示词、导出或 API 凭证。</small>
    </div>
  </section>
}
