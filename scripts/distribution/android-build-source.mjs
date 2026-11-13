import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const sourceFile = 'storyforge/build-source.json'

export async function assertCleanAndroidBuildSource(root = process.cwd(), web = path.join(root, 'dist-android')) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const info = JSON.parse(await readFile(path.join(web, sourceFile), 'utf8'))
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  if (info.schema !== 'storyforge.android-build-source' || info.version !== 1 || info.dirty !== false
      || info.packageVersion !== version || git('status', '--porcelain')
      || !/^[a-f0-9]{40}$/.test(info.sourceCommit)
      || info.sourceTree !== git('rev-parse', 'HEAD^{tree}')
      || info.sourceTree !== git('rev-parse', `${info.sourceCommit}^{tree}`)) {
    throw new Error('Formal Android build requires the same clean source as its Web payload')
  }
}

/** Build evidence only; contains no machine paths, credentials or author data. */
export async function writeAndroidBuildSource(root = process.cwd(), web = path.join(root, 'dist-android')) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const sourceCommit = process.env.STORYFORGE_ANDROID_SOURCE_SHA || git('rev-parse', 'HEAD')
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Android build source must be an exact commit')
  const sourceTree = git('rev-parse', `${sourceCommit}^{tree}`)
  if (sourceTree !== git('rev-parse', 'HEAD^{tree}')) throw new Error('Android build source differs from checkout tree')
  const dirty = Boolean(git('status', '--porcelain'))
  const { version: packageVersion } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const files = []
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      if (relative === sourceFile) continue
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`)
      else if (entry.isFile()) {
        const bytes = await readFile(path.join(directory, entry.name))
        files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      } else throw new Error('Android build payload must contain ordinary files only')
    }
  }
  await walk(web)
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  if (!files.some(file => file.path === 'index.html') || !files.some(file => file.path === 'storyforge/index.html')) {
    throw new Error('Android build payload is incomplete')
  }
  const evidence = { schema: 'storyforge.android-build-source', version: 1, packageVersion, sourceCommit, sourceTree, dirty, files }
  await writeFile(path.join(web, sourceFile), JSON.stringify(evidence, null, 2) + '\n')
  return evidence
}
