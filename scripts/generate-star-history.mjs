#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const REPOSITORY = 'yuanbw2025/storyforge'
const OUTPUT = resolve(process.argv[2] ?? 'docs/assets/architecture/storyforge-star-history.svg')
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? (() => {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
})()
const API_HEADERS = {
  Accept: 'application/vnd.github.star+json',
  'User-Agent': 'storyforge-star-history-generator',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
}

async function githubJson(url, accept = API_HEADERS.Accept) {
  const response = await fetch(url, { headers: { ...API_HEADERS, Accept: accept } })
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
  return response.json()
}

async function loadStargazers() {
  const rows = []
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`https://api.github.com/repos/${REPOSITORY}/stargazers?per_page=100&page=${page}`)
    rows.push(...batch)
    if (batch.length < 100) return rows
  }
}

function dateKey(value) {
  return value.toISOString().slice(0, 10)
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value)
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
}

function buildSeries(stargazers, endDate) {
  const sorted = stargazers.map(item => new Date(item.starred_at)).sort((a, b) => a - b)
  const start = new Date(sorted[0] ?? endDate)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - 1)
  const end = new Date(endDate)
  end.setUTCHours(0, 0, 0, 0)

  const counts = new Map()
  for (const date of sorted) counts.set(dateKey(date), (counts.get(dateKey(date)) ?? 0) + 1)

  const points = []
  let total = 0
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    total += counts.get(dateKey(cursor)) ?? 0
    points.push({ date: new Date(cursor), total })
  }
  return points
}

function renderSvg(series, currentStars, generatedAt) {
  const width = 960
  const height = 320
  const margin = { top: 68, right: 42, bottom: 42, left: 58 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const ceiling = Math.max(50, Math.ceil(currentStars / 50) * 50)
  const x = index => margin.left + (index / Math.max(1, series.length - 1)) * plotWidth
  const y = value => margin.top + plotHeight - (value / ceiling) * plotHeight
  const line = series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.total).toFixed(2)}`).join(' ')
  const area = `${line} L ${x(series.length - 1).toFixed(2)} ${margin.top + plotHeight} L ${margin.left} ${margin.top + plotHeight} Z`
  const yTicks = Array.from({ length: 6 }, (_, index) => Math.round((ceiling / 5) * index))
  const xTickIndexes = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round(((series.length - 1) / 4) * index)))]
  const firstDate = series[0]?.date ?? generatedAt
  const lastDate = series.at(-1)?.date ?? generatedAt

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="320" viewBox="0 0 960 320" role="img" aria-labelledby="title description">
  <title id="title">StoryForge star history</title>
  <desc id="description">GitHub stars grew from 0 to ${currentStars} between ${dateKey(firstDate)} and ${dateKey(lastDate)}.</desc>
  <style>
    .background { fill: #ffffff; }
    .text { fill: #24292f; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .muted { fill: #57606a; font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .grid { stroke: #d0d7de; stroke-width: 1; }
    .area { fill: #0969da; opacity: .12; }
    .line { fill: none; stroke: #0969da; stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
    .endpoint { fill: #0969da; stroke: #ffffff; stroke-width: 3; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; }
      .text { fill: #e6edf3; }
      .muted { fill: #8d96a0; }
      .grid { stroke: #30363d; }
      .area { fill: #58a6ff; opacity: .16; }
      .line { stroke: #58a6ff; }
      .endpoint { fill: #58a6ff; stroke: #0d1117; }
    }
  </style>
  <rect class="background" width="960" height="320" rx="8" />
  <text class="text" x="${margin.left}" y="28" font-size="18" font-weight="600">Star History</text>
  <text class="muted" x="${margin.left}" y="48">${escapeXml(REPOSITORY)} · ${dateKey(firstDate)} to ${dateKey(lastDate)}</text>
  <text class="text" x="${width - margin.right}" y="30" text-anchor="end" font-size="22" font-weight="600">${currentStars} stars</text>
  ${yTicks.map(value => `<line class="grid" x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}" /><text class="muted" x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join('\n  ')}
  ${xTickIndexes.map(index => `<text class="muted" x="${x(index)}" y="${height - 16}" text-anchor="middle">${formatDate(series[index].date)}</text>`).join('\n  ')}
  <path class="area" d="${area}" />
  <path class="line" d="${line}" />
  <circle class="endpoint" cx="${x(series.length - 1)}" cy="${y(series.at(-1).total)}" r="5" />
</svg>
`
}

const [repository, stargazers] = await Promise.all([
  githubJson(`https://api.github.com/repos/${REPOSITORY}`, 'application/vnd.github+json'),
  loadStargazers(),
])
const generatedAt = new Date()
const series = buildSeries(stargazers, generatedAt)
if (series.length === 0) throw new Error('No stargazer history returned by GitHub')
if (series.at(-1).total !== repository.stargazers_count) {
  throw new Error(`Stargazer history mismatch: API count=${repository.stargazers_count}, timeline=${series.at(-1).total}`)
}

await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, renderSvg(series, repository.stargazers_count, generatedAt), 'utf8')
console.log(`[star-history] wrote ${OUTPUT} (${repository.stargazers_count} stars)`)
