import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import developerPrompt from './developer-prompt.generated.txt?raw'

const docs = 'https://docs.storyforge-lab.com/workshop/'
const capabilities = [
  ['便笺、线索卡与看板', '增加自己的界面和数据，按作品保存；适合先做一个小工具。'],
  ['世界年表与故事进程', '用新的界面添加或替换这两个模块，沿用已有历史记录。'],
  ['AI 灵感与生成流程', '声明自己的任务和结果格式，或分享节点流程；由作者开始并确认。'],
  ['世界设定与跑团规则', '把选择的内容确认到世界词条，或用已有格式制作版本化规则包。'],
  ['资料查询与外部工具', '接入声明的网站或 MCP 工具，明确发送内容与服务要求。'],
  ['内容与插件组合', '分享无代码卡片包，或把一组准确版本的插件组合交付。'],
]
function GuideLink({ page, children }: { page: string; children: ReactNode }) {
  return <a href={`${docs}${page}`} target="_blank" rel="noopener noreferrer">{children} ↗</a>
}
export default function WorkshopHelp({ develop, query }: { develop: boolean; query: string }) {
  const [copyStatus, setCopyStatus] = useState('')
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(developerPrompt)
      setCopyStatus('已复制。请补充需求，并把开发资料包一起交给你的 AI。')
    } catch {
      setCopyStatus('未能访问剪贴板。请展开下方“查看并手动复制指令”，全选文本复制。')
    }
  }
  const asset = (name: string) => `${import.meta.env.BASE_URL}workshop/${name}`
  return <div className="sf-workshop-help" data-testid="workshop-help">
    <section className="lf-paper">
      <span className="sf-extension-tag">1.0 体验版 · API 1 · SDK 0.1</span>
      <h2>{develop ? '把你的想法做成插件' : '从一个插件开始'}</h2>
      <p>{develop ? '说明你想要的效果，让自己的编程 AI 按公开规则完成开发、检查与打包。也可以从模板开始自己编写。' : '插件为当前作品或世界增加独立功能。先试用，再选择适合自己的工具；每部作品都可以有不同的组合。'}</p>
      <div className="sf-extension-actions">
        <Link className="lf-action" to={`/workshop/${develop ? 'help' : 'develop'}${query}`}>{develop ? '我想先了解怎么安装' : '我想用 AI 开发插件'}</Link>
        <GuideLink page="">完整使用指南</GuideLink>
      </div>
      <p className="sf-workshop-help-note">当前接口仍为开发预览。配套知识库随官网文档发布；下载的资料包包含离线指南，网站尚未更新时也能查阅。</p>
    </section>
    <section aria-labelledby="workshop-capabilities">
      <h2 id="workshop-capabilities">可以做出什么效果</h2>
      <div className="sf-workshop-grid">{capabilities.map(([title, text]) => <article className="sf-workshop-card" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div>
      <p>现在专门开放替换的是世界历史和故事进程。其他作者产品提供通用工作台；需要替换其他内部算法时，应先提出接口需求。</p>
    </section>
    {develop ? <>
      <section className="lf-paper" aria-labelledby="workshop-ai-start">
        <h2 id="workshop-ai-start">交给自己的 AI 开发</h2>
        <ol><li>下载并解压资料包，把整个文件夹交给能读写文件、运行命令的编程助手。</li><li>复制开发指令，补充想要的界面、操作、保存内容和完成效果。不确定的技术选择可让 AI 解释。</li><li>让 AI 核对匹配的熔炉仓库和 SDK，开发独立插件，完成检查、打包及测试作品中的验证。</li><li>收到 .sfplugin、源码和操作说明后，按安装教程亲自体验，再决定是否分享。</li></ol>
        <div className="sf-extension-actions">
          <a className="lf-action" href={asset('storyforge-plugin-author.zip')} download>下载开发资料包与 Skill</a>
          <button className="lf-action" onClick={() => void copyPrompt()}>复制 AI 开发指令</button>
          <a href={asset('developer-prompt.txt')} download>下载指令文本</a>
        </div>
        <p role="status">{copyStatus}</p>
        <details><summary>查看并手动复制指令</summary><textarea aria-label="AI 插件开发指令" value={developerPrompt} readOnly rows={13} onFocus={event => event.currentTarget.select()}/></details>
        <p>资料包包含 Skill、接口类型、技术约定、六篇中英文指南、参考源码及验收清单。它不是插件安装包，不包含完整熔炉或开发依赖。</p>
        <p>支持 Skill 的工具可以导入完整目录，名称为 <code>storyforge-plugin-author</code>；其他工具直接读取 SKILL.md 即可。只会聊天的 AI 能写代码，但不能代替本机打包与安装验收。</p>
        <GuideLink page="ai">如何描述需求与检查 AI 的交付</GuideLink>
      </section>
      <section className="lf-paper">
        <h2>自己开发的最短路径</h2>
        <p>准备匹配预览版本的熔炉仓库、Node.js 24 和 npm。在仓库根目录安装依赖，再生成尚不存在的独立源码目录。</p>
        <pre>{'npm ci\nnode tools/plugin-sdk/cli.mjs create ../my-plugin\nnode tools/plugin-sdk/cli.mjs check ../my-plugin\nnode tools/plugin-sdk/cli.mjs pack ../my-plugin ../my-plugin.sfplugin'}</pre>
        <p>创建后修改 manifest.json 中的 ID、名称、作者、许可和版本，再编辑 src/index.tsx。只使用公开 SDK；check 和 pack 成功后，还要在测试作品中验证保存、刷新、停用及恢复。</p>
        <GuideLink page="develop">逐步制作章节检查便笺</GuideLink>
      </section>
      <section className="lf-paper">
        <h2>开发好了，怎样分享</h2>
        <ol><li><strong>直接分享文件：</strong>把 .sfplugin、准确依赖版本和使用说明交给对方，由对方从文件安装。</li><li><strong>维护社区目录：</strong>托管不可变包与 HTTPS 目录 JSON，填写真实 SHA-256 并配置跨域读取；用户添加目录后下载。</li><li><strong>申请官方收录：</strong>向仓库目录提交 PR，附源码、许可、使用效果及验收记录，等待维护者审核。</li></ol>
        <p>当前没有登录上传服务器。发布新内容要增加版本，保留旧包供恢复；不要在公开材料中包含私稿或密钥。</p>
        <GuideLink page="publish">查看目录格式、收录与升级流程</GuideLink>
      </section>
    </> : <>
      <section className="lf-paper">
        <h2>第一次安装与使用</h2>
        <ol><li>在“发现插件”下载参考插件，或使用“从文件安装”导入作者提供的 .sfplugin。</li><li>在“已安装”选择工作区、当前作品或当前世界，阅读作者、依赖与信任提示后启用。</li><li>在“插件工作台”打开功能；替换类插件到“世界历史”或“故事进程”查看。</li><li>保存一条内容并刷新。可先用“创建体验作品／世界”建立独立测试内容。</li></ol>
        <p>安装不等于启用。普通插件不需要额外安装 Node 或 Python；模型和外部服务另按插件说明配置。</p>
        <div className="sf-extension-actions"><Link className="lf-action" to={`/workshop/discover${query}`}>去发现插件</Link><GuideLink page="install">详细安装与升级教程</GuideLink></div>
      </section>
      <section className="lf-paper">
        <h2>你的数据保存在哪里</h2>
        <p>数据归当前作品或世界，保存在当前浏览器地址对应的本地数据库。停用与卸载保留数据；换浏览器或端口不会自动迁移。</p>
        <p>完整备份包含插件记录，不包含可执行安装包。换设备后导入备份，再安装匹配版本并确认启用。缺包时仍可在工作台查看原始记录。</p>
        <h3>出了问题怎么办</h3>
        <p>先备份并保留报错，不要清空浏览器数据。用“安全模式”跳过插件，停用故障包；升级和旧内容可在“数据恢复与操作记录”处理。</p>
        <p>原生界面插件属于可信同源代码。只启用可信作者的包，权限声明不是恶意代码沙箱。</p>
        <GuideLink page="troubleshooting">错误对照表与恢复步骤</GuideLink>
      </section>
    </>}
  </div>
}
