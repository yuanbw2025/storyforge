@echo off
chcp 65001 >nul 2>&1
title StoryForge - 故事熔炉

echo.
echo  ╔═══════════════════════════════════╗
echo  ║   StoryForge - 故事熔炉           ║
echo  ║   AI 辅助长篇小说写作工具          ║
echo  ╚═══════════════════════════════════╝
echo.

:: 检查 Node.js 是否安装
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [错误] 未检测到 Node.js！
    echo.
    echo  请先安装 Node.js：
    echo  下载地址：https://nodejs.org/zh-cn
    echo  建议选择 LTS（长期支持）版本
    echo  安装时勾选 "Add to PATH"，安装完后重新打开本文件
    echo.
    pause
    exit /b 1
)

:: 显示 Node.js 版本
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [√] Node.js 版本: %NODE_VER%

:: 检查是否已安装依赖
if not exist "node_modules" (
    echo.
    echo  [!] 首次运行，正在安装依赖（可能需要 1-2 分钟）...
    echo.
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo  [错误] 依赖安装失败！请检查网络连接后重试。
        echo  如果在国内，可以尝试先运行：
        echo  npm config set registry https://registry.npmmirror.com
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [√] 依赖安装完成！
)

echo.
echo  [*] 正在启动 StoryForge...
echo  [*] 启动后浏览器会自动打开，如果没有请手动访问：
echo.
echo      http://localhost:5175/storyforge/
echo.
echo  [*] 关闭此窗口即可停止服务
echo  ─────────────────────────────────────
echo.

:: 启动开发服务器
call npm run dev
