import type { ProjectExportData } from './json-export'

const GIST_API = 'https://api.github.com/gists'

export interface GistConfig {
  pat: string       // GitHub Personal Access Token
  gistId?: string   // 已有 Gist ID（用于更新）
}

export interface GistResult {
  gistId: string
  url: string
}

/**
 * 将项目数据导出到 GitHub Gist（私密）
 * - 若 gistId 为空：创建新 Gist
 * - 若 gistId 存在：更新已有 Gist
 */
export async function exportToGist(
  data: ProjectExportData,
  config: GistConfig
): Promise<GistResult> {
  const filename = `storyforge-${data.project.name.replace(/\s+/g, '-')}.json`
  const content = JSON.stringify(data, null, 2)

  const body = {
    description: `故事熔炉备份 — ${data.project.name} (${new Date().toLocaleString('zh-CN')})`,
    public: false,
    files: {
      [filename]: { content },
    },
  }

  const headers = {
    Authorization: `Bearer ${config.pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  let response: Response
  if (config.gistId) {
    // 更新已有 Gist (PATCH)
    response = await fetch(`${GIST_API}/${config.gistId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
  } else {
    // 创建新 Gist (POST)
    response = await fetch(GIST_API, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message ?? `GitHub API 错误 ${response.status}`)
  }

  const json = await response.json()
  return {
    gistId: json.id,
    url: json.html_url,
  }
}

/** 验证 PAT 是否有效（调用 /user 接口） */
export async function validateGitHubPAT(pat: string): Promise<string> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) throw new Error('PAT 无效或权限不足')
  const json = await response.json()
  return json.login as string
}
