import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  History,
  Loader2,
  RefreshCcw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import type {
  TextOpenWorldPlayerCheckpointV1,
  TextOpenWorldPlayerSaveBranchV1,
  TextOpenWorldPlayerSaveSummaryV1,
  TextOpenWorldPlayerSavesProjectionV1,
} from '../../lib/open-world/player-saves'
import type {
  TextOpenWorldPlayerReleaseVersionV1,
  TextOpenWorldPlayerVersionCompatibilityProjectionV1,
} from '../../lib/open-world/player-version-compatibility'
import type { TextOpenWorldSaveMigrationPreviewV1 } from '../../lib/open-world/player-save-migration'
import TextOpenWorldPlayerPreferencesPanel from './TextOpenWorldPlayerPreferencesPanel'

type SaveSettingsTab = 'saves' | 'branches' | 'versions' | 'settings'

export interface TextOpenWorldSaveSettingsPanelProps {
  sessionKey: number | string
  productionKey: string
  /** Build Preview is disposable and cannot promise a resumable player save. */
  formalSaveAvailable: boolean
  audioAvailable: boolean
  saves: TextOpenWorldPlayerSavesProjectionV1
  versions: TextOpenWorldPlayerVersionCompatibilityProjectionV1 | null
  busy: boolean
  error?: string
  onCreateManualSave(name: string): Promise<unknown>
  onForkCurrent(title: string): Promise<unknown>
  onForkCheckpoint(checkpointId: number, title: string): Promise<unknown>
  onSelectBranch(sessionId: number): Promise<unknown>
  onDeleteCheckpoint(checkpointId: number): Promise<unknown>
  onDeleteBranch(sessionId: number): Promise<unknown>
  onRepairCheckpoint(checkpointId: number): Promise<unknown>
  onRepairRuntimeHead(sessionId: number): Promise<unknown>
  onPreviewReleaseMigration?(targetProductReleaseId: number): Promise<TextOpenWorldSaveMigrationPreviewV1>
  onMigrateRelease?(targetProductReleaseId: number, expectedPreviewHash: string): Promise<unknown>
  onRefresh(): Promise<unknown>
}

interface ConfirmationRequest {
  title: string
  detail: string
  confirmLabel: string
  danger: boolean
  run(): Promise<unknown>
  onSuccess?(): void
}

const CONFIRMATION_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function confirmationFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(CONFIRMATION_FOCUSABLE_SELECTOR))
    .filter(element => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true')
}

const PURPOSE_ORDER: ReadonlyArray<TextOpenWorldPlayerCheckpointV1['purpose']> = [
  'manual', 'autosave', 'combat-retry', 'milestone', 'system', 'invalid',
]

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp < 0) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(timestamp))
}

function Summary({ value }: { value: TextOpenWorldPlayerSaveSummaryV1 | null }) {
  if (!value) return <p className="open-world-save-summary is-unavailable">摘要不可安全读取。</p>
  return <dl className="open-world-save-summary">
    {value.level != null && <div><dt>等级</dt><dd>{value.level}</dd></div>}
    {value.regionLabel && <div><dt>地区</dt><dd>{value.regionLabel}</dd></div>}
    {value.locationLabel && <div><dt>地点</dt><dd>{value.locationLabel}</dd></div>}
    <div><dt>主线</dt><dd>{value.mainlineLabel}</dd></div>
    <div><dt>时间</dt><dd>{value.worldTimeLabel}</dd></div>
  </dl>
}

function versionStatus(version: TextOpenWorldPlayerReleaseVersionV1): string {
  if (version.relationToPinned === 'pinned') return '当前存档固定版本'
  if (version.relationToPinned === 'older') return '更早的可用版本'
  return version.canMigratePinnedSession
    ? '直接兼容子版本 · 可预演迁移'
    : version.declaredCompatibleWithPinnedRelease
      ? '存在兼容声明，但不能从当前版本直接迁移'
    : '未声明与当前存档兼容'
}

