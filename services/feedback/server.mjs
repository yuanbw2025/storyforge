import express from 'express'
import multer from 'multer'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export function createFeedbackApp({ githubToken, uploadDir, publicUploadPrefix, githubFetch = fetch, receiptDir = path.join(uploadDir, '../receipts') }) {
const app = express()
const GITHUB_TOKEN = githubToken
const GITHUB_REPO = 'yuanbw2025/storyforge'
fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 })
const UPLOAD_DIR = uploadDir
const PUBLIC_UPLOAD_PREFIX = publicUploadPrefix
const MAX_IMAGE = 10 * 1024 * 1024
const MAX_VIDEO = 100 * 1024 * 1024
const MAX_OTHER = 30 * 1024 * 1024
const MAX_TOTAL = 145 * 1024 * 1024
const MAX_FILES = 3

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const fileRules = {
  '.png':  { type: 'image', mimes: ['image/png'] },
  '.jpg':  { type: 'image', mimes: ['image/jpeg'] },
  '.jpeg': { type: 'image', mimes: ['image/jpeg'] },
  '.gif':  { type: 'image', mimes: ['image/gif'] },
  '.webp': { type: 'image', mimes: ['image/webp'] },

  '.mp4':  { type: 'video', mimes: ['video/mp4', 'application/octet-stream'] },
  '.webm': { type: 'video', mimes: ['video/webm', 'application/octet-stream'] },
  '.mov':  { type: 'video', mimes: ['video/quicktime', 'application/octet-stream'] },

  '.txt':  { type: 'other', mimes: ['text/plain', 'application/octet-stream'] },
  '.log':  { type: 'other', mimes: ['text/plain', 'application/octet-stream'] },
  '.json': { type: 'other', mimes: ['application/json', 'text/plain', 'application/octet-stream'] },
  '.zip':  { type: 'other', mimes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'] }
}

function getRule(file) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  const rule = fileRules[ext]

  if (!rule) return null
  if (!rule.mimes.includes(file.mimetype)) return null

  return { ...rule, ext }
}

function removeFiles(files = []) {
  for (const file of files) {
    try {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path)
      }
    } catch (err) {
      console.error('删除临时附件失败:', err)
    }
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR)
  },

  filename: (_req, file, cb) => {
    const rule = getRule(file)

    if (!rule) {
      return cb(new Error('不支持的附件类型'))
    }

    cb(
      null,
      `${Date.now()}-${crypto.randomUUID()}${rule.ext}`
    )
  }
})

const upload = multer({
  storage,

  limits: {
    files: MAX_FILES,
    fileSize: MAX_VIDEO
  },

  fileFilter: (_req, file, cb) => {
    if (!getRule(file)) {
      return cb(new Error('不支持的附件类型'))
    }

    cb(null, true)
  }
})

const rateMap = new Map()

function rateLimit(req, res, next) {
  const forwarded = req.headers['x-forwarded-for']

  const ip = req.method + ':' + String(
    forwarded || req.socket.remoteAddress || ''
  )
    .split(',')[0]
    .trim()

  const now = Date.now()
  const windowMs = 10 * 60 * 1000
  const maxRequests = req.method === 'GET' ? 60 : 5

  const current = rateMap.get(ip) || []
  const recent = current.filter(
    time => now - time < windowMs
  )

  if (recent.length >= maxRequests) {
    return res.status(429).json({
      ok: false,
      error: '提交过于频繁，请稍后再试。'
    })
  }

  recent.push(now)
  rateMap.set(ip, recent)

  next()
}

setInterval(() => {
  const now = Date.now()
  const windowMs = 10 * 60 * 1000

  for (const [ip, times] of rateMap.entries()) {
    const recent = times.filter(
      time => now - time < windowMs
    )

    if (recent.length) {
      rateMap.set(ip, recent)
    } else {
      rateMap.delete(ip)
    }
  }
}, 30 * 60 * 1000).unref()

