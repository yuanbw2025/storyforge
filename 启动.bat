@echo off
chcp 65001 >nul 2>&1
title StoryForge 故事熔炉 - 一键启动
color 0E

echo.
echo   ============================================
echo      StoryForge 故事熔炉  一键启动
echo      （第一次用会自动帮你装好运行环境）
echo   ============================================
echo.
echo   说明：这个黑色窗口是程序的"控制台"，
echo         它运行期间不要关闭；用完直接关掉它就停止了。
echo.

:: ========== 第一步：检测运行环境 Node.js ==========
echo   [1/4] 正在检查运行环境（Node.js）...
where node >nul 2>&1
if %ERRORLEVEL% equ 0 goto NODE_OK

:: ---------- 没有 Node：尝试用系统自带的 winget 安装 ----------
echo.
echo   [提示] 你的电脑还没有装运行环境，需要先装一下（只需装这一次）。
echo.
where winget >nul 2>&1
if %ERRORLEVEL% neq 0 goto NO_WINGET

echo   检测到可以自动安装。即将通过 Windows 官方应用商店安装 Node.js。
echo   过程中如果弹出"是否允许更改"的窗口，请点【是】。
echo.
pause
echo.
echo   正在安装 Node.js，请耐心等待（约 1-3 分钟，不要关窗口）...
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo   ============================================
echo   [完成] 运行环境已安装好！
echo.
echo   ▶ 请按以下操作（重要）：
echo     1. 关闭这个黑色窗口
echo     2. 重新双击"启动.bat"再来一次
echo        （这样新装的环境才能生效）
echo   ============================================
echo.
pause
exit /b 0

:NO_WINGET
echo   你的电脑暂时无法自动安装，需要你手动装一下 Node.js（很简单）：
echo.
echo     1. 接下来会自动帮你打开下载网页
echo     2. 在网页上点击带"LTS"字样的绿色按钮下载
echo     3. 下载完双击安装包，一路点"下一步/Next"直到完成
echo     4. 装完后【重启电脑】，再重新双击"启动.bat"
echo.
pause
start https://nodejs.org/zh-cn
echo.
echo   网页已打开。装好 Node.js 并重启电脑后，再来双击"启动.bat"即可。
echo.
pause
exit /b 0

:NODE_OK
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   [1/4] 运行环境正常 ^(Node.js %NODE_VER%^)
echo.

:: ========== 第二步：安装项目依赖（仅第一次需要） ==========
if exist "node_modules" goto DEPS_OK
echo   [2/4] 第一次运行，正在下载项目所需的小组件...
echo         （约 1-2 分钟，需要联网，不要关窗口）
echo.
call npm install
if %ERRORLEVEL% equ 0 goto DEPS_OK
echo.
echo   [提示] 下载失败，多半是网络问题。正在切换国内下载源后重试...
call npm config set registry https://registry.npmmirror.com
call npm install
if %ERRORLEVEL% equ 0 goto DEPS_OK
echo.
echo   [错误] 还是失败了，请检查网络后重新双击"启动.bat"。
echo.
pause
exit /b 1

:DEPS_OK
echo   [2/4] 项目组件就绪
echo.

:: ========== 第三、四步：启动 + 自动开浏览器 ==========
echo   [3/4] 正在启动 StoryForge...
echo   [4/4] 启动后会自动打开浏览器；如果没自动打开，
echo         请手动把下面这行地址复制到浏览器：
echo.
echo         http://localhost:1111/storyforge/
echo.
echo   ----------------------------------------------------
echo    提示：用完直接关闭这个黑色窗口即可停止。
echo    下次再用，还是双击"启动.bat"就行（不用再装环境）。
echo   ----------------------------------------------------
echo.
call npm run dev
