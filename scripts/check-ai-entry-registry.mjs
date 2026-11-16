/* global console, process */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  createStaticBindingResolver, staticCallArguments, staticPropertyKey, staticTransportKind, unwrapStaticExpression,
} from './static-guard-bindings.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registryPath = 'src/lib/agent/ai-entry-registry.json'
const registry = JSON.parse(fs.readFileSync(path.join(root, registryPath), 'utf8'))
const failures = []

// Offline evaluation runners do not enter the application's UI/Harness or
// own a creative-data writer. Keep their explicit, non-adopting boundary in
// this same registry instead of silently exempting a new raw model entry.
const offlineIds = new Set()
for (const entry of registry.offlineEvaluations ?? []) {
  if (!entry.entryId?.startsWith('eval.') || offlineIds.has(entry.entryId)
    || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || !['local-codex-subscription', 'configured-chat-audio-input-v1'].includes(entry.transport) || !entry.reason
    || !/^scripts\/evaluate-[a-z-]+\.mjs$/.test(entry.caller ?? '')
    || !/^scripts\/[a-z-]+-contract\.mjs$/.test(entry.contract ?? '')
    || !fs.existsSync(path.join(root, entry.caller ?? '')) || !fs.existsSync(path.join(root, entry.contract ?? ''))) {
    failures.push('离线评测入口边界无效: ' + entry.entryId)
    continue
  }
  offlineIds.add(entry.entryId)
  const caller = fs.readFileSync(path.join(root, entry.caller), 'utf8')
  const contract = fs.readFileSync(path.join(root, entry.contract), 'utf8')
  const bound = entry.transport === 'local-codex-subscription'
    ? caller.includes('assertOfflineEntry()') && caller.includes('runtime.generate(')
    : caller.includes('assertOfflineAudioEntry()') && caller.includes('calibrateAudioInputs(')
  if (!contract.includes(`'${entry.entryId}'`) || !bound) failures.push('离线评测缺少实际合同绑定: ' + entry.entryId)
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(file, acc)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) acc.push(file)
  }
  return acc
}

/** @param {ts.Node | undefined} node @returns {string[]} */
function literalStrings(node) {
  node = unwrapStaticExpression(node)
  if (!node) return []
  if (ts.isStringLiteralLike(node)) return [node.text]
  if (ts.isConditionalExpression(node)) {
    return [...literalStrings(node.whenTrue), ...literalStrings(node.whenFalse)]
  }
  return []
}

/** @param {ts.Node | undefined} node @param {string} name */
function objectProperty(node, name) {
  node = unwrapStaticExpression(node)
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined
  const property = node.properties.find(item => (
    ts.isPropertyAssignment(item) && staticPropertyKey(item.name) === name
  ))
  return /** @type {ts.PropertyAssignment | undefined} */ (property)?.initializer
}

function lineOf(ast, node) {
  return ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
}

