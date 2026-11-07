import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/** Keep package.json's complete ci command as the only gate inventory.
 * Reject unsupported shell syntax instead of accidentally dropping a new gate.
 * @param {string} command */
export function staticCommands(command) {
  const commands = command.split(' && ')
  const coverage = commands.filter(value => value === 'npm run test:coverage')
  if (coverage.length !== 1) throw new Error('Expected exactly one original coverage gate')
  return commands.filter(value => value !== 'npm run test:coverage').map(value => {
    if (!/^npm run [a-z0-9:_-]+$/.test(value) && value !== 'npx tsc --noEmit') {
      throw new Error('Review new CI command syntax before splitting: ' + value)
    }
    return value.split(' ')
  })
}

/** @param {Record<string, {result: string}>} needs @param {string} event */
export function requireCIResults(needs, event) {
  const required = ['checks', 'coverage-plan', 'coverage-shards', 'coverage-merge', 'browser', 'avg-media-experimental']
  if (!['push', 'pull_request'].includes(event)) throw new Error('Unknown CI event')
  if (Object.keys(needs).sort().join() !== [...required].sort().join()) throw new Error('Missing or unexpected required jobs')
  for (const name of required) {
    const expected = name === 'avg-media-experimental' && event === 'push' ? 'skipped' : 'success'
    if (needs[name]?.result !== expected) throw new Error('Incomplete required CI gate: ' + name + ' (' + needs[name]?.result + ')')
  }
}

export function main() {
  const { scripts } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  for (const [executable, ...args] of staticCommands(scripts.ci)) {
    console.info('[ci static/build] ' + executable + ' ' + args.join(' '))
    const result = spawnSync(executable, args, { stdio: 'inherit', env: process.env, cwd: process.cwd() })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('CI gate failed or interrupted: ' + executable + ' ' + args.join(' '))
  }
  console.info('[ci static/build] completed; complete coverage and browser gates are still required')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === 'verify') {
      requireCIResults(JSON.parse(process.env.CI_NEEDS ?? '{}'), process.env.CI_EVENT ?? '')
    } else if (process.argv.length === 2) main()
    else throw new Error('Unexpected CI static runner arguments')
  } catch (error) { console.error(error); process.exitCode = 1 }
}
