import { useCharacterStore } from '../../stores/character'

export default function CharacterReadStatus({ projectId }: { projectId: number }) {
  const { loading, loadError, loadAll } = useCharacterStore()
  if (!loadError) return loading ? <p role="status" className="px-6 py-2 text-sm text-text-muted">正在读取角色…</p> : null
  return <div role="alert" className="px-6 py-3 text-sm text-error">角色读取失败：{loadError}。原数据已保留。
    <button type="button" className="ml-2 underline" onClick={() => { void loadAll(projectId) }}>重试读取角色</button>
  </div>
}
