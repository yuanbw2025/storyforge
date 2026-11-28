import { PowerAuthoringButtonV1 } from './PowerAuthoringControls'
import { useAuthorRecordSavesV1 } from '../shared/AuthorRecordSaveScope'
import type { LocalSaveIntentV1 } from '../../lib/authoring/local-save-evidence'
import { inputAreaLayoutV1 } from '../../lib/input-area-layout'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import { InlineInput, InlineTextarea } from '../shared/InlineEdit'
import type { Project, PowerSystem } from '../../lib/types'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

/** Structured rules belong to the origin/power editor. Keep record IDs stable for
 * character references, source manifests, impact receipts and backup round trips. */
export default function PowerSystemDetails({ project, initialRecordId, resizableInputs = false }: {
  project: Project
  resizableInputs?: boolean
  initialRecordId?: number | null
}) {
  const { powerSystem, savePowerSystem, loading, loadError, loadedScope } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const worldGroupId = project.enableMultiWorld ? activeGroupId : (powerSystem?.worldGroupId ?? null)
  const ready = !loading && !loadError && loadedScope != null && loadedScope.projectId === project.id && loadedScope.worldId === project.activeWorldId && loadedScope.workId === project.activeWorkId
  const record = ready && powerSystem && powerSystem.projectId === project.id
    && (powerSystem.worldGroupId ?? null) === worldGroupId ? powerSystem : null
  useInitialRecordTarget(initialRecordId, record?.id === initialRecordId)
  const localSave = useAuthorRecordSavesV1('powerSystems', record)
  const save = (patch: Partial<PowerSystem>, confirmation?: LocalSaveIntentV1) => savePowerSystem({
    projectId: project.id!, worldGroupId, ...patch,
  }, { projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! }, confirmation)
  return <fieldset
    disabled={!ready || (project.enableMultiWorld && activeGroupId == null)}
    aria-label="力量体系规则明细"
    {...initialRecordTargetAttributes(record?.id === initialRecordId, record?.id)}
    className={`mt-6 space-y-4 rounded-lg border border-border p-4 ${record?.id === initialRecordId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
  >
    <legend className="px-2 text-base font-semibold">{record?.name || '力量体系规则'}</legend>
    <p className="text-xs text-text-muted">在同一处维护体系名称、等级与约束。已有明细原样保留；若与上方概述不一致，请核对后修改。</p>
    <div><h3 className="mb-1 text-sm font-medium">体系名称<PowerAuthoringButtonV1 target={record?.id ? { table: 'powerSystems', recordId: record.id, field: 'name' } : null}/></h3>
      <InlineInput value={record?.name ?? ''} localSave={localSave('name')} onChange={(name, intent) => save({ name }, intent)} placeholder="如：灵气修炼体系、魔法等级…"/>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">{([
      ['description', '体系总体', '简述力量体系的核心原理…'],
      ['rules', '规则与代价', '修炼条件、突破瓶颈、禁忌…'],
    ] as const).map(([key, label, placeholder]) => <div key={key}>
      <h3 className="mb-1 text-sm font-medium">{label}<PowerAuthoringButtonV1 target={record?.id ? { table: 'powerSystems', recordId: record.id, field: key } : null}/></h3>
      <InlineTextarea markdownRead inputAreaLayout={inputAreaLayoutV1(resizableInputs, `power.${key}`)} value={record?.[key] ?? ''} localSave={localSave(key)} onChange={(value, intent) => save({ [key]: value }, intent)} placeholder={placeholder}/>
    </div>)}</div>
    <details className="text-xs text-text-muted"><summary>已有层级说明（独立保留）</summary>
      <p className="my-2">下方路径阶段图是阶段身份和前置关系的依据。这里保留已有文字说明；如与概览、规则或阶段图不一致，请核对来源后在对应字段裁决，不自动互相覆盖。</p>
      <InlineTextarea markdownRead inputAreaLayout={inputAreaLayoutV1(resizableInputs, 'power.levels')} value={record?.levels ?? ''} localSave={localSave('levels')} onChange={(levels, intent) => save({ levels }, intent)} placeholder="原有层级说明…"/>
    </details>
  </fieldset>
}
