import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, RotateCcw, Trash2, Wand2, X } from 'lucide-react'
import {
  parseCharacterSupplementCandidateDraftV1,
  serializeCharacterSupplementCandidateV1,
  type CharacterSupplementCandidateV1,
} from '../../lib/agent/character-supplement-copilot'
import {
  CHARACTER_DIMENSIONS,
  filledDimensions,
  type CharacterDimensionKey,
} from '../../lib/character/character-dimensions'
import type { Character, Project } from '../../lib/types'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import { CTextarea } from '../shared/CompositionInput'
import CharacterDimensionPicker from './CharacterDimensionPicker'

interface Props {
  character: Character
  project: Project
  worldGroupId?: number | null
  onDone?: () => void
  compact?: boolean
}

function initialDimensions(character: Character): Set<CharacterDimensionKey> {
  const filled = new Set(filledDimensions(character))
  const empty = CHARACTER_DIMENSIONS.map(dimension => dimension.key).filter(key => !filled.has(key))
  return new Set(empty.length ? empty : CHARACTER_DIMENSIONS.map(dimension => dimension.key))
}

export default function CharacterSupplementAction({
  character,
  project,
  worldGroupId,
  onDone,
  compact,
}: Props) {
  const [open, setOpen] = useState(false)
  const empties = CHARACTER_DIMENSIONS
    .map(dimension => dimension.key)
    .filter(key => !new Set(filledDimensions(character)).has(key)).length

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(value => !value)}
        className={compact
          ? 'p-1 text-text-muted hover:text-accent flex-shrink-0'
          : 'flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent border border-border rounded hover:border-accent/50 transition-colors'}
        title={`AI 补全设定${empties ? `（缺 ${empties} 项）` : ''}`}
      >
        <Wand2 className="w-4 h-4" />
        {!compact && <span>AI 补全设定{empties > 0 && <span className="text-accent ml-0.5">·缺{empties}</span>}</span>}
      </button>

      {open && (
        <CharacterSupplementDialog
          character={character}
          project={project}
          worldGroupId={worldGroupId ?? null}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </div>
  )
}

