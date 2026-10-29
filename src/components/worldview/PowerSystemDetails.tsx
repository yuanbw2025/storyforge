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
export default function PowerSystemDetails({ project, initialRecordId }: {
  project: Project
  initialRecordId?: number | null
}) {
  const { powerSystem, savePowerSystem, loading } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const worldGroupId = project.enableMultiWorld ? activeGroupId : (powerSystem?.worldGroupId ?? null)
  const record = powerSystem && powerSystem.projectId === project.id
    && (powerSystem.worldGroupId ?? null) === worldGroupId ? powerSystem : null
  useInitialRecordTarget(initialRecordId, record?.id === initialRecordId)
  const save = (patch: Partial<PowerSystem>) => savePowerSystem({
    projectId: project.id!, worldGroupId, ...patch,
  }, { projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! })
  return <fieldset
    disabled={loading || (project.enableMultiWorld && activeGroupId == null)}
    aria-label="力量体系规则明细"
    {...initialRecordTargetAttributes(record?.id === initialRecordId, record?.id)}
    className={`mt-6 space-y-4 rounded-lg border border-border p-4 ${record?.id === initialRecordId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
  >
    <legend className="px-2 text-base font-semibold">规则明细</legend>
    <p className="text-xs text-text-muted">在同一处维护体系名称、等级与约束。已有明细原样保留；若与上方概述不一致，请核对后修改。</p>
    <div><h3 className="mb-1 text-sm font-medium">体系名称</h3>
      <InlineInput value={record?.name ?? ''} onChange={name => save({ name })} placeholder="如：灵气修炼体系、魔法等级…"/>
    </div>
    {([
      ['description', '体系描述', '简述力量体系的核心原理…'],
      ['levels', '等级列表', '从低到高列出等级，每行一个…'],
      ['rules', '体系规则', '修炼条件、突破瓶颈、禁忌…'],
    ] as const).map(([key, label, placeholder]) => <div key={key}>
      <h3 className="mb-1 text-sm font-medium">{label}</h3>
      <InlineTextarea value={record?.[key] ?? ''} onChange={value => save({ [key]: value })} placeholder={placeholder}/>
    </div>)}
  </fieldset>
}
