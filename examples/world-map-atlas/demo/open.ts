import { db } from '../../../src/lib/db/schema'
import { importProjectJSON } from '../../../src/lib/export/json-export'

// This branch-only Vite example restores a user-owned workspace in each browser.
async function openSample() {
  if (!import.meta.env.DEV) throw Error('请使用本机地图工作树打开示例。')
  const key = 'storyforge-local-demo-world-atlas-20261118'
  await navigator.locks.request(key, async () => {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    const previous = saved && (await db.projects.get(saved.id))
    let id = previous && previous.workspaceUid === saved.uid ? previous.id : undefined
    if (!id) {
      const response = await fetch(new URL('./project.json.gz', import.meta.url))
      if (!response.ok || !response.body) throw Error('本机示例备份读取失败。')
      const bytes = new Uint8Array(await response.arrayBuffer())
      const archive =
        bytes[0] === 0x1f && bytes[1] === 0x8b
          ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
          : JSON.parse(new TextDecoder().decode(bytes))
      id = await importProjectJSON(archive)
      const project = await db.projects.get(id)
      localStorage.setItem(key, JSON.stringify({ id, uid: project?.workspaceUid }))
    }
    location.replace(import.meta.env.BASE_URL + 'workspace/' + id + '?module=world-map&atlas=1&view=map')
  })
}
openSample().catch((error) => {
  document.querySelector('[role=status]')!.textContent = error.message
})