function CharacterSupplementDialog({
  character,
  project,
  worldGroupId,
  onClose,
  onDone,
}: {
  character: Character
  project: Project
  worldGroupId: number | null
  onClose: () => void
  onDone?: () => void
}) {
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [selected, setSelected] = useState<Set<CharacterDimensionKey>>(() => initialDimensions(character))
  const [useEvidence, setUseEvidence] = useState(false)
  const candidate = copilot.pendingCandidates.find(item => (
    item.payload.skillId === 'character.supplement'
    && item.payload.characterSupplementRequest?.characterId === character.id
  ))
  const hasOtherPendingCandidate = copilot.pendingCandidates.some(item => item !== candidate)
  const parsedCandidate = useMemo(() => parseCandidate(candidate), [candidate])

  useEffect(() => {
    const request = candidate?.payload.characterSupplementRequest
    if (!request) return
    setSelected(new Set(request.dimensions))
    setUseEvidence(request.useEvidence)
  }, [candidate])

  const run = async () => {
    if (character.id == null || selected.size === 0) return
    const dimensions = CHARACTER_DIMENSIONS
      .map(dimension => dimension.key)
      .filter(key => selected.has(key))
    await copilot.submitTargetedRequest(
      `补全角色“${character.name || '未命名'}”的 ${dimensions.length} 个选中字段。只生成候选，等待作者确认后写入。`,
      {
        id: `character-supplement-${character.id}`,
        agentId: 'character',
        skillId: 'character.supplement',
        instruction: `严格依据当前角色与正式设定补全“${character.name || '未命名'}”的选中字段。`,
        characterSupplementRequest: {
          characterId: character.id,
          dimensions,
          useEvidence,
        },
      },
    )
  }

  const updateField = async (key: CharacterDimensionKey, value: string) => {
    if (!candidate || !parsedCandidate || !candidate.payload.characterSupplementRequest) return
    const next: CharacterSupplementCandidateV1 = {
      version: 1,
      patch: { ...parsedCandidate.patch, [key]: value },
    }
    await copilot.updateCandidate(
      candidate.event.id!,
      serializeCharacterSupplementCandidateV1(next, candidate.payload.characterSupplementRequest),
    )
  }

  const adoptCandidate = async () => {
    if (!candidate) return
    const adopted = await copilot.adoptCandidate(candidate)
    if (!adopted) return
    onDone?.()
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full right-0 mt-1 z-50 bg-bg-surface border border-border rounded-lg shadow-lg p-3 w-[min(520px,calc(100vw-2rem))] max-h-[min(720px,calc(100vh-4rem))] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-text-primary">
            AI 补全设定 · <span className="text-text-secondary">{character.name || '未命名'}</span>
          </div>
          <button onClick={onClose} className="p-0.5 text-text-muted hover:text-text-primary" aria-label="关闭角色补全">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!candidate && (
          <>
            <p className="text-[11px] text-text-muted mb-2">
              勾选要补全的维度。结果会先成为可编辑候选，确认后才写入角色。
            </p>
            <CharacterDimensionPicker selected={selected} onChange={setSelected} />
            <label className="mt-2 flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useEvidence}
                onChange={event => setUseEvidence(event.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span className="text-[11px] text-text-secondary leading-snug">
                结合剧情已写内容
                <span className="block text-text-muted">读取该角色已确认的剧情事实与正文表现。</span>
              </span>
            </label>
          </>
        )}

        {copilot.error && (
          <div className="mt-2 rounded border border-error/30 bg-error/5 px-2 py-1.5 text-xs text-error">
            {copilot.error}
          </div>
        )}

        {hasOtherPendingCandidate && !candidate && (
          <div className="mt-2 rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-xs text-text-secondary">
            当前世界还有待确认候选，请先处理后再生成。
          </div>
        )}

        {candidate && parsedCandidate && candidate.payload.characterSupplementRequest && (
          <section className="mt-3 space-y-3" aria-label="角色补全候选">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-primary">待确认候选</span>
              <span className="text-[11px] text-text-muted">
                {candidate.payload.contextEvidence
                  ? `约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
                  : `${candidate.payload.contextSources.length} 个来源`}
              </span>
            </div>
            {candidate.payload.characterSupplementRequest.dimensions.map(key => {
              const dimension = CHARACTER_DIMENSIONS.find(item => item.key === key)!
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-text-secondary">{dimension.label}</span>
                  <CTextarea
                    aria-label={`补全候选-${dimension.label}`}
                    value={parsedCandidate.patch[key] ?? ''}
                    disabled={copilot.busy}
                    rows={Math.max(2, dimension.rows)}
                    onChange={event => { void updateField(key, event.target.value) }}
                    className="w-full resize-y text-xs leading-5"
                  />
                </label>
              )
            })}
            {candidate.payload.contextEvidence && (
              <details className="border border-border/60 bg-bg-base px-3 py-2 text-[11px] text-text-muted rounded">
                <summary className="cursor-pointer text-text-secondary">本次实际输入证据</summary>
                <p className="mt-2 break-words">已纳入：{candidate.payload.contextEvidence.included.join('、') || '无'}</p>
                {candidate.payload.contextEvidence.trimmed.length > 0 && (
                  <p className="mt-1 text-warning">因预算移除：{candidate.payload.contextEvidence.trimmed.join('、')}</p>
                )}
              </details>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={copilot.busy}
                onClick={() => { void copilot.rejectCandidate(candidate) }}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> 拒绝
              </button>
              <button
                type="button"
                disabled={copilot.busy}
                onClick={() => { void adoptCandidate() }}
                className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
              >
                {copilot.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                确认写入
              </button>
            </div>
          </section>
        )}

        {candidate && !parsedCandidate && (
          <div className="mt-3 rounded border border-error/30 bg-error/5 px-2 py-2 text-xs text-error">
            候选结构已损坏，不能写入正式角色。请拒绝后重新生成。
          </div>
        )}

        {!candidate && (
          <div className="mt-3 flex gap-2">
            {copilot.recoveryAvailable && (
              <button
                type="button"
                onClick={() => { void copilot.resume() }}
                disabled={copilot.loading || copilot.busy}
                className="flex items-center justify-center gap-1.5 px-3 py-2 border border-border text-text-secondary text-sm rounded disabled:opacity-40 hover:text-accent"
              >
                <RotateCcw className="w-4 h-4" /> 恢复
              </button>
            )}
            <button
              onClick={() => { void run() }}
              disabled={copilot.loading || copilot.busy || selected.size === 0 || hasOtherPendingCandidate}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded disabled:opacity-40 hover:bg-accent-hover"
            >
              {copilot.busy
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 补全中…</>
                : <><Wand2 className="w-4 h-4" /> 生成 {selected.size} 个字段候选</>}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function parseCandidate(candidate?: PendingMasterCandidate): CharacterSupplementCandidateV1 | null {
  if (!candidate?.payload.characterSupplementRequest) return null
  try {
    return parseCharacterSupplementCandidateDraftV1(
      candidate.event.content,
      candidate.payload.characterSupplementRequest,
    )
  } catch {
    return null
  }
}
