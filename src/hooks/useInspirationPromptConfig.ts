import { useEffect, useMemo, useRef, useState } from 'react'
import { createPromptExecutionRequestV1, freezePromptExecutionOptionsV1, type PromptTemplateSelectionV1 } from '../lib/agent/prompt-execution'
import { acknowledgePendingEditFailureV1, capturePendingEditFailureV1, coordinatePendingEditV1, flushPendingEditsV1, registerPendingDraftFlusherV1 } from '../lib/authoring/pending-edit-coordinator'
import { parseInspirationPromptConfigV1, verifyInspirationPromptConfigV1, type InspirationPromptChoiceV1, type InspirationPromptConfigModuleV1, type InspirationPromptConfigV1 } from '../lib/inspiration/prompt-config'
import type { Project } from '../lib/types'
import type { InspirationWorkspace } from '../lib/types/inspiration-workspace'
import type { PromptTemplate } from '../lib/types/prompt'
import type { WorkspaceScope } from '../lib/types/world-ownership'
import { readOwnedRows } from '../lib/workspace/scope'
import { useInspirationWorkspaceStore } from '../stores/inspiration-workspace'
import { usePromptStore } from '../stores/prompt'

type TextDraft = { baseTemplateHash: string; system: string | null; user: string | null }
type Cursor = Pick<InspirationWorkspace, 'id' | 'promptConfig'> | null
type View = {
  key: string; selection: PromptTemplateSelectionV1; choice: InspirationPromptChoiceV1
  parameters: Record<string, unknown>; draft: TextDraft | null
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)
const asTemplate = (selection: PromptTemplateSelectionV1): PromptTemplate => ({
  ...selection.template, id: selection.template.id ?? undefined, isActive: false,
})
async function selectTemplate(template: PromptTemplate): Promise<PromptTemplateSelectionV1> {
  if (template.moduleKey !== 'inspiration.reverse' && template.moduleKey !== 'inspiration.reverse.multiworld') throw new Error('请选择当前灵感模块的模板')
  const frozen = await freezePromptExecutionOptionsV1({ request: createPromptExecutionRequestV1({ moduleKey: template.moduleKey }), template })
  return { template: frozen.template, templateHash: frozen.templateHash }
}
function readDraftEnvelope(key: string): Record<string, unknown> {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('灵感草稿无法完整读取，原数据保留')
  return value as Record<string, unknown>
}
function draftMap(envelope: Record<string, unknown>): Record<string, unknown> {
  const value = envelope.promptDrafts ?? {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('灵感模板草稿无法完整读取，原数据保留')
  return value as Record<string, unknown>
}
function readTextDraft(key: string, module: InspirationPromptConfigModuleV1): TextDraft | null {
  const value = draftMap(readDraftEnvelope(key))[module]
  if (value === undefined) return null
  const draft = value as TextDraft
  if (!draft || typeof draft.baseTemplateHash !== 'string'
    || (draft.system !== null && typeof draft.system !== 'string')
    || (draft.user !== null && typeof draft.user !== 'string')) throw new Error('灵感模板草稿无法完整读取，原数据保留')
  return draft
}
function writeTextDraft(key: string, module: InspirationPromptConfigModuleV1, draft: TextDraft | null) {
  const envelope = readDraftEnvelope(key), drafts = { ...draftMap(envelope) }
  if (draft) drafts[module] = draft
  else delete drafts[module]
  localStorage.setItem(key, JSON.stringify({ ...envelope, promptDrafts: drafts }))
}

/** Work-owned selection uses the existing CAS writer; only temporary text lives in the existing UI draft. */
export function useInspirationPromptConfig(project: Project, module: InspirationPromptConfigModuleV1 | null) {
  const scope = useMemo<WorkspaceScope | null>(() => project.id != null && project.activeWorldId != null && project.activeWorkId != null
    ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId } : null,
  [project.id, project.activeWorldId, project.activeWorkId])
  const owner = `${project.id}:${project.activeWorldId}:${project.activeWorkId}`
  const key = `${owner}:${module}`
  const draftKey = `sf-inspiration-draft-v2-${project.id}-${project.activeWorldId}:${project.activeWorkId}`
  const workspace = useInspirationWorkspaceStore()
  const templates = usePromptStore(s => s.templates)
  const templatesLoaded = usePromptStore(s => s.loaded)
  const session = useMemo(() => ({ owner, cursor: undefined as Cursor | undefined, config: null as InspirationPromptConfigV1 | null,
    writes: 0, pending: Promise.resolve() as Promise<unknown>, failure: undefined as unknown, notify: () => {} }), [owner])
  const current = useRef(key); current.current = key
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const live = () => mounted.current && current.current === key
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef(view); viewRef.current = view
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  session.notify = () => {
    if (!live()) return
    setSaving(session.writes > 0)
    if (session.failure) setError(message(session.failure))
    else if (!session.writes) setRetry(n => n + 1)
  }
  const owned = !!scope && workspace.scope?.projectId === scope.projectId
    && workspace.scope.worldId === scope.worldId && workspace.scope.workId === scope.workId
  const row = owned ? workspace.workspace : null

  useEffect(() => {
    setSaving(session.writes > 0)
    if (!module || !scope || !owned || workspace.loading || !templatesLoaded || session.writes || session.failure) return
    let active = true
    setError('')
    void (async () => {
      const config = parseInspirationPromptConfigV1(row?.promptConfig)
      if (config) await verifyInspirationPromptConfigV1(config)
      const stored = config?.modes[module]
      const activeUser = !stored && templates.find(t => t.moduleKey === module && t.scope === 'user' && t.isActive)
      const defaultTemplate = templates.find(t => t.moduleKey === module && t.scope === 'system' && t.isActive)
        ?? templates.find(t => t.moduleKey === module && t.scope === 'system')
      const template = activeUser || defaultTemplate
      const selection = stored?.kind === 'bound' ? { template: stored.template, templateHash: stored.templateHash }
        : template ? await selectTemplate(template) : null
      if (!selection) throw new Error('当前模块的默认模板尚未加载，请重新读取')
      const choice: InspirationPromptChoiceV1 = stored ?? (activeUser ? { kind: 'bound', ...selection } : { kind: 'follow-default' })
      const draft = readTextDraft(draftKey, module)
      if (!active || !live() || session.writes) return
      session.cursor = row ? { id: row.id, promptConfig: row.promptConfig } : null
      session.config = config
      setView({ key, selection, choice, parameters: choice.kind === 'bound' ? choice.parameterValues ?? {} : {}, draft })
    })().catch(cause => { if (active && live()) { setView(null); setError(message(cause)) } })
    return () => { active = false }
  // Owner/module and the exact stored configuration fence asynchronous reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, owned, workspace.loading, row?.id, row?.promptConfig, templatesLoaded, templates, retry])

  const currentView = () => {
    const value = viewRef.current
    if (!live() || !module || !scope || !owned || workspace.loading || !templatesLoaded || value?.key !== key || session.cursor === undefined) {
      throw new Error('灵感模板配置仍在读取，请稍后重试')
    }
    const observed = useInspirationWorkspaceStore.getState()
    if (observed.scope?.projectId !== scope.projectId || observed.scope.worldId !== scope.worldId || observed.scope.workId !== scope.workId
      || (!session.writes && observed.workspace?.promptConfig !== session.cursor?.promptConfig)) throw new Error('当前作品的模板配置已变化，请重新读取')
    return value
  }
  const publish = (value: View) => { if (live()) { viewRef.current = value; setView(value) } }
  const saveChoice = (choice: InspirationPromptChoiceV1 | (() => Promise<InspirationPromptChoiceV1>)) => {
    if (!scope || !module || session.cursor === undefined) return Promise.reject(new Error('尚未读取当前作品的模板配置'))
    session.writes++
    if (live()) { setSaving(true); setError('') }
    const operation = coordinatePendingEditV1({ key: `inspiration-prompt:${owner}`, persist: async () => {
      const resolvedChoice = typeof choice === 'function' ? await choice() : choice
      if (session.cursor === null) {
        const rows = await readOwnedRows<InspirationWorkspace>(scope, 'inspirationWorkspaces', { owner: 'work' })
        // Adding a fragment may have created the previously absent row. Only a
        // still-unconfigured row can become the initial CAS cursor.
        if (rows.length === 1 && rows[0].promptConfig === undefined) session.cursor = { id: rows[0].id, promptConfig: undefined }
      }
      const config = await useInspirationWorkspaceStore.getState().savePromptConfig(scope, {
        expected: session.cursor!, modes: { ...session.config?.modes, [module]: resolvedChoice },
      })
      const rows = await readOwnedRows<InspirationWorkspace>(scope, 'inspirationWorkspaces', { owner: 'work' })
      if (rows.length !== 1 || rows[0].promptConfig !== JSON.stringify(config)) throw new Error('模板配置已在其他位置改变，请重新读取；未覆盖新配置')
      session.cursor = { id: rows[0].id, promptConfig: rows[0].promptConfig }
      session.config = config
      session.failure = undefined
    } })
    session.pending = operation
    void operation.catch(cause => { session.failure = cause; if (live()) setError(message(cause)) }).finally(() => {
      session.writes--; session.notify()
    })
    return operation
  }
  useEffect(() => {
    if (!module) return
    return registerPendingDraftFlusherV1(async () => { await session.pending })
  }, [module, session])

  const bind = (value: View, parameters = value.parameters) => {
    const choice: InspirationPromptChoiceV1 = { kind: 'bound', ...value.selection, parameterValues: parameters }
    publish({ ...value, choice, parameters })
    return saveChoice(choice)
  }
  const editText = (field: 'system' | 'user', text: string | null) => {
    try {
      const value = currentView()
      if (value.draft && value.draft.baseTemplateHash !== value.selection.templateHash) throw new Error('请先处理未应用的模板文字草稿')
      const draft = { baseTemplateHash: value.selection.templateHash, system: null, user: null, ...value.draft, [field]: text }
      writeTextDraft(draftKey, module!, draft)
      publish({ ...value, draft })
      if (value.choice.kind !== 'bound') void bind({ ...value, draft }).catch(() => undefined)
    } catch (cause) { setError(message(cause)) }
  }
  const setDraft = (reuse: boolean) => {
    try {
      const value = currentView()
      const draft = reuse && value.draft ? { ...value.draft, baseTemplateHash: value.selection.templateHash } : null
      writeTextDraft(draftKey, module!, draft); publish({ ...value, draft }); setError('')
      if (reuse && value.choice.kind !== 'bound') void bind({ ...value, draft }).catch(() => undefined)
    } catch (cause) { setError(message(cause)) }
  }
  const followDefault = async () => {
    const value = currentView()
    const templates = usePromptStore.getState().templates
    const template = templates.find(t => t.moduleKey === module && t.scope === 'system' && t.isActive)
      ?? templates.find(t => t.moduleKey === module && t.scope === 'system')
    if (!template) throw new Error('当前模块的默认模板尚未加载，请重新读取')
    const captured = structuredClone(template)
    let selection!: PromptTemplateSelectionV1
    await saveChoice(async () => { selection = await selectTemplate(captured); return { kind: 'follow-default' } })
    if (!live()) return
    writeTextDraft(draftKey, module!, null)
    publish({ ...value, selection, choice: { kind: 'follow-default' }, parameters: {}, draft: null })
  }
  const saveAs = async (name: string) => {
    currentView()
    // This render's callback is captured before PromptRunPanel opens the name dialog.
    const value = view!
    const draft = value.draft
    if (draft && draft.baseTemplateHash !== value.selection.templateHash) throw new Error('请先处理未应用的模板文字草稿')
    const source = asTemplate(value.selection)
    const now = Date.now()
    let created = false, selection!: PromptTemplateSelectionV1
    try {
      await saveChoice(async () => {
        if (!live()) throw new Error('当前作品或模式已切换，本次未另存模板')
        const id = await usePromptStore.getState().saveTemplate({
          ...source, id: undefined, scope: 'user', name, isActive: false, createdAt: now, updatedAt: now,
          systemPrompt: draft?.system ?? source.systemPrompt, userPromptTemplate: draft?.user ?? source.userPromptTemplate,
          parameters: source.parameters?.map(parameter => ({ ...parameter,
            default: (value.parameters[parameter.key] ?? parameter.default) as typeof parameter.default })),
        })
        created = true
        const saved = usePromptStore.getState().templates.find(t => t.id === id)
        if (!saved) throw new Error('新模板尚未重新读取')
        selection = await selectTemplate(saved)
        return { kind: 'bound', ...selection }
      })
      if (!live()) return
      writeTextDraft(draftKey, module!, null)
      publish({ key, selection, choice: { kind: 'bound', ...selection }, parameters: {}, draft: null })
    } catch (cause) {
      throw created ? new Error(`「${name}」已保存到模板库，尚未绑定当前作品，请从列表选择；${message(cause)}`) : cause
    }
  }
  const retryRead = async () => {
    if (!scope || session.writes) return
    const token = capturePendingEditFailureV1(session.failure)
    if (token) acknowledgePendingEditFailureV1({ token, decision: 'abandon-command' })
    session.pending = Promise.resolve(); session.failure = undefined
    setView(null); setError('')
    await useInspirationWorkspaceStore.getState().load(scope)
    if (live()) setRetry(n => n + 1)
  }
  const resolved = view?.key === key && owned && !workspace.loading && templatesLoaded ? view : null
  const unapplied = !!resolved?.draft && resolved.draft.baseTemplateHash !== resolved.selection.templateHash
  return {
    enabled: module !== null,
    ready: !!resolved && !saving && !error && !unapplied,
    error, saving, unapplied,
    parameters: resolved?.parameters ?? {},
    system: unapplied ? null : resolved?.draft?.system ?? null,
    user: unapplied ? null : resolved?.draft?.user ?? null,
    editText, reuseDraft: () => setDraft(true), clearDraft: () => setDraft(false),
    onParamChange: (parameters: Record<string, unknown>) => { try { void bind(currentView(), parameters).catch(() => undefined) } catch (cause) { setError(message(cause)) } },
    configuration: {
      template: resolved ? asTemplate(resolved.selection) : null,
      mode: resolved?.choice.kind ?? 'follow-default',
      choices: templates.filter(t => t.moduleKey === module), loading: !resolved, saving, error,
      onSelect: async (template: PromptTemplate) => {
        const value = currentView(), captured = structuredClone(template)
        await saveChoice(async () => {
          const selection = await selectTemplate(captured)
          const parameters = Object.fromEntries(Object.entries(value.parameters).filter(([p]) => selection.template.parameters?.some(item => item.key === p)))
          const choice: InspirationPromptChoiceV1 = { kind: 'bound', ...selection, parameterValues: parameters }
          publish({ ...value, selection, choice, parameters })
          return choice
        })
      },
      onFollowDefault: followDefault,
      onSaveAs: saveAs,
      onRetry: retryRead,
      onTemperatureChange: async (temperature: number) => {
        const value = currentView(), source = asTemplate(value.selection)
        await saveChoice(async () => {
          const selection = await selectTemplate({ ...source, modelOverride: { ...source.modelOverride, temperature } })
          const draft = value.draft && value.draft.baseTemplateHash === value.selection.templateHash
            ? { ...value.draft, baseTemplateHash: selection.templateHash } : value.draft
          writeTextDraft(draftKey, module!, draft)
          const choice: InspirationPromptChoiceV1 = { kind: 'bound', ...selection, parameterValues: value.parameters }
          publish({ ...value, selection, draft, choice })
          return choice
        })
      },
    },
    prepareRequest: async () => {
      currentView()
      await flushPendingEditsV1()
      if (!live()) throw new Error('当前作品或模式已切换，本次未发起生成')
      if (session.failure) throw session.failure
      const value = currentView()
      if (value.draft && value.draft.baseTemplateHash !== value.selection.templateHash) throw new Error('请先处理未应用的模板文字草稿')
      if (value.draft && value.choice.kind !== 'bound') {
        await bind(value)
      } else if (!session.config?.modes[module!]) await saveChoice(value.choice)
      let selection = value.selection
      if (value.choice.kind === 'follow-default' && !value.draft) {
        const currentTemplates = usePromptStore.getState().templates
        const latest = currentTemplates.find(t => t.moduleKey === module && t.scope === 'system' && t.isActive)
          ?? currentTemplates.find(t => t.moduleKey === module && t.scope === 'system')
        if (!latest) throw new Error('当前模块的默认模板尚未加载，请重新读取')
        selection = await selectTemplate(structuredClone(latest))
      }
      if (!live()) throw new Error('当前作品或模式已切换，本次未发起生成')
      return createPromptExecutionRequestV1({ moduleKey: module!, selection,
        parameterValues: value.parameters, systemOverride: value.draft?.system, userOverride: value.draft?.user })
    },
  }
}