export default function TextOpenWorldSaveSettingsPanel(
  props: TextOpenWorldSaveSettingsPanelProps,
) {
  const [tab, setTab] = useState<SaveSettingsTab>(props.formalSaveAvailable ? 'saves' : 'versions')
  const [saveName, setSaveName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [operationPending, setOperationPending] = useState(false)
  const [localError, setLocalError] = useState('')
  const operationRevisionRef = useRef(0)
  const panelRef = useRef<HTMLElement | null>(null)
  const confirmationRef = useRef<HTMLElement | null>(null)
  const confirmationCancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)
  const restoreConfirmationFocusRef = useRef(false)
  const confirmationOpen = confirmation != null

  useEffect(() => {
    operationRevisionRef.current += 1
    setTab(props.formalSaveAvailable ? 'saves' : 'versions')
    setSaveName('')
    setBranchTitle('')
    setConfirmation(null)
    restoreConfirmationFocusRef.current = false
    confirmationReturnFocusRef.current = null
    setOperationPending(false)
    setLocalError('')
  }, [props.formalSaveAvailable, props.sessionKey])

  useEffect(() => {
    if (!confirmationOpen || typeof document === 'undefined') return
    const panel = panelRef.current
    const background = panel?.closest<HTMLElement>('[data-testid="text-open-world-shell"]') ?? panel
    const backgroundHadInert = background?.hasAttribute('inert') ?? false
    const backgroundAriaHidden = background?.getAttribute('aria-hidden') ?? null
    const cancel = confirmationCancelRef.current
    if (cancel && !cancel.disabled) cancel.focus()
    else confirmationRef.current?.focus()
    background?.setAttribute('inert', '')
    background?.setAttribute('aria-hidden', 'true')
    return () => {
      if (background) {
        if (!backgroundHadInert) background.removeAttribute('inert')
        if (backgroundAriaHidden == null) background.removeAttribute('aria-hidden')
        else background.setAttribute('aria-hidden', backgroundAriaHidden)
      }
      if (!restoreConfirmationFocusRef.current) return
      const target = confirmationReturnFocusRef.current
      restoreConfirmationFocusRef.current = false
      confirmationReturnFocusRef.current = null
      queueMicrotask(() => {
        if (target?.isConnected) target.focus()
      })
    }
  }, [confirmationOpen])

  const allBranches = useMemo(
    () => props.saves.groups.flatMap(group => group.branches.map(branch => ({ group, branch }))),
    [props.saves.groups],
  )
  const currentEntry = allBranches.find(entry => entry.branch.isCurrent) ?? null
  const currentBranch = currentEntry?.branch ?? null
  const disabled = props.busy || operationPending
  const visibleError = props.error || localError

  const execute = async (operation: () => Promise<unknown>, onSuccess?: () => void) => {
    const revision = operationRevisionRef.current + 1
    operationRevisionRef.current = revision
    setOperationPending(true)
    setLocalError('')
    try {
      await operation()
      if (operationRevisionRef.current === revision) onSuccess?.()
    }
    catch {
      if (operationRevisionRef.current === revision) {
        setLocalError('操作未能完成，请确认当前状态后重试。')
      }
    }
    finally {
      if (operationRevisionRef.current === revision) setOperationPending(false)
    }
  }
  const requestConfirmation = (request: ConfirmationRequest) => {
    if (disabled) return
    restoreConfirmationFocusRef.current = false
    confirmationReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setConfirmation(request)
  }
  const closeConfirmation = () => {
    restoreConfirmationFocusRef.current = true
    setConfirmation(null)
  }
  const confirmRequestedOperation = async () => {
    const request = confirmation
    if (!request || disabled) return
    restoreConfirmationFocusRef.current = false
    confirmationReturnFocusRef.current = null
    setConfirmation(null)
    await execute(request.run, request.onSuccess)
  }
  const handleConfirmationKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeConfirmation()
      return
    }
    if (event.key !== 'Tab') return
    const elements = confirmationFocusableElements(event.currentTarget)
    if (!elements.length) {
      event.preventDefault()
      event.currentTarget.focus()
      return
    }
    const first = elements[0]!
    const last = elements[elements.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  const tabs: ReadonlyArray<{ key: SaveSettingsTab; label: string; count?: number; disabled?: boolean }> = [
    { key: 'saves', label: '存档', count: props.formalSaveAvailable ? currentBranch?.checkpoints.length ?? 0 : undefined, disabled: !props.formalSaveAvailable },
    { key: 'branches', label: '分支', count: props.formalSaveAvailable ? props.saves.totalBranches : undefined, disabled: !props.formalSaveAvailable },
    { key: 'versions', label: '版本' },
    { key: 'settings', label: '设置' },
  ]

  return <section
    ref={panelRef}
    className="open-world-save-settings"
    data-testid="text-open-world-save-settings"
    data-open-world-ui-key="system.save-branches system.settings-help"
    aria-labelledby="text-open-world-save-settings-heading"
  >
    <header className="open-world-save-settings-heading">
      <span><Save aria-hidden="true" /><strong id="text-open-world-save-settings-heading">存档、分支与设置</strong></span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void execute(props.onRefresh)}
      >{disabled ? <Loader2 className="is-spinning" aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}刷新</button>
    </header>

    <nav className="open-world-save-settings-tabs" aria-label="存档与设置分类">
      {tabs.map(item => <button
        key={item.key}
        type="button"
        disabled={item.disabled}
        aria-current={tab === item.key ? 'page' : undefined}
        onClick={() => setTab(item.key)}
      >{item.label}{item.count != null && <span>{item.count}</span>}</button>)}
    </nav>

    {visibleError && <p className="open-world-save-settings-error" role="alert">{visibleError}</p>}

    {confirmation && typeof document !== 'undefined' && createPortal(<div
      data-testid="text-open-world-save-confirmation-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        overflowY: 'auto',
        padding: 16,
        background: 'rgba(0, 0, 0, 0.72)',
      }}
    >
      <section
        ref={confirmationRef}
        className={`open-world-save-settings open-world-save-settings-confirmation${confirmation.danger ? ' is-danger' : ''}`}
        style={{ width: 'min(100%, 34rem)', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="text-open-world-save-confirmation-title"
        aria-describedby="text-open-world-save-confirmation-detail"
        tabIndex={-1}
        onKeyDown={handleConfirmationKeyDown}
      >
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong id="text-open-world-save-confirmation-title">{confirmation.title}</strong>
          <p id="text-open-world-save-confirmation-detail">{confirmation.detail}</p>
          <span>
            <button type="button" disabled={disabled} onClick={() => void confirmRequestedOperation()}>{confirmation.confirmLabel}</button>
            <button ref={confirmationCancelRef} type="button" disabled={disabled} onClick={closeConfirmation}>取消</button>
          </span>
        </div>
      </section>
    </div>, document.body)}

    {props.formalSaveAvailable && tab === 'saves' && <div className="open-world-save-settings-content" data-testid="text-open-world-save-list">
      {currentBranch ? <>
        <section className="open-world-save-create">
          <header>
            <div>
              <small>{currentEntry?.group.versionLabel} · {currentEntry?.group.sourceKind}</small>
              <strong>{currentBranch.title}</strong>
            </div>
            <span>{currentBranch.manualSlots.used}/{currentBranch.manualSlots.limit} 个手动档</span>
          </header>
          <Summary value={currentBranch.summary} />
          <form onSubmit={event => {
            event.preventDefault()
            const name = saveName.trim()
            if (!name || disabled || currentBranch.manualSlots.remaining < 1) return
            void execute(() => props.onCreateManualSave(name), () => setSaveName(''))
          }}>
            <label htmlFor="text-open-world-manual-save-name">为当前进度命名</label>
            <div>
              <input
                id="text-open-world-manual-save-name"
                value={saveName}
                maxLength={200}
                disabled={disabled || currentBranch.manualSlots.remaining < 1}
                onChange={event => setSaveName(event.currentTarget.value)}
                placeholder={currentBranch.manualSlots.remaining > 0 ? '例如：进入盐渠前' : '20 个手动档已用满'}
              />
              <button
                type="submit"
                disabled={disabled || !saveName.trim() || currentBranch.manualSlots.remaining < 1}
              ><Save aria-hidden="true" />保存当前进度</button>
            </div>
          </form>
        </section>

        {PURPOSE_ORDER.map(purpose => {
          const entries = currentBranch.checkpoints.filter(checkpoint => checkpoint.purpose === purpose)
          if (!entries.length) return null
          return <section className="open-world-save-category" key={purpose} data-save-purpose={purpose}>
            <header><strong>{entries[0]?.purposeLabel}</strong><span>{entries.length}</span></header>
            <div>
              {entries.map(checkpoint => <article key={checkpoint.uiId} data-save-health={checkpoint.health}>
                <header>
                  <div>
                    <strong>{checkpoint.name}</strong>
                    <small>{formatTimestamp(checkpoint.createdAt)} · {checkpoint.healthLabel}</small>
                  </div>
                  {checkpoint.health === 'available'
                    ? <CheckCircle2 aria-label="可读取" />
                    : <AlertTriangle aria-label={checkpoint.healthLabel} />}
                </header>
                <Summary value={checkpoint.summary} />
                <footer>
                  <button
                    type="button"
                    disabled={disabled || checkpoint.health !== 'available' || checkpoint.terminal === true}
                    title={checkpoint.terminal ? '结局后存档只能读取，请选择更早的存档。' : undefined}
                    onClick={() => requestConfirmation({
                      title: `从“${checkpoint.name}”继续？`,
                      detail: '当前时间线和之后发生的事件都会保留；系统会从这个存档点建立一条新的时间线分支。',
                      confirmLabel: '建立分支并继续',
                      danger: false,
                      run: () => props.onForkCheckpoint(
                        checkpoint.actionIdentity.checkpointId!,
                        `${currentBranch.title} · ${checkpoint.name}`,
                      ),
                    })}
                  ><GitBranch aria-hidden="true" />从此处继续</button>
                  {checkpoint.repairable && <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void execute(() => props.onRepairCheckpoint(checkpoint.actionIdentity.checkpointId!))}
                  ><ShieldCheck aria-hidden="true" />从规范事件修复</button>}
                  {checkpoint.purpose === 'manual' && <button
                    type="button"
                    disabled={disabled}
                    onClick={() => requestConfirmation({
                      title: `删除“${checkpoint.name}”？`,
                      detail: '只删除这个检查点，不会删除所属时间线或正式发布；删除后会释放一个手动档位。',
                      confirmLabel: '确认删除检查点',
                      danger: true,
                      run: () => props.onDeleteCheckpoint(checkpoint.actionIdentity.checkpointId!),
                    })}
                  ><Trash2 aria-hidden="true" />删除</button>}
                </footer>
              </article>)}
            </div>
          </section>
        })}
        {!currentBranch.checkpoints.length && <p className="open-world-save-settings-empty">
          还没有检查点。旅行完成后会生成轮转自动档；战斗开始前会保留战前重试点。
        </p>}
      </> : <p className="open-world-save-settings-empty">当前时间线尚未进入可读取的存档目录。</p>}
    </div>}

    {props.formalSaveAvailable && tab === 'branches' && <div className="open-world-save-settings-content" data-testid="text-open-world-branch-list">
      {currentBranch && <section className="open-world-branch-create">
        <div><strong>从当前进度建立分支</strong><p>{currentBranch.terminal
          ? '这条时间线已经抵达结局；请从结局前的存档建立分支。'
          : '原时间线保持不变；新分支仍固定使用同一个 Release。'}</p></div>
        <form onSubmit={event => {
          event.preventDefault()
          const title = branchTitle.trim()
          if (!title || disabled || currentBranch.terminal) return
          requestConfirmation({
            title: `建立“${title}”？`,
            detail: '系统会先冻结当前进度，再建立新的子时间线；原时间线与其事件不会被覆盖。',
            confirmLabel: '建立新分支',
            danger: false,
            run: () => props.onForkCurrent(title),
            onSuccess: () => setBranchTitle(''),
          })
        }}>
          <input
            aria-label="新时间线名称"
            value={branchTitle}
            maxLength={200}
            disabled={disabled || currentBranch.terminal}
            onChange={event => setBranchTitle(event.currentTarget.value)}
            placeholder="新时间线名称"
          />
          <button type="submit" disabled={disabled || currentBranch.terminal || !branchTitle.trim()}><GitBranch aria-hidden="true" />建立</button>
        </form>
      </section>}
      {props.saves.groups.map(group => <section className="open-world-branch-group" key={group.uiId}>
        <header><div><strong>{group.title}</strong><small>{group.versionLabel} · {group.sourceKind}</small></div><span>{group.branchCount} 条时间线</span></header>
        <div>
          {group.branches.map(branch => <BranchCard
            key={branch.uiId}
            branch={branch}
            disabled={disabled}
            onSelect={() => void execute(() => props.onSelectBranch(branch.actionIdentity.sessionId))}
            onRepair={() => void execute(() => props.onRepairRuntimeHead(branch.actionIdentity.sessionId))}
            onDelete={() => requestConfirmation({
              title: `删除时间线“${branch.title}”？`,
              detail: `这会删除该时间线自己的事件和检查点，但不会删除共享 Release、父时间线或其它分支。${branch.isCurrent ? '删除当前时间线后会返回游戏库。' : ''}如有子分支，它们会保留并成为独立时间线。此操作不可撤销。`,
              confirmLabel: '确认删除时间线',
              danger: true,
              run: () => props.onDeleteBranch(branch.actionIdentity.sessionId),
            })}
          />)}
        </div>
      </section>)}
      {!props.saves.groups.length && <p className="open-world-save-settings-empty">没有可显示的正式时间线。</p>}
    </div>}

    {tab === 'versions' && <div className="open-world-save-settings-content" data-testid="text-open-world-version-list">
      <VersionPanel
        key={String(props.sessionKey)}
        projection={props.versions}
        disabled={disabled}
        onPreview={props.onPreviewReleaseMigration}
        onMigrate={props.onMigrateRelease}
      />
    </div>}

    {tab === 'settings' && <div className="open-world-save-settings-content">
      <TextOpenWorldPlayerPreferencesPanel
        productionKey={props.productionKey}
        audioAvailable={props.audioAvailable}
      />
    </div>}
  </section>
}