function originCheck(req, res, next) {
  const origin = req.headers.origin

  if (
    origin &&
    origin !== 'https://docs.storyforge-lab.com'
  ) {
    return res.status(403).json({
      ok: false,
      error: '请求来源无效。'
    })
  }

  next()
}

function clean(value, max = 10000) {
  return String(value ?? '')
    .replace(/\0/g, '')
    .trim()
    .slice(0, max)
}

function typeConfig(type) {
  if (type === 'bug') {
    return {
      prefix: '[Bug]',
      label: 'bug',
      titleFallback: '用户提交的问题反馈'
    }
  }

  if (type === 'feature') {
    return {
      prefix: '[Feature]',
      label: 'enhancement',
      titleFallback: '用户提交的功能建议'
    }
  }

  if (type === 'documentation') {
    return {
      prefix: '[Docs]',
      label: 'documentation',
      titleFallback: '用户提交的文档纠错'
    }
  }

  return null
}

function validateFiles(files = []) {
  let total = 0

  for (const file of files) {
    const rule = getRule(file)

    if (!rule) {
      return '存在不支持的附件类型'
    }

    total += file.size

    if (rule.type === 'image' && file.size > MAX_IMAGE) {
      return `图片 ${file.originalname} 超过 10MB`
    }

    if (rule.type === 'video' && file.size > MAX_VIDEO) {
      return `视频 ${file.originalname} 超过 100MB`
    }

    if (rule.type === 'other' && file.size > MAX_OTHER) {
      return `附件 ${file.originalname} 超过 30MB`
    }
  }

  if (total > MAX_TOTAL) {
    return '一次提交的附件总大小不能超过约 145MB'
  }

  return null
}

