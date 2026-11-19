import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { assertOfflineReferenceEntry, REFERENCE_QUALITY_ENTRY, REFERENCE_QUALITY_MAX_CALLS } from './reference-quality-contract.mjs'

/** @typedef {Parameters<typeof assertOfflineReferenceEntry>[0]} ReferenceRegistry */
/** @typedef {NonNullable<ReferenceRegistry['offlineEvaluations']>[number]} OfflineEntry */
/** @returns {ReferenceRegistry} */
function registry() {
  return JSON.parse(readFileSync(new URL('../src/lib/agent/ai-entry-registry.json', import.meta.url), 'utf8'))
}
/** @param {ReferenceRegistry} value */
function target(value) {
  const entry = value.offlineEvaluations?.find(row => row.entryId === REFERENCE_QUALITY_ENTRY)
  if (!entry) throw Error('Test fixture lacks reference entry')
  return entry
}

// Fixed expectations from Git 78ab682f0c47010a9b1186bc42dfce4377f65513.
// These are comment-free runtime AST digests, not hashes of the new source.
// No evaluator import, function extraction/execution, Vite, profile or network.
const ORIGINAL_EVALUATOR_AST = '65c8967801d238859e0b908f25135e74b87db3d4e7292887ed907f131ca76ad2'
const ORIGINAL_REQUEST_AST = 'f5ffc363baf46690c4318b1970c898542ef4a069ad45484af35dac73755c6c03'
const ORIGINAL_CONTRACT_AST = '512ec73a39cfd77edd4467b54feeb125f321fccf4134cfdd3620704094b3664c'
/** @param {string} name @param {string} text */
function parse(name, text) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
}
/** @param {ts.Node} node @returns {unknown} */
function runtimeTree(node) {
  /** @type {unknown[]} */
  const children = []
  ts.forEachChild(node, child => { children.push(runtimeTree(child)) })
  const text = ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : null
  const operator = ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : null
  return [ts.SyntaxKind[node.kind], node.flags, text, operator, children]
}
/** @param {ts.Node} node */
function digest(node) {
  return createHash('sha256').update(JSON.stringify(runtimeTree(node))).digest('hex')
}
/** @param {ts.Node} node @param {(node: ts.Node) => void} visit */
function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, child => walk(child, visit))
}
/** @param {ts.SourceFile} source @param {string} name */
function declaration(source, name) {
  /** @type {ts.VariableDeclaration[]} */
  const matches = []
  walk(source, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
  })
  assert.equal(matches.length, 1, `Expected one ${name} declaration`)
  return matches[0]
}
/** Reverse exactly the two reviewed expression changes without executing them.
 * @param {string} text */
function reverseReviewedTransforms(text) {
  const source = parse('evaluate-reference-quality.mjs', text)
  /** @type {Array<{start: number, end: number, text: string}>} */
  const edits = []
  /** @type {ts.CallExpression[]} */
  const imports = []
  walk(source, node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push(node)
  })
  assert.equal(imports.length, 1)
  assert.equal(imports[0].arguments.length, 1)
  const specifier = imports[0].arguments[0]
  assert.ok(ts.isPropertyAccessExpression(specifier) && specifier.name.text === 'href')
  assert.ok(ts.isCallExpression(specifier.expression) && ts.isIdentifier(specifier.expression.expression)
    && specifier.expression.expression.text === 'pathToFileURL')
  edits.push({ start: specifier.expression.end, end: specifier.end, text: '' })

  const capture = declaration(source, 'caseFilter')
  assert.equal(capture.initializer?.getText(source), 'process.env.REFERENCE_EVAL_CASES')
  assert.ok(ts.isVariableDeclarationList(capture.parent) && capture.parent.flags & ts.NodeFlags.Const)
  const statement = capture.parent.parent
  assert.ok(ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1)
  assert.ok(ts.isBlock(statement.parent))
  const cases = declaration(source, 'cases'), allCases = declaration(source, 'allCases')
  assert.equal(cases.parent.parent.parent, statement.parent)
  assert.equal(allCases.parent.parent.parent, statement.parent)
  assert.ok(allCases.end < statement.getStart(source) && statement.end < cases.getStart(source))
  edits.push({ start: statement.getStart(source), end: statement.end, text: '' })
  let references = 0
  walk(source, node => {
    if (ts.isIdentifier(node) && node.text === 'caseFilter' && node !== capture.name) {
      references++
      edits.push({ start: node.getStart(source), end: node.end, text: 'process.env.REFERENCE_EVAL_CASES' })
    }
  })
  assert.equal(references, 2)
  edits.sort((a, b) => b.start - a.start)
  for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  return parse('evaluate-reference-quality.mjs', text)
}
const evaluatorText = readFileSync(new URL('./evaluate-reference-quality.mjs', import.meta.url), 'utf8')

