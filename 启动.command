#!/bin/bash
# StoryForge 故事熔炉 - Mac 一键启动

# 切换到脚本所在的项目文件夹（双击运行时很关键）
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ============================================"
echo "     StoryForge 故事熔炉  一键启动 (Mac)"
echo "     （第一次用会自动帮你装好运行环境）"
echo "  ============================================"
echo ""
echo "  说明：这个终端窗口是程序的“控制台”，"
echo "        它运行期间不要关闭；用完直接关掉它就停止了。"
echo ""

# ========== 第一步：检测运行环境 Node.js ==========
echo "  [1/4] 正在检查运行环境（Node.js）..."
if command -v node >/dev/null 2>&1; then
  echo "  [1/4] 运行环境正常 (Node.js $(node -v))"
  echo ""
else
  echo ""
  echo "  [提示] 你的电脑还没有装运行环境，需要先装一下（只需装这一次）。"
  echo ""
  if command -v brew >/dev/null 2>&1; then
    echo "  检测到可以自动安装。正在通过 Homebrew 安装 Node.js..."
    echo "  （过程中可能让你输入开机密码，输入时屏幕看不到字是正常的，输完按回车）"
    echo ""
    brew install node
    echo ""
    echo "  ============================================"
    echo "  [完成] 运行环境已安装好！请关闭此窗口，"
    echo "         重新双击“启动.command”再来一次。"
    echo "  ============================================"
    echo ""
    read -n 1 -s -r -p "  按任意键关闭..."
    exit 0
  else
    echo "  你的电脑暂时无法自动安装，需要你手动装一下 Node.js（很简单）："
    echo ""
    echo "    1. 接下来会自动帮你打开下载网页"
    echo "    2. 在网页上点带“LTS”字样的绿色按钮下载（选 macOS 版）"
    echo "    3. 下载完双击安装包，一路点“继续/安装”直到完成"
    echo "    4. 装完后重新双击“启动.command”即可"
    echo ""
    read -n 1 -s -r -p "  按任意键打开下载网页..."
    open "https://nodejs.org/zh-cn"
    echo ""
    exit 0
  fi
fi

# ========== 第二步：安装项目依赖（仅第一次需要） ==========
if [ ! -d "node_modules" ]; then
  echo "  [2/4] 第一次运行，正在下载项目所需的小组件..."
  echo "        （约 1-2 分钟，需要联网，不要关窗口）"
  echo ""
  if ! npm install; then
    echo ""
    echo "  [提示] 下载失败，多半是网络问题。正在切换国内下载源后重试..."
    npm config set registry https://registry.npmmirror.com
    if ! npm install; then
      echo ""
      echo "  [错误] 还是失败了，请检查网络后重新双击“启动.command”。"
      read -n 1 -s -r -p "  按任意键关闭..."
      exit 1
    fi
  fi
fi
echo "  [2/4] 项目组件就绪"
echo ""

# ========== 第三、四步：启动 + 自动开浏览器 ==========
echo "  [3/4] 正在启动 StoryForge..."
echo "  [4/4] 启动后会自动打开浏览器；如果没自动打开，"
echo "        请手动把下面这行地址复制到浏览器："
echo ""
echo "        http://localhost:1111/storyforge/"
echo ""
echo "  ----------------------------------------------------"
echo "   提示：用完直接关闭这个终端窗口即可停止。"
echo "   下次再用，还是双击“启动.command”就行（不用再装环境）。"
echo "  ----------------------------------------------------"
echo ""
npm run dev
