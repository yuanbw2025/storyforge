import { useState, useEffect } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import type { Project } from '../../lib/types'
import CultivationSystemsPanel from './CultivationSystemsPanel'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

export interface PowerSystemInitialRecordTarget {
  table: 'powerSystems' | 'cultivationSystems'
  recordId: number
}

interface Props {
  project: Project
  initialRecordTarget?: PowerSystemInitialRecordTarget | null
}

export default function PowerSystemPanel({ project, initialRecordTarget }: Props) {
  const { powerSystem, savePowerSystem, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [levels, setLevels] = useState('')
  const [rules, setRules] = useState('')
  const initialPowerSystemId = initialRecordTarget?.table === 'powerSystems'
    ? initialRecordTarget.recordId
    : null

  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  useEffect(() => {
    if (powerSystem) {
      setName(powerSystem.name || '')
      setDescription(powerSystem.description || '')
      setLevels(powerSystem.levels || '')
      setRules(powerSystem.rules || '')
    }
  }, [powerSystem])

  const handleSave = async () => {
    await savePowerSystem({ projectId: project.id!, name, description, levels, rules })
  }
  useInitialRecordTarget(initialPowerSystemId, powerSystem?.id === initialPowerSystemId)

  return (
    <div
      {...initialRecordTargetAttributes(powerSystem?.id === initialPowerSystemId, powerSystem?.id)}
      className={`max-w-3xl rounded-xl ${powerSystem?.id === initialPowerSystemId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text-primary">⚡ 力量体系</h2>
        {project.enableMultiWorld && <WorldGroupSwitcher />}
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">体系名称</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={handleSave}
            placeholder="如：灵气修炼体系、魔法等级..."
            className="w-full px-3 py-2 bg-bg-surface border border-border rounded-md text-text-primary text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">体系描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={handleSave}
            placeholder="简述力量体系的核心原理..."
            rows={3}
            className="w-full p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">等级列表</label>
          <textarea
            value={levels}
            onChange={e => setLevels(e.target.value)}
            onBlur={handleSave}
            placeholder="从低到高列出等级，每行一个..."
            rows={5}
            className="w-full p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">体系规则</label>
          <textarea
            value={rules}
            onChange={e => setRules(e.target.value)}
            onBlur={handleSave}
            placeholder="修炼条件、突破瓶颈、禁忌..."
            rows={4}
            className="w-full p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
          />
        </div>
      </div>
      <CultivationSystemsPanel
        project={project}
        initialSystemId={initialRecordTarget?.table === 'cultivationSystems'
          ? initialRecordTarget.recordId
          : null}
      />
    </div>
  )
}