/** @param {string} source */
export function analyzeAIEntrySource(source, file = 'entry.tsx') {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const bindings = createStaticBindingResolver(ast)
  const formalModule = 'src/lib/agent/formal-ai-entry'
  /** @type {Array<{ entryId: string, file: string }>} */
  const transports = []
  /** @type {Array<{ entryId: string, file: string, line: number, categories: string[] }>} */
  const calls = []
  /** @type {string[]} */
  const violations = []

  /**
   * @param {import('./static-guard-bindings.mjs').StaticOrigin} origin
   * @param {import('./static-guard-bindings.mjs').StaticSegment[]} segments
   */
  function classify(origin, segments) {
    const transport = staticTransportKind(bindings, origin, segments)
    if (transport) return transport === 'hook-start' ? transport : 'raw'
    if (origin.kind === 'local') {
      return file.startsWith('scripts/ttrpg-local-tts/') && origin.name === 'assertVoiceTransport'
        && segments.length === 0 ? 'limited-voice' : null
    }
    if (origin.kind !== 'import' || segments.length !== 1) return null
    const member = segments[0].key
    if (origin.module === formalModule) {
      if (member === 'executeRegisteredAIEntryV1') return 'registered'
      if (member === 'executeFrozenFormalAIEntryV1') return 'frozen'
      if (member === 'executeFrozenFormalAudioEntryV1') return 'frozen-audio'
      if (member === 'streamRegisteredAIEntryV1' && file !== 'src/hooks/useAIStream.ts') return 'hook-start'
    }
    if (member === 'assertVoiceTransport' && ['src/lib/longform-voice/contract', 'src/lib/agent/limited-ai-transport'].includes(origin.module)) {
      return 'limited-voice'
    }
    return null
  }

  /**
   * @param {ts.CallExpression} node
   * @param {ts.Node | undefined} entryNode
   * @param {ts.Node | undefined} metaNode
   * @param {ts.Node | undefined} [callerNode]
   */
  function registerGovernedCall(node, entryNode, metaNode, callerNode, callerRequired = false) {
    const entryIds = literalStrings(entryNode)
    const categoryNode = objectProperty(metaNode, 'category')
    const categories = literalStrings(categoryNode)
    if (entryIds.length !== 1) {
      violations.push(`${file}:${lineOf(ast, node)} 正式 AI 调用必须使用单一字面量 entryId`)
      return
    }
    if (categories.length === 0 && categoryNode) categories.push('*')
    if (categories.length === 0) {
      violations.push(`${file}:${lineOf(ast, node)} 正式 AI 调用缺少可机验 category`)
      return
    }
    if (callerRequired) {
      const callers = literalStrings(callerNode)
      if (callers.length !== 1 || callers[0] !== file) {
        violations.push(`${file}:${lineOf(ast, node)} 冻结正式 AI 调用必须用等于真实文件路径的单一 caller 字面量`)
        return
      }
    }
    calls.push({ file, line: lineOf(ast, node), entryId: entryIds[0], categories })
  }

  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const detected = new Set()
      for (const origin of bindings.resolve(node.expression)) {
        const { segments, args } = staticCallArguments(origin, node)
        const role = classify(origin, segments)
        if (!role) continue
        // Conditional aliases can resolve to the same executor with different
        // bound authority arguments. Coalesce identical proof inputs, not roles.
        const proof = role === 'registered' ? [args[0], args[3]]
          : role === 'frozen' ? [args[0], args[3], args[6]]
          : role === 'frozen-audio' ? [args[0], args[3], args[5]]
          : role === 'limited-voice' ? [args[0], args[1]]
          : role === 'hook-start' ? [args[2]] : []
        const key = JSON.stringify([role, ...proof.map(value => value?.getText(ast) ?? null)])
        if (detected.has(key)) continue
        detected.add(key)
        if (role === 'raw') {
          const ambiguity = origin.uncertainMutable ? '（可变别名仍可能指向此入口）' : ''
          violations.push(`${file}:${lineOf(ast, node)} 禁止 member/namespace 或别名绕过集中执行器调用 ${node.expression.getText(ast)}()${ambiguity}`)
        } else if (role === 'limited-voice') {
          const ids = literalStrings(args[0])
          const callers = literalStrings(args[1])
          if (ids.length !== 1 || callers.length !== 1 || callers[0] !== file) {
            violations.push(`${file}:${lineOf(ast, node)} 有限语音入口必须绑定字面量 entryId 和真实 caller`)
          } else transports.push({ entryId: ids[0], file })
        } else if (role === 'registered') {
          registerGovernedCall(node, args[0], args[3])
        } else if (role === 'frozen' || role === 'frozen-audio') {
          registerGovernedCall(node, args[0], args[role === 'frozen' ? 6 : 5], args[3], true)
        } else {
          registerGovernedCall(node, objectProperty(args[2], 'formalEntryId'), args[2])
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { calls, transports, violations }
}

if (registry.version !== 2 || registry.bindingVersion !== 1
  || registry.scope !== 'formal-ai-execution-entry' || !Array.isArray(registry.entries)) {
  failures.push(`${registryPath}: 版本、bindingVersion、scope 或 entries 无效`)
}

const skillSource = fs.readFileSync(path.join(root, 'src/lib/agent/skill-registry.ts'), 'utf8')
const skillIds = new Set([...skillSource.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]))
const registered = new Map()
for (const entry of registry.entries ?? []) {
  if (!entry?.entryId || registered.has(entry.entryId) || offlineIds.has(entry.entryId)) {
    failures.push(`${registryPath}: 重复或无效 entryId ${String(entry?.entryId)}`)
    continue
  }
  if (!skillIds.has(entry.skillId)) failures.push(`${entry.entryId}: 未知 Skill ${String(entry.skillId)}`)
  if (!Array.isArray(entry.categories) || entry.categories.length === 0) failures.push(`${entry.entryId}: 缺少 categories`)
  if (!Array.isArray(entry.allowedCallers) || entry.allowedCallers.length === 0) failures.push(`${entry.entryId}: 缺少 allowedCallers`)
  if (!entry.runContractBuilderId || !entry.candidateKind || !entry.reason) failures.push(`${entry.entryId}: 执行/候选/理由不完整`)
  if (entry.adoptAllowed === false && (entry.adoptionTargets?.length ?? 0) > 0) failures.push(`${entry.entryId}: 未授权采纳却声明写目标`)
  if (['auxiliary', 'evaluation', 'experimental'].includes(entry.entryKind) && entry.adoptAllowed !== false) {
    failures.push(`${entry.entryId}: ${entry.entryKind} 必须机器声明 adoptAllowed=false`)
  }
  registered.set(entry.entryId, entry)
}

const actualCalls = []
const actualTransports = []
const scannedFiles = [
  ...['src/components', 'src/hooks', 'src/pages', 'src/lib/generation', 'src/lib/outline'].flatMap(dir => walk(dir)),
  // DETAIL-1: this service is itself a formal generation entry and must not
  // remain outside the UI/generation scanners merely because it predates them.
  'src/lib/ai/batch-detail-runner.ts',
  // Q07/Q08: step and node review/revision share this formal provider service.
  'src/lib/prose/quality-transport.ts',
  // The independently-integrated Node producer must obey the same literal
  // entry/category/physical-caller gate once its module exists. A registered
  // entry without any real call remains an error below, including a missing module.
  ...(fs.existsSync(path.join(root, 'src/lib/node-authoring/field-producer.ts'))
    ? ['src/lib/node-authoring/field-producer.ts'] : []),
  'src/lib/ai-town/consultation.ts',
  // CHAT-01: source suggestions remain read-only; role profiles require explicit governed adoption.
  'src/lib/character-interaction/source-review-harness.ts',
  'src/lib/character-interaction/role-profile-harness.ts',
  'src/lib/character-interaction/source-units-harness.ts',
  'src/lib/character-interaction/source-unit-confirmation-harness.ts',
  'src/lib/character-interaction/consultation-harness.ts',
  // G5-02 creator consultation is a formal durable service rather than a UI
  // hook; keep its literal entry/category binding under the same machine gate.
  'src/lib/reference-analysis/pipeline.ts',
  // Import candidate transport is governed even though its owner is not a UI component.
  'src/lib/import/document-parse-durable.ts',
  'src/lib/open-world/creator-brief.ts',
  // G5-06 Creator Artifact Agent edits are a formal durable service; direct
  // edits share its candidate pipeline but never cross this AI entry.
  'src/lib/open-world/creator-artifact-edit.ts',
  // G6-01 owns the only frozen provider gateway for all six vNext open-world
  // runtime AI skills. Later UI work must call this governed service.
  'src/lib/open-world/runtime-ai-execution.ts',
  // Open TTRPG has its own actor-scoped, one-send governed transport boundary.
  'src/lib/ttrpg/open-intent-harness.ts',
  // S2 author proposals use their own frozen Work-owned request and raw receipt.
  'src/lib/ttrpg/open-authoring-design-harness.ts',
  'src/lib/ttrpg/open-voice-execution.ts',
  // Fixed-fixture offline speech evaluation is a limited transport, never a
  // creative binding or an application/provider fallback.
  'scripts/ttrpg-local-tts/evaluate.mjs',
  'scripts/ttrpg-local-tts/timbre-evaluate.mjs',
  'scripts/ttrpg-local-tts/native-voice-evaluate.mjs',
  // G6-10's independent semantic grader is an eval-only formal model entry.
  // It may judge redacted observations, but can never adopt product content.
  'src/lib/evals/open-world-runtime/judge.ts',
  // G7-11's independent release calibrator is an explicit paid eval-only call.
  // Its output may only become Build-bound quality evidence.
  'src/lib/open-world/creator-quality-calibration.ts',
  ...walk('src/lib/longform-voice'),
  ...walk('src/lib/extensions'),
]
for (const file of [...new Set(scannedFiles)]) {
    if (file === 'src/lib/agent/formal-ai-entry.ts') continue
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const analysis = analyzeAIEntrySource(source, file)
    actualCalls.push(...analysis.calls)
    actualTransports.push(...analysis.transports)
    failures.push(...analysis.violations)
}

const used = new Set()
const limited = new Map()
for (const entry of registry.limitedTransports ?? []) {
  if (!entry.entryId || registered.has(entry.entryId) || limited.has(entry.entryId)
    || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || !['ephemeral-author-input', 'ephemeral-player-input', 'read-only-audio', 'offline-fixture-audio-eval'].includes(entry.boundary)
    || !entry.allowedCallers?.length || !entry.reason) {
    failures.push('有限语音入口边界无效: ' + entry.entryId)
  }
  if (entry.boundary === 'offline-fixture-audio-eval'
    && entry.allowedCallers.some(caller => !/^scripts\/ttrpg-local-tts\/[a-z-]+\.mjs$/.test(caller))) {
    failures.push('离线语音评测不能成为产品入口: ' + entry.entryId)
  }
  limited.set(entry.entryId, entry)
}
for (const call of actualTransports) {
  if (!limited.get(call.entryId)?.allowedCallers.includes(call.file)) failures.push('未登记的有限语音调用: ' + call.entryId)
}
for (const entry of limited.values()) {
  for (const caller of entry.allowedCallers) {
    if (!actualTransports.some(call => call.entryId === entry.entryId && call.file === caller)) failures.push('语音入口缺少真实绑定: ' + entry.entryId)
  }
}
for (const call of actualCalls) {
  const entry = registered.get(call.entryId)
  if (!entry) {
    failures.push(`${call.file}:${call.line} 使用未登记 entryId ${call.entryId}`)
    continue
  }
  used.add(call.entryId)
  if (!entry.allowedCallers.includes(call.file)) {
    failures.push(`${call.file}:${call.line} 不在 ${call.entryId}.allowedCallers`)
  }
  for (const category of call.categories) {
    if (!entry.categories.includes('*') && !entry.categories.includes(category)) {
      failures.push(`${call.file}:${call.line} 的 category ${category} 不属于 ${call.entryId}`)
    }
  }
}
for (const entryId of registered.keys()) {
  if (!used.has(entryId)) failures.push(`${entryId}: 注册表残留或真实调用点未携带该 entryId`)
}

// Scanner self-tests cover the historical blind spots: member, alias, namespace and wrapper.
const memberSelfTest = analyzeAIEntrySource(
  "import { useAIStream } from '../hooks/useAIStream'; const ai = useAIStream(); ai.start([], undefined, { category: 'x' });",
  'src/components/Self.tsx',
)
const voiceSelfTest = analyzeAIEntrySource(
  "import { assertVoiceTransport as guard } from './contract'; guard('voice', caller);",
  'src/lib/longform-voice/fake.ts',
)
if (!voiceSelfTest.violations.some(item => item.includes('有限语音'))) failures.push('守卫自测失败：未阻断伪造语音 caller')
if (!memberSelfTest.violations.some(item => item.includes('entryId'))) failures.push('守卫自测失败：未阻断缺 entryId 的 member start')
const aliasSelfTest = analyzeAIEntrySource(
  "import { useAIStream as useModel } from '../hooks/useAIStream'; const { start: run } = useModel(); run([], undefined, { category: 'x' });",
  'src/components/Alias.tsx',
)
if (!aliasSelfTest.violations.some(item => item.includes('entryId'))) failures.push('守卫自测失败：未阻断 alias start')
const wrapperSelfTest = analyzeAIEntrySource(
  "import { chat as ask } from '../lib/ai/client'; const invoke = x => ask(x, {}); invoke([]);",
  'src/components/Wrapper.tsx',
)
if (!wrapperSelfTest.violations.some(item => item.includes('集中执行器'))) failures.push('守卫自测失败：未阻断 raw wrapper')
const namespaceSelfTest = analyzeAIEntrySource(
  "import * as api from '../lib/ai/client'; api.chat([], {});",
  'src/components/Namespace.tsx',
)
if (!namespaceSelfTest.violations.some(item => item.includes('member/namespace'))) failures.push('守卫自测失败：未阻断 namespace member')
const frozenAliasSelfTest = analyzeAIEntrySource(
  "import { executeFrozenFormalAIEntryV1 as runFrozen } from '../lib/agent/formal-ai-entry'; runFrozen('x', snapshot, skill, caller, [], {}, { category: 'x' });",
  'src/lib/FrozenAlias.ts',
)
if (!frozenAliasSelfTest.violations.some(item => item.includes('caller 字面量'))) {
  failures.push('守卫自测失败：未阻断伪造 caller 的 frozen formal entry alias')
}
const audioAliasSelfTest = analyzeAIEntrySource(
  "import { executeFrozenFormalAudioEntryV1 as sendAudio } from '../lib/agent/formal-ai-entry'; sendAudio('x', snapshot, skill, caller, invoke, { category: 'x' });",
  'src/lib/AudioAlias.ts',
)
if (!audioAliasSelfTest.violations.some(item => item.includes('caller 字面量'))) failures.push('守卫自测失败：未阻断伪造 caller 的 frozen audio entry alias')
const audioNamespaceSelfTest = analyzeAIEntrySource(
  "import * as api from '../lib/agent/formal-ai-entry'; api.executeFrozenFormalAudioEntryV1('x', snapshot, skill, 'wrong.ts', invoke, { category: 'x' });",
  'src/lib/AudioNamespace.ts',
)
if (!audioNamespaceSelfTest.violations.some(item => item.includes('caller 字面量'))) failures.push('守卫自测失败：未阻断 namespace 音频 caller 冒用')
const audioMemberAliasSelfTest = analyzeAIEntrySource(
  "import * as api from '../lib/agent/formal-ai-entry'; const send = api['executeFrozenFormalAudioEntryV1']; send('x', snapshot, skill, 'src/lib/AudioMember.ts', invoke, { category: 'x' });",
  'src/lib/AudioMember.ts',
)
if (audioMemberAliasSelfTest.calls.length !== 1 || audioMemberAliasSelfTest.violations.length) failures.push('守卫自测失败：未识别 namespace member 音频 alias')

const equivalentEntrySelfTest = analyzeAIEntrySource(`
  import * as hooks from '../hooks/useAIStream'
  import * as transport from '../lib/ai/client'
  import { chat as rawChat } from '../lib/ai/client'
  import * as formal from '../lib/agent/formal-ai-entry'
  const client = transport
  client['chat']([], {})
  const { ['streamChat']: stream } = client
  const indirect = stream
  indirect([], {})
  const rawAlias = rawChat
  rawAlias([], {})
  const { start: begin } = hooks['useAIStream']()
  begin([], undefined, { category: 'x' })
  const running = hooks.useAIStream()
  const sender = running['start'].bind(running)
  sender([], undefined, { category: 'x' })
  const { ['executeRegisteredAIEntryV1']: admitted } = formal
  admitted('fixture.allowed', [], {}, { ['category']: 'x' })
  const partiallyBound = admitted.bind(formal, 'fixture.bound')
  partiallyBound([], {}, { category: 'x' })
  const runFrozen = formal['executeFrozenFormalAIEntryV1']
  runFrozen.call(formal, 'fixture.frozen', snapshot, skill, 'forged.ts', [], {}, { category: 'x' })
  const { streamRegisteredAIEntryV1: readStream } = formal
  readStream.apply(formal, [[], {}, { formalEntryId: 'fixture.stream', category: 'x' }])
`, 'src/components/EquivalentEntry.tsx')
if (equivalentEntrySelfTest.violations.filter(item => item.includes('集中执行器')).length !== 3
  || equivalentEntrySelfTest.violations.filter(item => item.includes('entryId')).length !== 2
  || equivalentEntrySelfTest.violations.filter(item => item.includes('caller 字面量')).length !== 1
  || equivalentEntrySelfTest.calls.map(call => call.entryId).join(',') !== 'fixture.allowed,fixture.bound,fixture.stream') {
  failures.push('守卫自测失败：等价导入/namespace/局部 alias/literal/解构调用识别失效')
}
const lexicalEntrySelfTest = analyzeAIEntrySource(`
  import { useAIStream as create, type UseAIStreamReturn as OwnedStream } from '../hooks/useAIStream'
  import { chat as raw } from '../lib/ai/client'
  type Alias = Pick<OwnedStream, 'start'>
  function allowed(input: { transport: Alias }) {
    const { transport } = input
    transport['start']([], undefined, { formalEntryId: 'fixture.typed', category: 'x' })
  }
  function unrelated(create, raw) {
    const harmless = create()
    harmless.start()
    raw()
  }
  const client = { chat() {}, streamChat() {}, start() {} }
  client.chat(); client['streamChat'](); client.start()
  // raw() is a comment, not an invocation.
  const text = "client.chat(); raw()"
  const chosen = 'start'; create()[chosen]([], {}, {})
`, 'src/components/LexicalEntry.tsx')
if (lexicalEntrySelfTest.violations.length || lexicalEntrySelfTest.calls.map(call => call.entryId).join(',') !== 'fixture.typed') {
  failures.push('守卫自测失败：作用域遮蔽、无关同名属性或登记类型入口被误判')
}

const alternateAuthoritySelfTest = analyzeAIEntrySource(`
  import { executeFrozenFormalAIEntryV1 as run } from '../lib/agent/formal-ai-entry'
  import { useAIStream as make } from '../hooks/useAIStream'
  const send = flag
    ? run.bind(null, 'fixture.authorized', snapshot, skill, 'src/components/BranchAuthority.tsx')
    : run.bind(null, 'fixture.authorized', snapshot, skill, 'forged.ts')
  send([], {}, { category: 'x' })
  function actual(ai: ReturnType<typeof make>) { ai.start([], undefined, {}) }
  function unrelated(make: () => { start: () => void }) {
    function innocent(ai: ReturnType<typeof make>) { ai.start() }
    innocent(make())
  }
`, 'src/components/BranchAuthority.tsx')
if (alternateAuthoritySelfTest.calls.map(call => call.entryId).join(',') !== 'fixture.authorized'
  || alternateAuthoritySelfTest.violations.length !== 2
  || !alternateAuthoritySelfTest.violations.some(item => item.includes('caller 字面量'))
  || !alternateAuthoritySelfTest.violations.some(item => item.includes('entryId'))) {
  failures.push('守卫自测失败：条件绑定权威或真实 Hook ReturnType 被漏检')
}

const mutableAliasSelfTest = analyzeAIEntrySource(`
  import { chat as raw } from '../lib/ai/client'
  function harmless() {}
  let local = raw
  local = harmless
  local([], {})
  let toRaw = harmless
  toRaw = raw
  toRaw([], {})
  let branch = harmless
  if (flag) branch = raw
  branch([], {})
  let opaque = raw
  opaque = resolveCallable()
  opaque([], {})
  function shadow(raw: () => void) {
    let alias = raw
    alias()
  }
`, 'src/components/MutableEntry.tsx')
if (mutableAliasSelfTest.violations.length !== 3
  || !mutableAliasSelfTest.violations.some(item => item.includes('toRaw()'))
  || !mutableAliasSelfTest.violations.some(item => item.includes('可变别名仍可能'))) {
  failures.push('守卫自测失败：可变别名顺序赋值或保守分支被误判')
}

const reassignmentBoundarySelfTest = analyzeAIEntrySource(`
  import { chat } from '../lib/ai/client'
  const local = () => {}
  let rebound = local
  rebound = chat
  rebound = rebound.bind(null)
  rebound([], {})
  let safe = chat
  safe = local
  safe = safe.bind(null)
  safe()
  let nextIteration = local
  for (const item of [0, 1]) { nextIteration([], {}); nextIteration = chat }
  let resetEveryIteration = chat
  for (const item of [0, 1]) { resetEveryIteration = local; resetEveryIteration(); resetEveryIteration = chat }
`, 'src/components/ReassignmentBoundary.tsx')
if (reassignmentBoundarySelfTest.violations.length !== 2
  || !reassignmentBoundarySelfTest.violations.some(item => item.includes('rebound()'))
  || !reassignmentBoundarySelfTest.violations.some(item => item.includes('nextIteration()'))) {
  failures.push('守卫自测失败：自绑定前值或循环再次进入的别名判断失效')
}

if (failures.length) {
  console.error('[ai-entry-registry] ❌ 正式 AI 入口机器绑定未闭合:\n')
  failures.forEach(failure => console.error(`  ${failure}`))
  process.exit(1)
}

const counts = { formal: 0, auxiliary: 0, evaluation: 0, experimental: 0 }
for (const entry of registered.values()) counts[entry.entryKind]++
console.log(
  `[ai-entry-registry] ok: ${registered.size} bindings / ${actualCalls.length} calls; `
  + `formal ${counts.formal}, auxiliary ${counts.auxiliary}, evaluation ${counts.evaluation}, experimental ${counts.experimental}`,
)
