/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registryFile = path.join(root, 'src', 'lib', 'agent', 'skill-registry.ts')
const testsDir = path.join(root, 'tests')
const maxVerificationAgeDays = 45
const failures = []

function unwrapExpression(expression) {
  let current = expression
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
  ) current = current.expression
  return current
}

function propertyByName(object, name) {
  return object.properties.find(property => (
    ts.isPropertyAssignment(property)
    && ((ts.isIdentifier(property.name) && property.name.text === name)
      || (ts.isStringLiteral(property.name) && property.name.text === name))
  ))
}

function stringProperty(object, name, skillLabel) {
  const property = propertyByName(object, name)
  const value = property && unwrapExpression(property.initializer)
  if (!value || !ts.isStringLiteralLike(value) || !value.text.trim()) {
    failures.push(`${skillLabel} missing literal ${name}`)
    return ''
  }
  return value.text
}

function stringArrayProperty(object, name, skillLabel) {
  const property = propertyByName(object, name)
  const value = property && unwrapExpression(property.initializer)
  if (!value || !ts.isArrayLiteralExpression(value)) {
    failures.push(`${skillLabel} missing literal ${name} array`)
    return []
  }
  const result = []
  for (const element of value.elements) {
    const unwrapped = unwrapExpression(element)
    if (!ts.isStringLiteralLike(unwrapped) || !unwrapped.text.trim()) {
      failures.push(`${skillLabel} ${name} must contain only non-empty string literals`)
      continue
    }
    result.push(unwrapped.text)
  }
  return result
}

function findFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? findFiles(fullPath) : [fullPath]
  })
}

if (!fs.existsSync(registryFile)) {
  console.error('agent freshness check failed: missing src/lib/agent/skill-registry.ts')
  process.exit(1)
}

const sourceText = fs.readFileSync(registryFile, 'utf8')
const sourceFile = ts.createSourceFile(
  registryFile,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
let skillsArray
for (const statement of sourceFile.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'AGENT_SKILLS') continue
    const initializer = declaration.initializer && unwrapExpression(declaration.initializer)
    if (initializer && ts.isArrayLiteralExpression(initializer)) skillsArray = initializer
  }
}

if (!skillsArray) {
  console.error('agent freshness check failed: AGENT_SKILLS must be a literal array')
  process.exit(1)
}

const testEvidence = findFiles(testsDir)
  .filter(file => /\.test\.[cm]?[jt]sx?$/.test(file))
  .map(file => ({
    basename: path.basename(file),
    source: fs.readFileSync(file, 'utf8'),
  }))
const now = new Date()
const oneDayMs = 24 * 60 * 60 * 1000
const promptOwners = new Map()
const seenIds = new Set()
let regressionEvidenceCount = 0

for (const [index, element] of skillsArray.elements.entries()) {
  const expression = unwrapExpression(element)
  if (!ts.isObjectLiteralExpression(expression)) {
    failures.push(`AGENT_SKILLS[${index}] must be an object literal`)
    continue
  }
  const id = stringProperty(expression, 'id', `AGENT_SKILLS[${index}]`) || `AGENT_SKILLS[${index}]`
  const owner = stringProperty(expression, 'owner', id)
  const promptVersion = stringProperty(expression, 'promptVersion', id)
  const lastVerifiedAt = stringProperty(expression, 'lastVerifiedAt', id)
  const regressionTests = stringArrayProperty(expression, 'regressionTests', id)

  if (seenIds.has(id)) failures.push(`${id} is duplicated`)
  seenIds.add(id)
  if (!/^[a-z0-9][a-z0-9.-]*-v\d+$/.test(promptVersion)) {
    failures.push(`${id} has invalid promptVersion ${promptVersion || '(empty)'}`)
  }
  const priorOwner = promptOwners.get(promptVersion)
  if (priorOwner && priorOwner !== owner) {
    failures.push(`${promptVersion} is shared by different owners: ${priorOwner}, ${owner}`)
  } else if (promptVersion) {
    promptOwners.set(promptVersion, owner)
  }

  const verifiedAt = /^\d{4}-\d{2}-\d{2}$/.test(lastVerifiedAt)
    ? new Date(`${lastVerifiedAt}T00:00:00Z`)
    : new Date(Number.NaN)
  if (Number.isNaN(verifiedAt.getTime())) {
    failures.push(`${id} has invalid lastVerifiedAt ${lastVerifiedAt || '(empty)'}`)
  } else {
    const ageDays = Math.floor((now.getTime() - verifiedAt.getTime()) / oneDayMs)
    if (ageDays > maxVerificationAgeDays) {
      failures.push(`${id} verification is stale: ${ageDays} days old (max ${maxVerificationAgeDays})`)
    }
    if (ageDays < -1) failures.push(`${id} lastVerifiedAt is in the future: ${lastVerifiedAt}`)
  }

  if (regressionTests.length === 0) failures.push(`${id} has no regression evidence`)
  if (new Set(regressionTests).size !== regressionTests.length) {
    failures.push(`${id} has duplicate regression evidence`)
  }
  for (const testId of regressionTests) {
    regressionEvidenceCount += 1
    if (!/^R-[A-Z0-9]+/.test(testId)) failures.push(`${id} has invalid regression id ${testId}`)
    if (!testEvidence.some(evidence => (
      evidence.basename.startsWith(`${testId}.`)
      || evidence.source.includes(testId)
    ))) {
      failures.push(`${id} references missing regression evidence ${testId}`)
    }
  }
}

if (failures.length) {
  console.error('agent freshness check failed:')
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(
  `agent freshness check passed: ${seenIds.size} skills, ${promptOwners.size} prompt versions, ${regressionEvidenceCount} regression references, max age ${maxVerificationAgeDays} days`,
)