// The registry checker owns global duplicate-entry checks. This pure contract
// test deliberately asserts only this guard's existing rejection conditions.
test('versioned reference evaluation entry is read-only and validation does not mutate it', () => {
  const value = registry(), before = structuredClone(value)
  assert.equal(REFERENCE_QUALITY_ENTRY, 'eval.reference.content-quality')
  assert.equal(REFERENCE_QUALITY_MAX_CALLS, 28)
  assert.doesNotThrow(() => assertOfflineReferenceEntry(value))
  assert.deepEqual(value, before)
})
test('missing offline list or reference entry is rejected', () => {
  assert.throws(() => assertOfflineReferenceEntry({}), /Missing read-only reference evaluation contract/)
  const value = registry()
  value.offlineEvaluations = value.offlineEvaluations?.filter(row => row.entryId !== REFERENCE_QUALITY_ENTRY)
  assert.throws(() => assertOfflineReferenceEntry(value), /Missing read-only reference evaluation contract/)
})
/** @type {Array<[string, (entry: OfflineEntry) => void]>} */
const mutations = [
  ['boundary absent', entry => { delete entry.boundary }],
  ['boundary formal', entry => { entry.boundary = 'formal' }],
  ['adoption absent', entry => { delete entry.adoptAllowed }],
  ['adoption enabled', entry => { entry.adoptAllowed = true }],
  ['adoption targets present', entry => { entry.adoptionTargets = ['worldviews'] }],
  ['caller absent', entry => { delete entry.caller }],
  ['caller wrong', entry => { entry.caller = 'scripts/other.mjs' }],
  ['contract absent', entry => { delete entry.contract }],
  ['contract wrong', entry => { entry.contract = 'scripts/other-contract.mjs' }],
  ['transport absent', entry => { delete entry.transport }],
  ['transport wrong', entry => { entry.transport = 'local-codex-subscription' }],
]
for (const [label, mutate] of mutations) test(`reference contract rejects ${label}`, () => {
  const value = registry()
  mutate(target(value))
  assert.throws(() => assertOfflineReferenceEntry(value), /Missing read-only reference evaluation contract/)
})
test('contract runtime AST is unchanged from the frozen original', () => {
  const text = readFileSync(new URL('./reference-quality-contract.mjs', import.meta.url), 'utf8')
  assert.equal(digest(parse('reference-quality-contract.mjs', text)), ORIGINAL_CONTRACT_AST)
})
test('only reviewed href and case-filter capture transforms change the evaluator runtime AST', () => {
  assert.equal(digest(reverseReviewedTransforms(evaluatorText)), ORIGINAL_EVALUATOR_AST)
})
test('request cap, sole fetch, errors, timeout, raw results and sequential production stay frozen', () => {
  const source = parse('evaluate-reference-quality.mjs', evaluatorText)
  const request = declaration(source, 'request').initializer
  assert.ok(request && ts.isArrowFunction(request) && ts.isBlock(request.body))
  assert.equal(digest(request), ORIGINAL_REQUEST_AST)
  // Independent original-state guard and fetch count; never invoke request.
  const guard = request.body.statements[0]
  assert.ok(ts.isIfStatement(guard) && ts.isBinaryExpression(guard.expression))
  assert.equal(guard.expression.operatorToken.kind, ts.SyntaxKind.GreaterThanToken)
  assert.ok(ts.isPrefixUnaryExpression(guard.expression.left))
  assert.equal(guard.expression.left.operator, ts.SyntaxKind.PlusPlusToken)
  assert.equal(guard.expression.left.operand.getText(source), 'calls')
  assert.equal(guard.expression.right.getText(source), 'REFERENCE_QUALITY_MAX_CALLS')
  assert.ok(ts.isThrowStatement(guard.thenStatement))
  let fetches = 0
  walk(source, node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') fetches++
  })
  assert.equal(fetches, 1)
  // Whole AST comparison also covers all loops/await/storage/manifest code.
  assert.equal(digest(reverseReviewedTransforms(evaluatorText)), ORIGINAL_EVALUATOR_AST)
})
