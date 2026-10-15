"""Package the production build with a checksum-verified official Node runtime."""
import argparse, hashlib, io, json, shutil, subprocess, tarfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NODE_VERSION = '24.16.0'
TARGETS = {'windows-x64': ('win-x64', 'zip'), 'macos-arm64': ('darwin-arm64', 'tar.gz'), 'macos-x64': ('darwin-x64', 'tar.gz'), 'linux-x64': ('linux-x64', 'tar.gz')}

def build(target):
    platform, extension = TARGETS[target]
    version = json.loads((ROOT / 'package.json').read_text())['version']
    name = f'StoryForge-v{version}-{target}'
    staging = ROOT / 'release' / name
    if staging.exists():
        raise RuntimeError('Package staging already exists; use a fresh release directory.')
    if not (ROOT / 'dist/index.html').is_file():
        raise RuntimeError('Run npm run build first.')
    filename = f'node-v{NODE_VERSION}-{platform}.{extension}'
    base = f'https://nodejs.org/dist/v{NODE_VERSION}/'
    checks = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=60).read().decode()
    expected = next(line.split()[0] for line in checks.splitlines() if line.split()[-1] == filename)
    archive = urllib.request.urlopen(base + filename, timeout=120).read()
    if hashlib.sha256(archive).hexdigest() != expected:
        raise RuntimeError('Node runtime checksum mismatch.')
    staging.mkdir(parents=True)
    shutil.copytree(ROOT / 'dist', staging / 'web')
    (staging / 'runtime').mkdir()
    archive_root = f'node-v{NODE_VERSION}-{platform}'
    if extension == 'zip':
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            binary = bundle.read(f'{archive_root}/node.exe')
            license_text = bundle.read(f'{archive_root}/LICENSE')
    else:
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as bundle:
            binary = bundle.extractfile(f'{archive_root}/bin/node').read()
            license_text = bundle.extractfile(f'{archive_root}/LICENSE').read()
    node = staging / 'runtime' / ('node.exe' if target.startswith('windows') else 'node')
    node.write_bytes(binary); node.chmod(0o755)
    (staging / 'runtime/NODE-LICENSE.txt').write_bytes(license_text)
    for folder in ['distribution', 'local-codex']:
        destination = staging / 'scripts' / folder; destination.mkdir(parents=True)
        for path in (ROOT / 'scripts' / folder).glob('*.mjs'):
            if not path.name.endswith('.test.mjs'):
                shutil.copy2(path, destination / path.name)
    shutil.copy2(ROOT / 'LICENSE', staging / 'LICENSE')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    (staging / 'release.json').write_text(json.dumps({'version': version, 'commit': sha, 'target': target, 'nodeVersion': NODE_VERSION, 'nodeArchiveSha256': expected}, indent=2) + '\n')
    (staging / 'README.txt').write_text('StoryForge 故事熔炉 ' + version + '\n\n解压整个文件夹后启动，不要直接在 ZIP 中打开。\nWindows: 双击 Start-StoryForge.cmd\nmacOS: 双击 Start-StoryForge.command；若系统阻止，请在终端进入解压目录运行 bash Start-StoryForge.command。\nLinux: 在解压目录运行 bash Start-StoryForge.sh\n\n无需安装 Node.js 或 npm 依赖。浏览器地址固定为 http://localhost:1111/storyforge/ 。保持启动窗口运行，Ctrl+C 停止。\n作品保存在当前浏览器。升级前在旧版导出完整 JSON 备份；切换浏览器或地址不会自动转移数据。\n首次体验可在首页选择《雾港：失潮钟声》或内置游戏，无需 API。AI 创作需自行配置模型服务；Codex 订阅桥需另行安装并登录 Codex CLI。\n问题反馈：在通用设置打开“问题与故障反馈”，或在报错页查看故障摘要。不会自动上报；确认后带到官网表单，检查内容再提交。启动器故障仅保留技术类型和时间，位于用户目录 .storyforge/diagnostics/last-failure.json；启动失败时可在 https://docs.storyforge-lab.com/feedback/bug 手动填写或附上该文件。异常中断可能是强制关闭或断电，不等同于已确认崩溃。\n未封板的产品仍标为预览；打包不改变产品成熟度。\n官网 https://storyforge-lab.com\n知识库 https://docs.storyforge-lab.com\n\nExtract the entire folder before launching. No Node.js/npm installation is required. Keep the launcher window open. Works stay in the current browser; export a full backup before upgrading or switching browser/origin. AI creation requires your own provider; the optional Codex bridge requires separately installed and logged-in Codex CLI. Preview features retain their maturity labels.\n', encoding='utf-8')
    if target.startswith('windows'):
        (staging / 'Start-StoryForge.cmd').write_bytes(b'@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0scripts\\distribution\\server.mjs"\r\nif errorlevel 1 pause\r\n')
    else:
        launcher = staging / ('Start-StoryForge.command' if target.startswith('macos') else 'Start-StoryForge.sh')
        launcher.write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./runtime/node ./scripts/distribution/server.mjs\n'); launcher.chmod(0o755)
    output = ROOT / 'release' / f'{name}.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(staging.rglob('*')):
            if path.is_file():
                bundle.write(path, path.relative_to(staging.parent))
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
    print(json.dumps({'package': str(output), 'sha256': digest, 'bytes': output.stat().st_size, 'commit': sha}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('target', choices=TARGETS)
    build(parser.parse_args().target)
