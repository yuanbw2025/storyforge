// Eval only: original fixed fixtures; no author DB, adoption, hidden retries or provider switching.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import ts from 'typescript'
import { assertPreparationWorldviewEvalEntry as assertOfflineReferenceEntry, PREPARATION_WORLDVIEW_MAX_CALLS as REFERENCE_QUALITY_MAX_CALLS } from './preparation-worldview-contract.mjs'
const output = process.argv[2]
const root = await realpath(process.cwd())
if (!output || !isAbsolute(output) || ((await realpath(resolve(output, '..'))) === root || (await realpath(resolve(output, '..'))).startsWith(root + '/')) || resolve(output) === root) throw Error('Use a new absolute directory outside checkout')
const registry = JSON.parse(await readFile('src/lib/agent/ai-entry-registry.json', 'utf8'))
assertOfflineReferenceEntry(registry)
const local = await import(pathToFileURL(join(process.env.STORYFORGE_LOCAL_API_HOME || join(homedir(), '.config/storyforge/api'), 'lib/local-api.mjs')).href)
const { profile, apiKey } = local.loadProfile(process.argv[3] || 'agnes-primary', { purpose: 'comparison' })
const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
/** @param {Parameters<import('node:crypto').Hash['update']>[0]} value */
const hash = value => createHash('sha256').update(value).digest('hex')
let calls = 0
try {
  await mkdir(output, { recursive: false })
  // Extract only the production prompt builder: importing the copilot would initialize browser stores.
  /** @type {Array<{field:string, aiGeneration:{label:string, maxChars:number}}>} */
  const specs = (await server.ssrLoadModule('/src/lib/registry/field-registry.ts')).WORLDVIEW_GENERATABLE_FIELD_SPECS
  const { worldviewFieldContentGuidanceV1 } = await server.ssrLoadModule('/src/lib/creation/worldview-content-skill.ts')
  const WORLDVIEW_AGENT_FIELD_CAPABILITIES = new Map(specs.map(spec => [spec.field, spec.aiGeneration]))
  const WORLDVIEW_AGENT_FIELD_LABELS = Object.fromEntries(specs.map(spec => [spec.field, spec.aiGeneration.label]))
  const current = await readFile('src/lib/agent/worldview-field-copilot.ts', 'utf8')
  const instructions = current.slice(current.indexOf('const MODE_INSTRUCTIONS:'), current.indexOf('\nexport class WorldviewFieldCopilotStaleError'))
  const builder = current.slice(current.indexOf('function outputContract('), current.indexOf('\nfunction buildWorldviewFieldMessages'))
  const buildWorldviewFieldHardSystemV1 = new Function('WORLDVIEW_AGENT_FIELD_CAPABILITIES', 'WORLDVIEW_AGENT_FIELD_LABELS', 'worldviewFieldContentGuidanceV1', ts.transpile(instructions + '\n' + builder) + ';return worldviewFieldHardSystem')(WORLDVIEW_AGENT_FIELD_CAPABILITIES, WORLDVIEW_AGENT_FIELD_LABELS, worldviewFieldContentGuidanceV1)
  const { SYSTEM_PROMPT_SEEDS } = await server.ssrLoadModule('/src/lib/ai/prompt-seeds.ts')
  const { renderPrompt: renderLibraryPrompt } = await server.ssrLoadModule('/src/lib/ai/prompt-engine.ts')
  const { worldviewContentTemplateVariablesV1 } = await server.ssrLoadModule('/src/lib/creation/worldview-content-skill.ts')
  /** @param {{targetField:string, projectName:string}} input */
  const buildWorldviewFieldSystemV1 = input => [
    ...renderLibraryPrompt(SYSTEM_PROMPT_SEEDS.find((/** @type {{moduleKey:string}} */ seed) => seed.moduleKey === 'worldview.dimension'), {
      ...worldviewContentTemplateVariablesV1(input.targetField), projectName: input.projectName,
      dimension: WORLDVIEW_AGENT_FIELD_LABELS[input.targetField], worldContext: '', existingWorldview: '', userHint: '',
    }).messages.filter((/** @type {{role:string,content:string}} */ message) => message.role === 'system').map((/** @type {{content:string}} */ message) => message.content),
    buildWorldviewFieldHardSystemV1(input),
  ].join('\n\n')
  const { parseStructuredOutputV1 } = await server.ssrLoadModule('/src/lib/agent/structured-output-pipeline.ts')
  const parserSource = current.slice(current.indexOf('function exactKeys('), current.indexOf('\nfunction sameValue(')).replace('export function parseWorldviewFieldCandidateDraft', 'function parseWorldviewFieldCandidateDraft')
  const parseCandidate = new Function('WORLDVIEW_AGENT_FIELDS', 'WORLDVIEW_AGENT_FIELD_CAPABILITIES', 'WORLDVIEW_FIELD_CANDIDATE_MAX_CHARS_V1', 'parseStructuredOutputV1', ts.transpile(parserSource) + ';return parseWorldviewFieldCandidateDraft')(specs.map(spec => spec.field), WORLDVIEW_AGENT_FIELD_CAPABILITIES, Math.max(...specs.map(spec => spec.aiGeneration.maxChars)) + 10000, parseStructuredOutputV1)
  const baseline = JSON.parse(await readFile('tests/fixtures/preparation-worldview/baseline-system-source.json', 'utf8'))
  const oldBuilder = new Function('WORLDVIEW_AGENT_FIELD_CAPABILITIES', 'WORLDVIEW_AGENT_FIELD_LABELS', ts.transpile(baseline.modeInstructions + '\n' + baseline.source) + ';return worldviewFieldHardSystem')(WORLDVIEW_AGENT_FIELD_CAPABILITIES, WORLDVIEW_AGENT_FIELD_LABELS)
  const sourceHashes = Object.fromEntries(await Promise.all(['src/lib/creation/worldview-content-skill.ts', 'src/lib/agent/worldview-field-copilot.ts', 'tests/fixtures/preparation-worldview/cases.json'].map(async p => [p, hash(await readFile(p))])))
  const worldEntriesStudy = process.env.PREPARATION_EVAL_STUDY === 'world-entries'
  const worldEntries = worldEntriesStudy ? await (await import('./preparation-world-entry-evaluation.mjs')).createWorldEntryEvaluationRuntime(server) : null
  const positioningStudy = process.env.PREPARATION_EVAL_STUDY === 'positioning'
  const inspirationStudy = positioningStudy || process.env.PREPARATION_EVAL_STUDY === 'inspiration'
  const editorialStudy = process.env.PREPARATION_EVAL_STUDY === 'editorial'
  const preparation = inspirationStudy ? await server.ssrLoadModule('/src/lib/inspiration/preparation.ts') : null
  function preparationRuntime() {
    if (!preparation) throw Error('Inspiration evaluation runtime unavailable')
    return preparation
  }
  const { TOOL_PROMPT_SEEDS } = (inspirationStudy || editorialStudy) ? await server.ssrLoadModule('/src/lib/ai/prompt-seeds-tools.ts') : { TOOL_PROMPT_SEEDS: [] }
  const { renderPrompt } = (inspirationStudy || editorialStudy) ? await server.ssrLoadModule('/src/lib/ai/prompt-engine.ts') : { renderPrompt: null }
  const positioningBaseline = positioningStudy ? JSON.parse(await readFile('tests/fixtures/preparation-worldview/baseline-positioning.json', 'utf8')) : null
  const inspirationBaseline = TOOL_PROMPT_SEEDS.find((/** @type {{moduleKey:string}} */ seed) => seed.moduleKey === 'inspiration.reverse')
  const fixture = worldEntriesStudy ? 'tests/fixtures/preparation-worldview/world-entry-cases.json' : positioningStudy ? (process.env.PREPARATION_EVAL_HOLDOUT === '1' ? 'tests/fixtures/preparation-worldview/positioning-holdout.json' : 'tests/fixtures/preparation-worldview/positioning-cases.json') : editorialStudy ? 'tests/fixtures/preparation-worldview/editorial-cases.json' : inspirationStudy ? 'tests/fixtures/preparation-worldview/inspiration-cases.json' : 'tests/fixtures/preparation-worldview/cases.json'
  if (inspirationStudy) {
    sourceHashes['src/lib/inspiration/preparation.ts'] = hash(await readFile('src/lib/inspiration/preparation.ts'))
    sourceHashes[fixture] = hash(await readFile(fixture))
    if (positioningStudy) sourceHashes['tests/fixtures/preparation-worldview/baseline-positioning.json'] = hash(await readFile('tests/fixtures/preparation-worldview/baseline-positioning.json'))
    await writeFile(join(output, 'baseline-inspiration-template.json'), JSON.stringify(positioningStudy ? positioningBaseline : inspirationBaseline, null, 2))
  }
  const editorialBaseline = editorialStudy ? JSON.parse(await readFile('tests/fixtures/preparation-worldview/baseline-style-research.json', 'utf8')) : null
  const editorial = editorialStudy ? await server.ssrLoadModule('/src/lib/creation/preparation-content-skill.ts') : null
  const styleSource = editorialStudy ? await readFile('src/lib/style/learning-agent.ts', 'utf8') : ''
  const parseStyle = editorialStudy ? new Function(ts.transpile(
    styleSource.slice(styleSource.indexOf('const REQUIRED_HEADINGS ='), styleSource.indexOf('\n', styleSource.indexOf('const REQUIRED_HEADINGS =')))
    + '\n' + styleSource.slice(styleSource.indexOf('export function parseStyleLearningResultStrictV1'), styleSource.indexOf('\nexport function styleLearningTargetStateV1')).replace('export function ', 'function '),
  ) + ';return parseStyleLearningResultStrictV1')() : null
  const { CORE_PROMPT_SEEDS } = editorialStudy ? await server.ssrLoadModule('/src/lib/ai/prompt-seeds-core.ts') : { CORE_PROMPT_SEEDS: [] }
  if (editorialStudy) {
    for (const p of ['src/lib/creation/preparation-content-skill.ts', 'src/lib/style/learning-agent.ts', 'src/lib/ai/prompt-seeds-tools.ts', 'src/lib/ai/prompt-seeds-core.ts', fixture, 'tests/fixtures/preparation-worldview/baseline-style-research.json']) sourceHashes[p] = hash(await readFile(p))
  }
  /**
   * @param {(typeof import('../tests/fixtures/preparation-worldview/editorial-cases.json'))[number]} c
   * @param {'old'|'new'} variant
   */
  function editorialMessages(c, variant) {
    if (!editorial) throw Error('Editorial evaluation runtime unavailable')
    const templates = variant === 'old' ? editorialBaseline.seeds : [...TOOL_PROMPT_SEEDS, ...CORE_PROMPT_SEEDS]
    const template = templates.find((/** @type {{moduleKey:string}} */ seed) => seed.moduleKey === c.module)
    let messages = renderPrompt(template, { ...c.vars, ...(variant === 'new' && c.kind === 'research' ? { [`research_${c.mode}_${c.hasSources ? 'sources' : 'empty'}`]: '1' } : {}) }).messages
    if (c.kind === 'learn') messages = editorial.appendPreparationSystemGuidance(messages, editorialBaseline.styleProtocol)
    if (c.kind === 'rules') messages.push({ role: 'user', content: '本轮只建议writingStyle，不写其它字段。只输出严格JSON：{"field":"writingStyle","value":"规则正文"}。' })
    return messages
  }
  if (worldEntriesStudy) {
    for (const p of [fixture, 'scripts/preparation-world-entry-evaluation.mjs', 'tests/fixtures/preparation-worldview/baseline-world-entry-sources.json', 'src/lib/creation/world-entry-content-skill.ts', 'src/lib/ai/inspiration-reverse.ts', 'src/lib/ai/world-group-ai.ts', 'src/lib/history/ai-plan.ts', 'src/lib/ai/adapters/structured-extract-adapter.ts', 'src/lib/ai/world-rules-manifest.ts', 'src/lib/ai/prompt-seeds-tools.ts']) sourceHashes[p] = hash(await readFile(p))
  }
  const allCases = JSON.parse(await readFile(fixture, 'utf8'))
  for (const p of ['src/lib/ai/prompt-seeds-preparation.ts', 'src/lib/ai/prompt-seeds-content-methods.ts', 'src/lib/ai/prompt-seeds-core.ts', 'src/lib/ai/prompt-seeds-tools.ts']) sourceHashes[p] = hash(await readFile(p))
  const selectedIds = process.env.PREPARATION_EVAL_CASES?.split(',')
  if (selectedIds?.some(id => !allCases.some((/** @type {{id:string}} */ c) => c.id === id))) throw Error('Unknown case selection')
  const cases = selectedIds ? allCases.filter((/** @type {{id:string}} */ c) => selectedIds.includes(c.id)) : allCases
  /**
   * @param {string} id
   * @param {Array<{role:'system'|'user'|'assistant', content:string}>} messages
   * @param {number} maxTokens
   */
  async function request(id, messages, maxTokens, structured = false) {
    if (calls > 0) await new Promise(done => setTimeout(done, 8000))
    if (++calls > REFERENCE_QUALITY_MAX_CALLS) throw Error('Call cap exceeded')
    const body = { ...profile.api.chat.requestDefaults, model: profile.modelOrCapability, messages, ...(structured ? { response_format: { type: 'json_object' } } : {}), ...(profile.modelOrCapability === 'agnes-2.5-flash' ? { chat_template_kwargs: { enable_thinking: false } } : {}), stream: false, temperature: 0.3, max_tokens: maxTokens }
    const started = Date.now()
    // Persist the request before transport so unknown results retain their comparison inputs.
    await writeFile(join(output, id + '.request.json'), JSON.stringify({ id, model: body.model, messages, temperature: body.temperature, maxTokens, responseFormat: body.response_format ?? null, thinkingParameters: body.chat_template_kwargs ?? null, promptHash: hash(JSON.stringify(messages)) }, null, 2))
    let response
    try { response = await fetch(profile.endpoint.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }) }
    catch { await writeFile(join(output, id + '.failure.json'), JSON.stringify({ error: 'transport-unknown', elapsedMs: Date.now() - started })); throw Error('Transport unknown; stopped without retry') }
    if (!response.ok) { await writeFile(join(output, id + '.failure.json'), JSON.stringify({ status: response.status, retryAfter: response.headers.get('retry-after'), stoppedWithoutRetry: true })); throw Error('HTTP ' + response.status + '; stopped without retry') }
    const data = await response.json(), text = data.choices?.[0]?.message?.content
    await writeFile(join(output, id + '.json'), JSON.stringify({ id, model: body.model, text, usage: data.usage, finishReason: data.choices?.[0]?.finish_reason, elapsedMs: Date.now() - started }, null, 2))
    if (typeof text !== 'string' || !text.trim() || data.choices?.[0]?.finish_reason !== 'stop') throw Error('Incomplete result retained; no retry')
    console.log(id + ' saved')
    return text
  }
  for (const [index, c] of cases.entries()) {
    const input = { targetField: c.field, mode: 'create', snapshot: { foundationState: c.context ? 'partial' : 'empty' }, projectName: '原创评测' }
    /** @type {Record<string,string>} */
    const materials = {}
    for (const variant of /** @type {Array<'old'|'new'>} */ (index % 2 ? ['new', 'old'] : ['old', 'new'])) {
      const system = (inspirationStudy || editorialStudy || worldEntriesStudy) ? '' : variant === 'old' ? oldBuilder(input) : buildWorldviewFieldSystemV1(input)
      if (worldEntries && c.kind === 'manifest') {
        materials[variant] = worldEntries.build(c, variant)
        await writeFile(join(output, c.id + '-' + variant + '.json'), JSON.stringify({ id: c.id + '-' + variant, kind: 'derived-manifest', model: null, text: materials[variant] }, null, 2))
        console.log(c.id + '-' + variant + ' derived without model')
        continue
      }
      const messages = worldEntries ? worldEntries.build(c, variant) : editorialStudy ? editorialMessages(c, variant) : inspirationStudy
        ? variant === 'new' ? preparationRuntime().buildInspirationPreparationPrompt(c.mode, c.context, c.request)
          : positioningStudy ? renderPrompt(positioningBaseline.seed, { ...c.oldVars, userHint: c.request }).messages
            : renderPrompt(inspirationBaseline, { projectName: '原创评测', genres: '', inspiration: c.context, userHint: c.request }).messages
        : [{ role: 'system', content: system }, { role: 'user', content: '【作者要求】\n' + c.request + '\n【正式上下文】\n' + (c.context || '无') }]
      materials[variant] = await request(c.id + '-' + variant, messages, 6000, !worldEntriesStudy && !positioningStudy && (!editorialStudy || c.kind === 'rules'))
    }
    let pairValid = true
    for (const variant of /** @type {const} */ (['old', 'new'])) {
      const raw = materials[variant].trim().replace(/^```json\s*|\s*```$/g, '')
      try { if (worldEntries) {
        const parsed = worldEntries.validate(c, materials[variant])
        const normalized = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
        if (c.kind !== 'manifest') await writeFile(join(output, c.id + '-' + variant + '.candidate.json'), JSON.stringify({ parser: 'current-production', text: normalized, originalResponseRetained: true }, null, 2))
        materials[variant] = normalized
      } else if (editorialStudy) { if (c.kind === 'rules') { const parsed = JSON.parse(raw); if (parsed.field !== 'writingStyle' || typeof parsed.value !== 'string') throw Error() } else if (c.kind === 'learn') parseStyle(raw); else if (!raw.trim()) throw Error() } else if (inspirationStudy) { if (variant === 'new') preparationRuntime().parseInspirationPreparationDraft(raw, c.mode); else if (positioningStudy) { if (!raw.trim()) throw Error() } else { const parsed = JSON.parse(raw); if (!parsed.worldview || !parsed.storyCore || !Array.isArray(parsed.characters)) throw Error() } } else { const parsed = parseCandidate(raw); if (parsed.field !== c.field) throw Error() } }
      catch (error) { await writeFile(join(output, c.id + '-' + variant + '.validation-failure.json'), JSON.stringify({ error: 'invalid-candidate', reason: error instanceof Error ? error.message : 'Unknown parse failure', originalRetained: true })); pairValid = false; console.log(c.id + '-' + variant + ' invalid; retained without repair') }
    }
    if (!pairValid || !c.apply) continue // Other fixed cases remain independent; no retry of an invalid candidate.
    // Same downstream instruction, whole material, equal output allowance; no instruction confound.
    for (const variant of /** @type {const} */ (['old', 'new'])) await request(c.id + '-apply-' + variant, [{ role: 'system', content: worldEntriesStudy && (c.kind === 'history' || c.kind === 'manifest') ? '你是小说资料编辑。只完成本次准备笔记任务，材料状态与创作提议分开，不声称已执行检索。' : '你是小说作者。按任务写场景，设定是候选材料，不能擅自改动作者明确规则；不要附分析。' }, { role: 'user', content: c.apply + '\n【准备材料】\n' + materials[variant] }], 1600)
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ study: worldEntriesStudy ? 'world-entries' : positioningStudy ? 'positioning' : editorialStudy ? 'editorial' : inspirationStudy ? 'inspiration' : 'worldview', calls, ...(worldEntries ? { evaluationCompilerTarget: worldEntries.compilerTarget } : {}), selectedCaseIds: cases.map((/** @type {{id:string}} */ c) => c.id), model: profile.modelOrCapability, baselineCommit: worldEntries ? worldEntries.baselineCommit : positioningStudy ? positioningBaseline.commit : editorialStudy ? editorialBaseline.commit : baseline.commit, sourceHashes, limitations: 'Exploratory developer reading; no human author/reader study; single sample per condition; no literary or market guarantee.' }, null, 2))
} finally { await server.close() }
