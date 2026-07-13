import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReleaseMetadata } from '../../scripts/check-release-metadata.mjs'

const tempDirs: string[] = []

function makeRepo(version: string, changelogVersion = version): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyforge-release-metadata-'))
  tempDirs.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## v${changelogVersion} - release\n`)
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('AUDIT-7 · Release 元数据护栏', () => {
  it('接受 tag、package version 与 changelog 三方一致', () => {
    const result = checkReleaseMetadata(makeRepo('3.8.0'), 'v3.8.0')
    expect(result.errors).toEqual([])
  })

  it('同时报告 tag 错位与 changelog 漏版本', () => {
    const result = checkReleaseMetadata(makeRepo('3.8.1', '3.8.0'), 'v3.9.0')
    expect(result.errors).toEqual([
      'Release tag 与 package.json 不一致: 收到 v3.9.0, 期望 v3.8.1',
      'CHANGELOG.md 缺少版本标题: ## v3.8.1',
    ])
  })
})
