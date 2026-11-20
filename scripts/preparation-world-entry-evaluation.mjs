// Pure evaluation composition. Transport and call budget remain in the registered evaluator.
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
/**
 * @typedef {{kind:'full', mode:'single'|'multiworld', args:{projectName:string, genres:string, inspiration:string, userHint:string}}
 * | {kind:'suggest'|'expand', context:unknown}
 * | {kind:'history', mode:string, context:unknown}
 * | {kind:'codex', operation:'extract'|'enrich', args:Record<string,unknown>, fields:unknown}
 * | {kind:'manifest', profile:{entries?:Record<string,{historicalAnchors?:string,fictionalAdaptations?:string}>}, options:unknown}} WorldEntryCase
 */
/** @param {import('vite').ViteDevServer} server */
export async function createWorldEntryEvaluationRuntime(server) {
  const baseline = JSON.parse(await readFile('tests/fixtures/preparation-worldview/baseline-world-entry-sources.json', 'utf8'))
  const [reverse, world, history, codex, manifest, ruleTypes, historyTypes, prompt, preparation, structured, workspace] = await Promise.all([
    '/src/lib/ai/inspiration-reverse.ts', '/src/lib/ai/world-group-ai.ts', '/src/lib/history/ai-plan.ts',
    '/src/lib/ai/adapters/structured-extract-adapter.ts', '/src/lib/ai/world-rules-manifest.ts',
    '/src/lib/types/world-rules.ts', '/src/lib/types/history.ts', '/src/lib/ai/prompt-engine.ts',
    '/src/lib/inspiration/preparation.ts', '/src/lib/agent/structured-output-pipeline.ts', '/src/lib/inspiration/workspace.ts',
  ].map(path => server.ssrLoadModule(path)))
  const stub = { getState: () => ({ getActive: (/** @type {string} */ key) => {
    const seed = baseline.seeds.find((/** @type {{moduleKey:string}} */ seed) => seed.moduleKey === key)
    if (!seed) throw Error('Missing frozen template: ' + key)
    return seed
  } }) }
  const oldCode = ts.transpile(Object.values(baseline.methods).join('\n').replace(/\bexport\s+/g, ''), { target: ts.ScriptTarget.ES2020 })
  const old = new Function('renderPrompt', 'usePromptStore', 'WORLD_RULE_TREE', 'CONFLICT_PRIORITY_LABELS', 'KEYWORD_CATEGORY_LABELS', oldCode + `;return {reverse:buildInspirationReversePrompt,multi:buildInspirationReverseMultiWorldPrompt,suggest:buildWorldSuggestPromptFromRegisteredContextV1,expand:buildWorldExpandPromptFromRegisteredContextV1,history:buildHistoryAgentMessagesV1,extract:buildCodexExtractPromptFromRegisteredContextV1,enrich:buildCodexEnrichPromptFromRegisteredContextV1,manifest:buildWorldRulesManifest}`)(prompt.renderPrompt, stub, ruleTypes.WORLD_RULE_TREE, ruleTypes.CONFLICT_PRIORITY_LABELS, historyTypes.KEYWORD_CATEGORY_LABELS)
  // The formal reverse parser is extracted without importing the browser AI config store.
  const source = await readFile('src/lib/agent/inspiration-copilot.ts', 'utf8')
  const ast = ts.createSourceFile('copilot.ts', source, ts.ScriptTarget.Latest, true)
  const names = new Set(['hasInspirationCandidateMaterialV1', 'parseResult', 'parseInspirationCandidateDraft'])
  const code = ast.statements.filter(s => ts.isFunctionDeclaration(s) && s.name && names.has(s.name.text)).map(s => s.getText(ast)).join('\n').replace(/\bexport\s+/g, '')
  const full = new Function('isInspirationPreparationMode', 'parseInspirationPreparationDraft', 'parseStructuredOutputV1', 'parseReverseOutput', 'parseReverseMultiWorldOutput', 'MAX_INSPIRATION_RESULT_CHARS', ts.transpile(code, { target: ts.ScriptTarget.ES2020 }) + ';return {parse:parseInspirationCandidateDraft, meaningful:hasInspirationCandidateMaterialV1}')(preparation.isInspirationPreparationMode, preparation.parseInspirationPreparationDraft, structured.parseStructuredOutputV1, reverse.parseReverseOutput, reverse.parseReverseMultiWorldOutput, workspace.MAX_INSPIRATION_RESULT_CHARS)
  const current = { reverse: reverse.buildInspirationReversePrompt, multi: reverse.buildInspirationReverseMultiWorldPrompt, suggest: world.buildWorldSuggestPromptFromRegisteredContextV1, expand: world.buildWorldExpandPromptFromRegisteredContextV1, history: history.buildHistoryAgentMessagesV1, extract: codex.buildCodexExtractPromptFromRegisteredContextV1, enrich: codex.buildCodexEnrichPromptFromRegisteredContextV1, manifest: manifest.buildWorldRulesManifest }
  return {
    baselineCommit: baseline.commit,
    compilerTarget: 'ES2020',
    /**
     * @param {WorldEntryCase} c
     * @param {'old'|'new'} variant
     */
    build(c, variant) {
      const builder = variant === 'old' ? old : current
      if (c.kind === 'full') return (c.mode === 'multiworld' ? builder.multi : builder.reverse)(c.args.projectName, c.args.genres, c.args.inspiration, c.args.userHint)
      if (c.kind === 'suggest' || c.kind === 'expand') return builder[c.kind](c.context)
      if (c.kind === 'history') return builder.history({ mode: c.mode, registeredContext: c.context })
      if (c.kind === 'codex') return builder[c.operation](c.args)
      if (c.kind === 'manifest') {
        const text = builder.manifest(c.profile, c.options)
        for (const entry of Object.values(c.profile?.entries || {})) {
          for (const value of [entry.historicalAnchors, entry.fictionalAdaptations]) if (value?.trim() && !text.includes(value.trim())) throw Error('Evaluation formatter omitted a supplied rule entry')
        }
        return text
      }
      throw Error('Unknown world entry fixture kind')
    },
    /**
     * @param {WorldEntryCase} c
     * @param {string} raw
     */
    validate(c, raw) {
      if (c.kind === 'full') {
        const result = full.parse(raw, c.mode)
        if (!full.meaningful(result, c.mode)) throw Error('No meaningful reverse result')
        return result
      } else if (c.kind === 'suggest') return world.parseWorldSuggestOutputStrictV1(raw)
      else if (c.kind === 'expand') return world.parseWorldExpandOutputStrictV1(raw)
      else if (c.kind === 'history') return history.parseHistoryAgentResultStrictV1(c.mode, raw)
      else if (c.kind === 'codex') return codex.parseCodexEntriesStrictV1(raw, c.fields, { operation: c.operation, sourceText: c.args.sourceText || '' })
      return raw
    },
  }
}
