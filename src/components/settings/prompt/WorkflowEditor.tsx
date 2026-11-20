import { useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, List, Plus, Save, Trash2, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useWorkflowStore } from '../../../stores/workflow'
import { usePromptStore } from '../../../stores/prompt'
import { isRetiredPromptModuleKey } from '../../../lib/types/prompt'
import type {
  PromptWorkflow,
  PromptWorkflowGraph,
  PromptWorkflowStep,
} from '../../../lib/types/workflow'
import {
  ALL_MODULE_KEYS_FOR_WORKFLOW,
  SAVE_TARGET_PRESETS,
  saveTargetToValue,
  valueToSaveTarget,
} from './workflow-helpers'
import {
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  validateWorkflowGraph,
  workflowGraphFor,
} from '../../../lib/workflow/graph'
import { useDialog } from '../../shared/Dialog'
import { useToast } from '../../shared/Toast'
import WorkflowCanvas from './WorkflowCanvas'

type EditorMode = 'canvas' | 'details'

export default function WorkflowEditor({
  workflow,
  onClose,
}: {
  workflow: PromptWorkflow
  onClose: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const saveWorkflow = useWorkflowStore(state => state.save)
  const removeWorkflow = useWorkflowStore(state => state.remove)
  const templates = usePromptStore(state => state.templates)
  const [draft, setDraft] = useState<PromptWorkflow>(workflow)
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<EditorMode>('canvas')
  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    workflow.steps[0]?.stepId ?? null,
  )
  const graphIssues = useMemo(() => validateWorkflowGraph(draft), [draft])
  const graph = useMemo(() => workflowGraphFor(draft), [draft])
  const selectedStep = draft.steps.find(step => step.stepId === selectedStepId) ?? null
  const selectedStepIndex = selectedStep
    ? draft.steps.findIndex(step => step.stepId === selectedStep.stepId)
    : -1

  const update = (patch: Partial<PromptWorkflow>) => {
    setDraft(current => ({ ...current, ...patch }))
    setDirty(true)
  }

  const updateStepById = (stepId: string, patch: Partial<PromptWorkflowStep>) => {
    setDraft(current => ({
      ...current,
      steps: current.steps.map(step => step.stepId === stepId ? { ...step, ...patch } : step),
    }))
    setDirty(true)
  }

  const updateGraph = (updater: (graph: PromptWorkflowGraph, current: PromptWorkflow) => PromptWorkflowGraph) => {
    setDraft(current => ({
      ...current,
      graph: updater(workflowGraphFor(current), current),
    }))
    setDirty(true)
  }

  const addStep = () => {
    const stepId = `s-${nanoid(8)}`
    setDraft(current => {
      const currentGraph = workflowGraphFor(current)
      const rightmost = currentGraph.nodes.reduce(
        (max, node) => Math.max(max, node.x + WORKFLOW_NODE_WIDTH),
        0,
      )
      const row = currentGraph.nodes.length % 3
      const step: PromptWorkflowStep = {
        stepId,
        label: `节点 ${current.steps.length + 1}`,
        promptModuleKey: 'chapter.content',
        userConfirmRequired: true,
      }
      return {
        ...current,
        steps: [...current.steps, step],
        graph: {
          ...currentGraph,
          nodes: [
            ...currentGraph.nodes,
            {
              stepId,
              x: Math.max(48, rightmost + 96),
              y: 48 + row * (WORKFLOW_NODE_HEIGHT + 72),
            },
          ],
        },
      }
    })
    setSelectedStepId(stepId)
    setDirty(true)
  }

  const removeStepById = (stepId: string) => {
    setDraft(current => {
      const currentGraph = workflowGraphFor(current)
      const nextSteps = current.steps.filter(step => step.stepId !== stepId)
      if (selectedStepId === stepId) {
        setSelectedStepId(nextSteps[0]?.stepId ?? null)
      }
      return {
        ...current,
        steps: nextSteps,
        graph: {
          ...currentGraph,
          nodes: currentGraph.nodes.filter(node => node.stepId !== stepId),
          edges: currentGraph.edges.filter(
            edge => edge.sourceStepId !== stepId && edge.targetStepId !== stepId,
          ),
        },
      }
    })
    setDirty(true)
  }

  const moveStepOrder = (stepId: string, direction: -1 | 1) => {
    setDraft(current => {
      const index = current.steps.findIndex(step => step.stepId === stepId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.steps.length) return current
      const next = [...current.steps]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...current, steps: next }
    })
    setDirty(true)
  }

  const addEdge = (sourceStepId: string, targetStepId: string) => {
    const targetStep = draft.steps.find(step => step.stepId === targetStepId)
    if (!targetStep) return
    const targetVariable = targetStep.inputMapping?.previousOutput?.trim() || 'worldContext'
    const edgeId = `e-${nanoid(8)}`
    const nextGraph: PromptWorkflowGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        { edgeId, sourceStepId, targetStepId, targetVariable },
      ],
    }
    const nextDraft = { ...draft, graph: nextGraph }
    const errors = validateWorkflowGraph(nextDraft)
    const hardConnectionError = errors.find(issue =>
      issue.code === 'duplicate-edge' ||
      issue.code === 'self-edge' ||
      issue.code === 'cycle'
    )
    if (hardConnectionError) {
      toast.error(hardConnectionError.message)
      return
    }
    setDraft(nextDraft)
    setDirty(true)
    setSelectedStepId(targetStepId)
  }

  const updateEdgeVariable = (edgeId: string, targetVariable: string) => {
    updateGraph(current => ({
      ...current,
      edges: current.edges.map(edge => edge.edgeId === edgeId
        ? { ...edge, targetVariable }
        : edge),
    }))
  }

  const removeEdge = (edgeId: string) => {
    updateGraph(current => ({
      ...current,
      edges: current.edges.filter(edge => edge.edgeId !== edgeId),
    }))
  }

  const handleSave = async () => {
    if (graphIssues.length) {
      toast.error('请先修复工作流图错误。')
      return
    }
    try {
      await saveWorkflow(draft)
      setDirty(false)
      toast.success('提示词实验已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleClose = async () => {
    if (dirty) {
      const ok = await dialog.confirm({
        title: '放弃未保存的更改？',
        message: '当前节点、连线或参数尚未保存，返回后会丢失。',
        confirmText: '放弃并返回',
        tone: 'danger',
      })
      if (!ok) return
    }
    onClose()
  }

  const handleDelete = async () => {
    if (!draft.id) return
    const ok = await dialog.confirm({
      title: `删除工作流「${draft.name}」？`,
      message: '节点布局和连线也会一并删除，此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await removeWorkflow(draft.id)
    onClose()
  }

  const incomingEdges = selectedStep
    ? graph.edges.filter(edge => edge.targetStepId === selectedStep.stepId)
    : []
  const template = selectedStep
    ? (
        selectedStep.templateId != null
          ? templates.find(item => item.id === selectedStep.templateId)
          : templates.find(item => item.moduleKey === selectedStep.promptModuleKey && item.isActive)
            ?? templates.find(item => item.moduleKey === selectedStep.promptModuleKey)
      )
    : undefined
  const bindings = template?.variableBindings ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text-primary">
            提示词实验 · {draft.name}
          </h2>
          <p className="text-xs text-text-muted">
            FLOW-1 第一阶段 · DAG 编排会复用现有 GenerationNode 和作者确认写回
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-border bg-bg-base p-0.5">
            <button
              type="button"
              onClick={() => setMode('canvas')}
              className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${
                mode === 'canvas' ? 'bg-accent text-white' : 'text-text-secondary'
              }`}
            >
              <GitBranch className="h-3.5 w-3.5" /> 画布
            </button>
            <button
              type="button"
              onClick={() => setMode('details')}
              className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${
                mode === 'details' ? 'bg-accent text-white' : 'text-text-secondary'
              }`}
            >
              <List className="h-3.5 w-3.5" /> 顺序
            </button>
          </div>
          <button
            type="button"
            onClick={() => { void handleSave() }}
            disabled={!dirty || graphIssues.length > 0}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> 保存{dirty && ' *'}
          </button>
          <button
            type="button"
            onClick={() => { void handleClose() }}
            className="rounded px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover"
          >
            返回
          </button>
        </div>
      </div>

      {graphIssues.length > 0 && (
        <div role="alert" className="flex items-start gap-2 border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{graphIssues.map(issue => issue.message).join('；')}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 p-3">
          {mode === 'canvas' ? (
            <WorkflowCanvas
              workflow={draft}
              selectedStepId={selectedStepId}
              onSelectStep={setSelectedStepId}
              onAddStep={addStep}
              onMoveNode={(stepId, x, y) => updateGraph(current => ({
                ...current,
                nodes: current.nodes.map(node => node.stepId === stepId ? { ...node, x, y } : node),
              }))}
              onAddEdge={addEdge}
              onRemoveEdge={removeEdge}
              onRemoveStep={removeStepById}
              onViewportChange={viewport => updateGraph(current => ({ ...current, viewport }))}
            />
          ) : (
            <div className="h-full min-h-[620px] overflow-y-auto rounded-xl border border-border bg-bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-text-primary">作者顺序</h3>
                  <p className="text-[11px] text-text-muted">
                    拓扑排序并列时使用这里的顺序；真实依赖仍由画布连线决定。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addStep}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent/10"
                >
                  <Plus className="h-3 w-3" /> 添加节点
                </button>
              </div>
              <div className="space-y-2">
                {draft.steps.map((step, index) => (
                  <div
                    key={step.stepId}
                    className={`flex w-full items-center gap-2 rounded border p-3 text-left ${
                      selectedStepId === step.stepId
                        ? 'border-accent bg-accent/5'
                        : 'border-border bg-bg-base'
                    }`}
                  >
                    <span className="w-6 text-xs text-text-muted">{index + 1}.</span>
                    <button
                      type="button"
                      onClick={() => setSelectedStepId(step.stepId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-xs font-medium text-text-primary">{step.label}</span>
                      <span className="block truncate text-[10px] text-text-muted">{step.promptModuleKey}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`上移节点 ${step.label}`}
                      disabled={index === 0}
                      onClick={() => moveStepOrder(step.stepId, -1)}
                      className="rounded px-1 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`下移节点 ${step.label}`}
                      disabled={index === draft.steps.length - 1}
                      onClick={() => moveStepOrder(step.stepId, 1)}
                      className="rounded px-1 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`删除节点 ${step.label}`}
                      onClick={() => removeStepById(step.stepId)}
                      className="rounded p-1 text-text-muted hover:bg-error/10 hover:text-error"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-border bg-bg-surface p-4">
          <div className="mb-4 space-y-3 border-b border-border pb-4">
            <div>
              <label className="mb-1 block text-[10px] text-text-muted">工作流名称</label>
              <input
                value={draft.name}
                onChange={event => update({ name: event.target.value })}
                className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-text-muted">说明</label>
              <textarea
                value={draft.description}
                onChange={event => update({ description: event.target.value })}
                rows={2}
                className="w-full resize-y rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {selectedStep ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">节点检查器</h3>
                <span className="text-[10px] text-text-muted">
                  {selectedStepIndex + 1} / {draft.steps.length}
                </span>
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">节点名称</label>
                <input
                  value={selectedStep.label}
                  onChange={event => updateStepById(selectedStep.stepId, { label: event.target.value })}
                  className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Prompt 模块</label>
                <select
                  aria-label="Prompt 模块"
                  value={selectedStep.promptModuleKey}
                  onChange={event => updateStepById(selectedStep.stepId, {
                    promptModuleKey: event.target.value as PromptWorkflowStep['promptModuleKey'],
                    templateId: undefined,
                  })}
                  className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  {ALL_MODULE_KEYS_FOR_WORKFLOW.map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">本节点模板</label>
                <select
                  aria-label="本节点模板"
                  value={selectedStep.templateId ?? ''}
                  onChange={event => updateStepById(selectedStep.stepId, {
                    templateId: event.target.value ? Number(event.target.value) : undefined,
                  })}
                  className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="">跟随当前激活模板</option>
                  {templates.filter(item => item.moduleKey === selectedStep.promptModuleKey && !isRetiredPromptModuleKey(item.moduleKey)).map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                {template && <p className="mt-1 text-[10px] text-text-muted">{template.description}</p>}
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">给 AI 的提示</label>
                <textarea
                  aria-label="给 AI 的提示"
                  value={selectedStep.userHint ?? ''}
                  onChange={event => updateStepById(selectedStep.stepId, { userHint: event.target.value })}
                  rows={3}
                  className="w-full resize-y rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">作者确认后的保存目标</label>
                <select
                  value={saveTargetToValue(selectedStep.saveTarget)}
                  onChange={event => updateStepById(selectedStep.stepId, {
                    saveTarget: valueToSaveTarget(event.target.value),
                  })}
                  className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  {SAVE_TARGET_PRESETS.map(preset => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={selectedStep.userConfirmRequired ?? false}
                  onChange={event => updateStepById(selectedStep.stepId, {
                    userConfirmRequired: event.target.checked,
                  })}
                  className="accent-accent"
                />
                本节点完成后暂停，等待作者确认
              </label>

              {incomingEdges.length > 0 && (
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-[10px] font-medium text-text-secondary">输入端口</p>
                  <div className="space-y-2">
                    {incomingEdges.map(edge => {
                      const source = draft.steps.find(step => step.stepId === edge.sourceStepId)
                      return (
                        <div key={edge.edgeId} className="rounded border border-border bg-bg-base p-2">
                          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                            <span className="truncate">来自：{source?.label ?? edge.sourceStepId}</span>
                            <button
                              type="button"
                              onClick={() => removeEdge(edge.edgeId)}
                              className="rounded p-0.5 hover:bg-error/10 hover:text-error"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          <input
                            aria-label={`连线变量 ${source?.label ?? edge.sourceStepId}`}
                            value={edge.targetVariable}
                            onChange={event => updateEdgeVariable(edge.edgeId, event.target.value)}
                            className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-[11px] text-text-primary focus:border-accent focus:outline-none"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {bindings.length > 0 && (
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-[10px] text-text-muted">
                    {bindings.some(binding => binding.sourceKeys?.length)
                      ? '模板会读取登记资料；这里可补充本次材料。'
                      : '填写本次材料，或把上游节点连到对应变量。不会自动读取未声明的作品资料。'}
                  </p>
                  <div className="space-y-2">
                    {bindings.map(binding => (
                      <div key={binding.variable}>
                        <label className="mb-1 block text-[10px] text-text-muted">
                          {binding.label}{binding.required ? ' *' : ''}
                        </label>
                        <textarea
                          aria-label={binding.label}
                          placeholder={binding.placeholder}
                          value={selectedStep.inputValues?.[binding.variable] ?? ''}
                          onChange={event => updateStepById(selectedStep.stepId, {
                            inputValues: {
                              ...(selectedStep.inputValues ?? {}),
                              [binding.variable]: event.target.value,
                            },
                          })}
                          rows={2}
                          className="w-full resize-y rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-text-muted">
              添加或选择一个节点后编辑参数。
            </div>
          )}

          {draft.scope === 'user' && draft.id && (
            <button
              type="button"
              onClick={() => { void handleDelete() }}
              className="mt-6 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-error hover:bg-error/10"
            >
              <Trash2 className="h-3 w-3" /> 删除整个工作流
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}