function BranchCard(props: {
  branch: TextOpenWorldPlayerSaveBranchV1
  disabled: boolean
  onSelect(): void
  onRepair(): void
  onDelete(): void
}) {
  const branch = props.branch
  return <article className={branch.isCurrent ? 'is-current' : ''} data-runtime-health={branch.runtimeHealth}>
    <header>
      <div>
        <strong>{branch.title}</strong>
        <small>{branch.relationshipLabel}{branch.parentTitle ? ` · 父分支：${branch.parentTitle}` : ''}</small>
      </div>
      <span>{branch.isCurrent ? '当前时间线' : branch.statusLabel}</span>
    </header>
    <Summary value={branch.summary} />
    <p className="open-world-branch-health">{branch.runtimeHealthLabel} · {branch.manualSlots.used}/{branch.manualSlots.limit} 个手动档</p>
    <footer>
      <button type="button" disabled={props.disabled || branch.isCurrent || branch.runtimeHealth === 'damaged'} onClick={props.onSelect}>
        <History aria-hidden="true" />{branch.isCurrent ? '正在游玩' : '继续此时间线'}
      </button>
      {branch.runtimeRepairable && <button type="button" disabled={props.disabled} onClick={props.onRepair}>
        <ShieldCheck aria-hidden="true" />修复运行缓存
      </button>}
      <button type="button" disabled={props.disabled} onClick={props.onDelete}><Trash2 aria-hidden="true" />删除时间线</button>
    </footer>
  </article>
}

