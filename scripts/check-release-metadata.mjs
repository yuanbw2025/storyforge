import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function checkReleaseMetadata(rootDir, releaseTag) {
  const packagePath = path.join(rootDir, 'package.json')
  const changelogPath = path.join(rootDir, 'CHANGELOG.md')
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const version = String(pkg.version ?? '')
  const errors = []

  if (!SEMVER_PATTERN.test(version)) {
    errors.push(`package.json version 不是合法 SemVer: ${version || '(empty)'}`)
  }

  const expectedTag = `v${version}`
  if (releaseTag !== expectedTag) {
    errors.push(`Release tag 与 package.json 不一致: 收到 ${releaseTag || '(empty)'}, 期望 ${expectedTag}`)
  }

  const changelog = fs.readFileSync(changelogPath, 'utf8')
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const versionHeading = new RegExp(`^##\\s+v${escapedVersion}(?:\\s|$)`, 'm')
  if (!versionHeading.test(changelog)) {
    errors.push(`CHANGELOG.md 缺少版本标题: ## v${version}`)
  }

  return { version, expectedTag, errors }
}

function runCli() {
  const releaseTag = process.argv[2] ?? process.env.RELEASE_TAG ?? ''
  const result = checkReleaseMetadata(process.cwd(), releaseTag)

  if (result.errors.length > 0) {
    console.error('[release-metadata] 发布元数据校验失败:')
    result.errors.forEach(error => console.error(`  - ${error}`))
    process.exitCode = 1
    return
  }

  console.log(`[release-metadata] ok: ${result.expectedTag}`)
}

const isCli = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) runCli()