app.disable('x-powered-by')

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'StoryForge-Feedback' }
const base = `https://api.github.com/repos/${GITHUB_REPO}`
const issueNumber = value => /^[1-9][0-9]{0,8}$/.test(String(value ?? '')) ? Number(value) : null
const publicIssue = row => ({ number: row.number, title: row.title, state: row.state, locked: row.locked, url: row.html_url, body: row.body })
async function github(url, options = {}) {
  const response = await githubFetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(20000), redirect: 'error' })
  const data = await response.json()
  if (!response.ok) { const error = new Error('GitHub unavailable'); error.status = response.status; throw error }
  return data
}
app.use(express.json({ limit: '64kb' }))
app.get('/feedback', originCheck, rateLimit, async (req, res) => {
  try {
    const search = clean(req.query.search, 120)
    const page = issueNumber(req.query.page ?? '1')
    if (!page || page > 100) return res.status(400).json({ ok: false, error: 'Invalid page' })
    // Quote each word: input cannot override the fixed repository or is:issue.
    const words = search.split(/\s+/).filter(Boolean).map(word => '"' + word.replace(/["\\]/g, '') + '"').join(' ')
    const data = await github('https://api.github.com/search/issues?' + new URLSearchParams({ q: `repo:${GITHUB_REPO} is:issue ${words}`, per_page: '10', page: String(page), sort: 'updated' }))
    res.json({ ok: true, issues: data.items.filter(x => !x.pull_request && x.repository_url === base).map(publicIssue), total: data.total_count, page })
  } catch { res.status(502).json({ ok: false, error: '问题查询暂时失败，请保留草稿稍后查询。' }) }
})
app.get('/feedback/:number', originCheck, rateLimit, async (req, res) => {
  const number = issueNumber(req.params.number)
  if (!number) return res.status(400).json({ ok: false, error: 'Invalid issue' })
  try {
    const row = await github(`${base}/issues/${number}`)
    if (row.pull_request) return res.status(400).json({ ok: false, error: '请选择 Issue，不是 PR。' })
    const page = issueNumber(req.query.page ?? '1')
    if (!page || page > 100) return res.status(400).json({ ok: false, error: 'Invalid page' })
    const comments = await github(`${base}/issues/${number}/comments?per_page=20&page=${page}`)
    res.json({ ok: true, issue: publicIssue(row), comments: comments.map(x => ({ body: x.body, url: x.html_url, createdAt: x.created_at, author: x.user?.login })), page, hasMore: comments.length === 20 })
  } catch (e) { res.status(e.status === 404 ? 404 : 502).json({ ok: false, error: '无法读取工单，请核对编号。' }) }
})

app.post(
  '/feedback',
  originCheck,
  rateLimit,
  upload.array('attachments', MAX_FILES),

  async (req, res) => {
    let dispatched = false
    try {
      /*
       * 隐藏字段。
       * 正常用户看不到，简单机器人可能自动填写。
       */
      if (clean(req.body.website, 200)) {
        removeFiles(req.files)

        return res.status(400).json({
          ok: false,
          error: '提交失败。'
        })
      }

      const fileError = validateFiles(req.files)

      if (fileError) {
        removeFiles(req.files)

        return res.status(413).json({
          ok: false,
          error: fileError
        })
      }

      const cfg = typeConfig(
        clean(req.body.type, 30)
      )

      if (!cfg) {
        removeFiles(req.files)

        return res.status(400).json({
          ok: false,
          error: '反馈类型无效'
        })
      }

      const action = req.body.action || 'create'
      const target = issueNumber(req.body.issueNumber)
      if (!['create','comment'].includes(action) || (action === 'comment' && !target) || (action === 'create' && req.body.issueNumber)) {
        removeFiles(req.files); return res.status(400).json({ ok: false, error: '请选择新建或明确指定追加的Issue编号。' })
      }
      if (action === 'comment') {
        let row
        try { row = await github(`${base}/issues/${target}`) } catch { removeFiles(req.files); return res.status(404).json({ ok: false, error: '工单不存在或当前不可读。' }) }
        if (row.pull_request || row.locked) { removeFiles(req.files); return res.status(409).json({ ok: false, error: '该目标是PR或已锁定，不能追加。' }) }
      }
      const title =
        clean(req.body.title, 180) ||
        cfg.titleFallback

      const description =
        clean(req.body.description, 12000)

      if (!description) {
        removeFiles(req.files)

        return res.status(400).json({
          ok: false,
          error: '请填写反馈内容'
        })
      }

      const fields = [
        ['反馈类型', clean(req.body.type, 30)],
        ['StoryForge 版本', clean(req.body.version, 100)],
        ['操作系统', clean(req.body.os, 100)],
        ['浏览器', clean(req.body.browser, 100)],
        ['相关模块', clean(req.body.module, 150)],
        ['模型 / API', clean(req.body.model, 150)],
        ['文档页面', clean(req.body.page, 500)],
        ['联系方式', clean(req.body.contact, 300)]
      ].filter(([, value]) => value)

      const extraSections = [
        ['问题 / 使用场景', clean(req.body.problem, 12000)],
        ['复现步骤', clean(req.body.steps, 12000)],
        ['期望结果', clean(req.body.expected, 12000)],
        ['实际结果', clean(req.body.actual, 12000)],
        ['希望如何改进', clean(req.body.solution, 12000)],
        ['建议修改', clean(req.body.correction, 12000)],
        ['补充信息', clean(req.body.extra, 12000)]
      ].filter(([, value]) => value)

      let body =
        `## 用户反馈\n\n${description}\n`

      if (fields.length) {
        body += '\n## 环境与信息\n\n'

        for (const [key, value] of fields) {
          body += `- **${key}：** ${value}\n`
        }
      }

      for (const [heading, value] of extraSections) {
        body += `\n## ${heading}\n\n${value}\n`
      }

      if (req.files?.length) {
        body +=
          '\n## 附件\n\n' +
          '> 附件由 StoryForge 官方反馈系统临时保存，提交约 10 天后链接可能失效。\n\n'

        for (const file of req.files) {
          const url =
            `${PUBLIC_UPLOAD_PREFIX}/${encodeURIComponent(file.filename)}`

          const original =
            clean(file.originalname, 200)

          body += `- [${original}](${url})\n`
        }
      }

      body +=
        '\n---\n通过 StoryForge 官方网站反馈系统提交。'

      if (body.length > 60000) { removeFiles(req.files); return res.status(413).json({ ok: false, error: '反馈正文过长，请缩短后提交。' }) }
      let receiptPath
      if (req.body.requestId) {
        if (!/^[0-9a-f-]{36}$/i.test(req.body.requestId)) { removeFiles(req.files); return res.status(400).json({ ok: false, error: 'Invalid requestId' }) }
        receiptPath = path.join(receiptDir, req.body.requestId + '.json')
        const { requestId: _, ...input } = req.body
        const digest = crypto.createHash('sha256').update(JSON.stringify(Object.entries(input).sort()))
        for (const file of req.files || []) { digest.update(JSON.stringify([file.originalname, file.mimetype, file.size])); for await (const chunk of fs.createReadStream(file.path)) digest.update(chunk) }
        const hash = digest.digest('hex')
        if (fs.existsSync(receiptPath)) {
          const prior = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); removeFiles(req.files)
          if (prior.hash !== hash) return res.status(409).json({ ok: false, error: 'requestId 已用于不同内容。' })
          if (prior.result) return res.json(prior.result)
          return res.status(409).json({ ok: false, error: '此前提交结果未知，请先核对GitHub，勿换编号重发。' })
        }
        if (fs.readdirSync(receiptDir).length >= 10000) { removeFiles(req.files); return res.status(503).json({ ok: false, error: '回执容量已满，请稍后联系维护者。' }) }
        fs.writeFileSync(receiptPath, JSON.stringify({ hash }), { flag: 'wx', mode: 0o600 })
      }
      dispatched = true
      const response = await githubFetch(
        `${base}/issues${action === 'comment' ? `/${target}/comments` : ''}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(20000), redirect: 'error',

          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'StoryForge-Feedback'
          },

          body: JSON.stringify(action === 'comment' ? { body: `## 补充反馈（网站匿名提交，非维护者结论）\n\n${body}` } : { title: `${cfg.prefix} ${title}`, body, labels: [cfg.label] })
        }
      )

      const data = await response.json()

      if (!response.ok) {
        console.error('GitHub API error:', response.status)

        removeFiles(req.files)

        return res.status(502).json({
          ok: false,
          error: 'GitHub未确认成功，请先核对工单；使用原requestId查询回执，勿换编号重发。'
        })
      }

      if (typeof data.html_url !== 'string' || !data.html_url.startsWith('https://github.com/yuanbw2025/storyforge/issues/') || (action === 'create' && !Number.isSafeInteger(data.number))) throw new Error('Unverified GitHub receipt')
      const result = {
        ok: true,
        issueNumber: action === 'comment' ? target : data.number,
        action, url: data.html_url
      }
      if (receiptPath) { const prior = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); const temporary = receiptPath + '.tmp'; fs.writeFileSync(temporary, JSON.stringify({ hash: prior.hash, result }), { mode: 0o600 }); fs.renameSync(temporary, receiptPath) }
      res.json(result)
    } catch (error) {
      console.error('feedback request failed')

      if (!dispatched) removeFiles(req.files)

      res.status(502).json({
        ok: false,
        error: '提交结果未知，请先查看GitHub工单，勿立即重复提交。'
      })
    }
  }
)

app.use((error, req, res, _next) => {
  console.error('feedback request failed')

  removeFiles(req.files)

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      ok: false,
      error: '单个附件不能超过 100MB。'
    })
  }

  if (error?.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({
      ok: false,
      error: '一次最多上传 3 个附件。'
    })
  }

  return res.status(400).json({
    ok: false,
    error: error?.message || '上传失败'
  })
})


return app
}