function VersionPanel(props: {
  projection: TextOpenWorldPlayerVersionCompatibilityProjectionV1 | null
  disabled: boolean
  onPreview?: (targetProductReleaseId: number) => Promise<TextOpenWorldSaveMigrationPreviewV1>
  onMigrate?: (targetProductReleaseId: number, expectedPreviewHash: string) => Promise<unknown>
}) {
  const [preview, setPreview] = useState<TextOpenWorldSaveMigrationPreviewV1 | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const projection = props.projection
  if (!projection) return <p className="open-world-save-settings-empty">版本信息正在核验。</p>
  if (projection.availability === 'build-preview-excluded') return <section className="open-world-version-notice">
    <Settings2 aria-hidden="true" />
    <div><strong>当前是制作预览</strong><p>制作预览不属于正式版本目录；发布后创建的正式存档才会固定到 Release。</p></div>
  </section>
  if (projection.availability !== 'ready' || !projection.pinnedRelease) return <section className="open-world-version-notice is-danger">
    <AlertTriangle aria-hidden="true" />
    <div><strong>当前固定版本无法核验</strong><p>{projection.diagnostics[0]?.message ?? '请保留原存档并返回游戏库诊断。'}</p></div>
  </section>
  return <>
    <section className="open-world-version-pinned">
      <ShieldCheck aria-hidden="true" />
      <div>
        <small>当前存档固定版本</small>
        <strong>{projection.pinnedRelease.label} · v{projection.pinnedRelease.version}</strong>
        <p>旧存档会继续使用自己的不可变 Release，不会被静默升级。</p>
      </div>
    </section>
    <section className="open-world-version-catalog">
      <header><strong>同作品正式版本</strong><span>{projection.releases.length}</span></header>
      <div>{projection.releases.map((version, index) => <article key={`${version.version}:${version.createdAt}:${index}`}>
        <div><strong>{version.label} · v{version.version}</strong><small>{formatTimestamp(version.createdAt)}</small></div>
        <span data-version-relation={version.relationToPinned}>{versionStatus(version)}</span>
        {version.canMigratePinnedSession && props.onPreview && <button
          type="button"
          disabled={props.disabled || pending}
          onClick={() => {
            setPending(true)
            setError('')
            setPreview(null)
            setAcknowledged(false)
            void props.onPreview!(version.actionIdentity.productReleaseId)
              .then(setPreview)
              .catch(() => setError('迁移预演未能通过；原存档没有变化，请刷新版本后重试。'))
              .finally(() => setPending(false))
          }}
        >{pending ? <Loader2 className="is-spinning" aria-hidden="true" /> : <GitBranch aria-hidden="true" />}预演迁移</button>}
      </article>)}</div>
    </section>
    {error && <p className="open-world-save-settings-error" role="alert">{error}</p>}
    {preview && <section className="open-world-version-migration-preview" data-testid="text-open-world-version-migration-preview">
      <header>
        <div><small>迁移预演已通过</small><strong>v{preview.source.releaseVersion} → v{preview.target.releaseVersion}</strong></div>
        <ShieldCheck aria-hidden="true" />
      </header>
      <dl>
        <div><dt>玩家等级</dt><dd>{preview.summary.playerLevel}</dd></div>
        <div><dt>当前位置</dt><dd>{preview.summary.locationLabel}</dd></div>
        <div><dt>进行中任务</dt><dd>{preview.summary.activeQuestCount}</dd></div>
        <div><dt>世界分钟</dt><dd>{preview.summary.worldMinute}</dd></div>
      </dl>
      {preview.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <label>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={props.disabled || pending}
          onChange={event => setAcknowledged(event.currentTarget.checked)}
        />
        我确认创建新版本子时间线，并保留当前旧版本时间线作为可回退原分支。
      </label>
      <button
        type="button"
        disabled={props.disabled || pending || !acknowledged || !props.onMigrate}
        onClick={() => {
          if (!props.onMigrate) return
          setPending(true)
          setError('')
          void props.onMigrate(
            preview.actionIdentity.targetProductReleaseId,
            preview.previewHash,
          ).catch(() => {
            setError('迁移提交失败或预演已过期；原存档保持不变，请重新预演。')
            setPreview(null)
            setAcknowledged(false)
          }).finally(() => setPending(false))
        }}
      >{pending ? <Loader2 className="is-spinning" aria-hidden="true" /> : <GitBranch aria-hidden="true" />}创建迁移分支并切换</button>
    </section>}
    {!!projection.diagnostics.length && <section className="open-world-version-diagnostics">
      <strong>被排除的损坏版本</strong>
      {projection.diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}:${index}`}>{diagnostic.message}</p>)}
    </section>}
    <p className="open-world-version-migration-boundary">
      <AlertTriangle aria-hidden="true" />只有直接子版本通过兼容声明和当前存档的状态级预演后才能迁移；其他版本继续固定旧档，或另开新旅程。
    </p>
  </>
}
