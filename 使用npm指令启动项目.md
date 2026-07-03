# 使用 npm 指令启动项目

StoryForge 现在推荐直接使用 npm 启动。请按下面步骤操作。

这套方法不需要你懂代码，只要照着一步一步做。它会从源码启动 StoryForge，并在浏览器里打开本地页面。

## 你需要准备什么

1. 一台 Windows 电脑。
2. StoryForge 的源码文件夹。
3. Node.js。

如果你还没有 Node.js，请先安装：

1. 打开官网：https://nodejs.org/
2. 下载 LTS 版本。
3. 一路点击“下一步 / Next”安装。
4. 安装完成后，重启一次电脑。

## 第一步：下载并准备 StoryForge 源码文件夹

请在 GitHub Release 页面下载 `Source code (zip)`，不要下载旧版本里的 exe 或 portable 包。

下载后：

1. 找到下载的 `storyforge-main.zip` 或类似名字的压缩包。
2. 右键选择“全部解压”。
3. 解压后进入文件夹。
4. 确认里面能看到 `package.json` 这个文件。

注意：一定要进入包含 `package.json` 的那一层文件夹。如果看不到 `package.json`，说明你还在外层目录，需要再点进去一层。

## 第二步：在 StoryForge 文件夹里打开命令行

推荐方法：

1. 打开包含 `package.json` 的 StoryForge 文件夹。
2. 在文件夹空白处按住 `Shift`，同时点击鼠标右键。
3. 选择“在终端中打开”或“在 PowerShell 中打开”。

如果你看不到这个选项，也可以这样做：

1. 点击文件夹上方的地址栏。
2. 输入 `powershell`。
3. 按回车。

打开后，会出现一个蓝色或黑色窗口。

## 第三步：安装依赖

在命令行窗口里输入：

```powershell
npm install
```

然后按回车。

第一次会下载很多文件，可能需要几分钟。请耐心等待，直到命令行不再滚动，并且重新出现可以输入命令的位置。

如果中途看到一些黄色提示，一般可以先不用管。

## 第四步：启动 StoryForge

继续在同一个命令行窗口里输入：

```powershell
npm run dev
```

然后按回车。

如果启动成功，你会看到类似这样的内容：

```text
Local: http://localhost:1111/storyforge/
```

这时请不要关闭这个命令行窗口。窗口开着，StoryForge 才会继续运行。

## 第五步：打开浏览器访问

打开 Chrome、Edge 或其他浏览器，在地址栏输入：

```text
http://localhost:1111/storyforge/
```

或者：

```text
http://127.0.0.1:1111/storyforge/
```

如果能看到 StoryForge 页面，就说明启动成功了。

## 每次以后怎么启动

以后不需要每次都重新 `npm install`。

日常使用只需要：

1. 进入 StoryForge 源码文件夹。
2. 在这个文件夹里打开 PowerShell。
3. 输入：

```powershell
npm run dev
```

4. 浏览器打开：

```text
http://localhost:1111/storyforge/
```

## 常见问题

### 提示 npm 不是内部或外部命令

说明 Node.js 没有安装好，或者安装后没有重启电脑。

处理方法：

1. 重新安装 Node.js LTS 版本：https://nodejs.org/
2. 安装完成后重启电脑。
3. 再重新打开 PowerShell。

### 提示端口 1111 被占用

说明电脑里可能已经有一个 StoryForge 或其他本地服务正在运行。

处理方法：

1. 关掉所有正在运行的 StoryForge 命令行窗口。
2. 关掉所有打开 StoryForge 的浏览器标签页。
3. 打开任务管理器。
4. 如果看到旧版本的 `StoryForge.exe`，选中后点击“结束任务”。
5. 回到 PowerShell，重新运行：

```powershell
npm run dev
```

### npm install 很慢或失败

可能是网络问题。

可以换个网络再试，或者稍后重试：

```powershell
npm install
```

### 页面还是提示重定向次数过多

请先换一个浏览器访问：

```text
http://localhost:1111/storyforge/
```

如果换浏览器可以打开，说明原浏览器缓存了旧的本地页面。

也可以在原浏览器里清理这个地址的站点数据：

1. 打开浏览器设置。
2. 搜索“网站数据”或“站点数据”。
3. 找到 `localhost` 和 `127.0.0.1`。
4. 删除它们的缓存/站点数据。
5. 重新访问：

```text
http://localhost:1111/storyforge/
```

## 重要提醒

- 使用 npm 启动时，命令行窗口不能关闭。
- 关闭命令行窗口后，StoryForge 本地服务也会停止。
- npm 启动不会删除你的浏览器数据。
- 如果你已经在 StoryForge 里写了作品，建议先在“数据管理”里导出 JSON 备份。
