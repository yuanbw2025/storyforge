import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from '../../lib/db/schema'
import { restoreGeneration } from '../../lib/extensions/store'
import type { ExtensionOperation, ExtensionProfile } from '../../lib/extensions/types'
import { useDialog } from '../shared/Dialog'

export default function PluginRecovery({ profile, busy, act }: { profile: ExtensionProfile; busy: boolean; act(action: () => Promise<void>): Promise<void> }) {
  const dialog = useDialog()
  const [operations, setOperations] = useState<ExtensionOperation[]>([])
  const [generation, setGeneration] = useState('')
  useEffect(() => {
    const subscription = liveQuery(() => db.extensionOperations.where('profileId').equals(profile.id!).toArray()).subscribe(setOperations)
    return () => subscription.unsubscribe()
  }, [profile.id])
  const prior = [...new Set(operations.filter(row => row.toGeneration < profile.generation).map(row => row.toGeneration))].sort((a, b) => b - a)
  return <details><summary>数据恢复与操作记录</summary><p>当前数据代 {profile.generation}。恢复会复制旧内容到新的数据代，保留恢复前的全部内容；需要对应版本安装包才能重新启用。</p>
    {prior.length > 0 && <div className="sf-extension-actions"><select aria-label={`恢复 ${profile.pluginId} 的数据代`} value={generation} onChange={e => setGeneration(e.target.value)}><option value="">选择历史数据代</option>{prior.map(value => <option key={value} value={value}>数据代 {value}</option>)}</select><button disabled={busy || profile.enabled || !generation} onClick={() => void act(async () => { if (await dialog.confirm({ title:'恢复历史数据？', message:'当前版本必须先停用。旧数据会复制为新的数据代，较新的编辑仍保留；不会自动启用旧版本代码。', confirmText:'保留现状并恢复' })) { await restoreGeneration(profile, Number(generation)); setGeneration('') } })}>恢复所选数据</button></div>}
    <ul>{operations.slice(-20).reverse().map(row => <li key={row.id}>{new Date(row.createdAt).toLocaleString()} · {row.detail}</li>)}</ul>
  </details>
}
