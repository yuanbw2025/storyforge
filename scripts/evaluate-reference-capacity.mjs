// Eval-only. Production algorithms, original fixtures, no author database or adoption.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import { assertOfflineReferenceCapacityEntry } from './reference-quality-contract.mjs'
const output = process.argv[2]
if (!output?.startsWith('/') || output.startsWith(process.cwd() + '/')) throw Error('Use a new absolute directory outside Git')
assertOfflineReferenceCapacityEntry(JSON.parse(await readFile('src/lib/agent/ai-entry-registry.json', 'utf8')))
const local = await import(pathToFileURL(join(process.env.STORYFORGE_LOCAL_API_HOME || join(homedir(), '.config/storyforge/api'), 'lib/local-api.mjs')).href)
const { profile, apiKey } = local.loadProfile(process.argv[3] || 'agnes-primary', { purpose: 'comparison' })
await mkdir(output, { recursive: false })
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
let count = 0
const hash = text => createHash('sha256').update(text).digest('hex')
const evidence = []
const sourceHashes = Object.fromEntries(await Promise.all(['src/lib/reference-analysis/adaptive-requests.ts', 'src/lib/reference-analysis/request-capacity.ts', 'src/lib/reference-analysis/derived-agent-plan.ts', 'scripts/evaluate-reference-capacity.mjs'].map(async path => [path, hash(await readFile(path))])))
try {
  const { runAdaptiveReferenceRequestsV1, reviewReferenceAcrossBatchesV1, referenceSelectionContextV1 } = await server.ssrLoadModule('/src/lib/reference-analysis/adaptive-requests.ts')
  const { buildReferenceDerivedMessagesV1, buildReferenceCrossRangeMessagesV1 } = await server.ssrLoadModule('/src/lib/reference-analysis/derived-agent-plan.ts')
  const facts = [
    '【块1】栖港的守灯人柳迟被称为白鹭。旁白指出她把铜钥匙交给阿渡，但阿渡当时不知道她的别称；不能把读者信息当成人物知识。她要求借钥匙者先救冻伤的船员，约定翌日归还。',
    '【块2】阿渡把钥匙交给姐姐小弥保管。小弥误以为白鹭是另一位守灯人，文本仅证实她的误认，不能认证第二个白鹭。阿渡因救船员耽误归还，并非背叛约定。',
    '【块3】阿渡在一封注明日期的信里第一次得知柳迟就是白鹭，时间晚于交钥匙。十年前同名柳迟的账册只是一份残页，不能据同名归并身份，也不能证明账册属于守灯人。',
    '【块4】柳迟听完救船员经过后同意延期，但阿渡仍未交回钥匙；此处不是最终归还。叙述没有说明冻伤船员与十年前账册有关。',
    '【块5】小弥把铜钥匙交回柳迟，并说明阿渡去领药。钥匙的归还者是小弥，不是阿渡亲手归还。篇末止于这一天，不能推断柳迟或阿渡此后的死亡。',
  ]
  const filler = '【逐块分析补充】港口日常描写保留安静体验的成立空间，不能把所有停顿改成袭击；来源没有支持更晚的结局。\n'
  const makeSource = repetitions => facts.map((fact, i) => `【块 ${i + 1}】\n${fact}\n${filler.repeat(repetitions)}`).join('\n')
  const small = makeSource(20)
  const large = makeSource(500)
  await writeFile(resolve(output, 'fixtures.json'), JSON.stringify({ small, large, hashes: { small: hash(small), large: hash(large) } }, null, 2))
  const messages = selection => buildReferenceDerivedMessagesV1({ mode: 'summary', summaryKeys: ['characterCraft', 'plotStructure'],
    registeredContext: `${referenceSelectionContextV1(selection)}\n登记维度：characterCraft、plotStructure`,
  })
  const invoke = async (messages, selection) => {
    const id = String(++count).padStart(3, '0')
    const defaults = { ...profile.api.chat.requestDefaults }
    delete defaults.max_tokens; delete defaults.max_completion_tokens
    const body = { ...defaults, model: profile.modelOrCapability, messages, stream: false, temperature: 0.2, response_format: { type: 'json_object' } }
    await writeFile(resolve(output, id + '.request.json'), JSON.stringify({ messages, selection, hash: hash(JSON.stringify(messages)), configuredOutputLimit: null }, null, 2))
    let response
    try { response = await fetch(profile.endpoint.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    }) } catch { await writeFile(resolve(output, id + '.failure.json'), JSON.stringify({ kind: 'transport-outcome-unknown' })); throw Error('Transport failed; no retry') }
    if (!response.ok) {
      const detail = (await response.text()).replaceAll(apiKey, '[redacted]').replaceAll(profile.endpoint, '[private-service]')
      await writeFile(resolve(output, id + '.failure.json'), JSON.stringify({ kind: 'provider-rejected', status: response.status, detail }))
      throw Error('Provider rejected evaluation; no retry')
    }
    const json = await response.json()
    const raw = json.choices?.[0]?.message?.content
    const finishReason = json.choices?.[0]?.finish_reason
    await writeFile(resolve(output, id + '.response.json'), JSON.stringify({ raw, finishReason, usage: json.usage }, null, 2))
    if (typeof raw !== 'string') throw Error('Missing response; no retry')
    console.log(`evaluation ${id} preserved`)
    return { raw, finishReason }
  }
  const cases = [['large-complete', large, null], ['small-complete', small, null], ['small-window-stress', small, 3600]].filter(([name]) => !process.env.REFERENCE_CAPACITY_SMALL_ONLY || name !== 'large-complete')
  for (const [name, source, inputLimit] of cases) {
    const before = count
    try {
      const answers = await runAdaptiveReferenceRequestsV1({ source, inputLimit, messages, invoke })
      const global = answers.length === 1 ? answers[0].raw : await reviewReferenceAcrossBatchesV1({ answers, inputLimit, invoke,
        messages: selection => buildReferenceCrossRangeMessagesV1(selection, ['characterCraft', 'plotStructure']),
      })
      const final = JSON.parse(global)
      if (Object.keys(final).join('|') !== 'characterCraft|plotStructure' || !Object.values(final).every(value => typeof value === 'string' && value.trim())) throw Error('Final protocol failed; raw answers retained')
      const result = { name, sourceHash: hash(source), calls: count - before,
        inputLimit, limitEvidence: inputLimit == null ? 'complete-request/no-injected-limit' : 'controlled-stress-injection/not-real-service-limit',
        completeCoverage: answers.map(a => a.selection.part).join('') === source,
        leafAnswers: answers, global: final,
      }
      await writeFile(resolve(output, name + '.result.json'), JSON.stringify(result, null, 2))
      evidence.push({ name, outcome: 'returned', calls: result.calls, completeCoverage: result.completeCoverage, sourceHash: result.sourceHash })
    } catch (error) {
      evidence.push({ name, outcome: 'failed', calls: count - before, error: error.message })
      await writeFile(resolve(output, name + '.failure.json'), JSON.stringify(evidence.at(-1), null, 2))
      throw error
    }
  }
} finally {
  await writeFile(resolve(output, 'index.json'), JSON.stringify({ kind: 'reference-capacity-eval-only', calls: count, sourceHashes, evidence }, null, 2))
  await server.close()
}
