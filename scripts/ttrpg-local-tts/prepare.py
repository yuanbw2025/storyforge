"""Install the pinned local evaluation runtime; never invoke a model."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def inspect_packages(python, root, packages):
    code = '''import importlib.metadata as m,json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
print(json.dumps([{'name':d.metadata['Name'].lower().replace('_','-'),'version':d.version,
'inside':d.locate_file('').resolve().is_relative_to(root)} for d in m.distributions()]))'''
    value = subprocess.run([str(python), '-I', '-c', code, str(root / 'venv')], capture_output=True, text=True)
    if value.returncode or len(value.stdout) > 1024 * 1024: raise RuntimeError('Cannot inspect private Python environment')
    rows = json.loads(value.stdout)
    expected = {row['name'].lower().replace('_', '-'): row['version'] for row in packages}
    installed = {}
    for row in rows:
        if not row['inside'] or row['name'] in installed or row['name'] not in {*expected, 'pip'}:
            raise RuntimeError('Private environment contains an unexpected package; preserve it for inspection')
        if row['name'] != 'pip' and row['version'] != expected[row['name']]:
            raise RuntimeError('Installed package version differs from the pinned profile')
        installed[row['name']] = row['version']
    return installed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime-dir', type=Path, required=True)
    args = parser.parse_args()
    profile_path = Path(__file__).with_name('runtime-profile.json')
    profile = json.loads(profile_path.read_text())
    assert profile['schema'] == 'storyforge.ttrpg-local-tts-runtime-profile' and profile['version'] == 1
    assert profile['profileId'] == 'melo-zh-eval-v1' and profile['productInvocationAllowed'] is False
    assert sys.version_info[:2] == (3, 12) and sys.platform == 'darwin' and platform.machine() == 'arm64'
    root = args.runtime_dir.resolve()
    root.parent.mkdir(exist_ok=True, parents=True)
    disk = os.statvfs(root.parent)
    assert disk.f_bavail * disk.f_frsize >= profile['maxInstalledBytes'] + profile['minimumFreeBytes'], 'Insufficient disk budget'
    root.mkdir(exist_ok=True)
    identity = {'schema': 'storyforge.ttrpg-local-tts-runtime-owner', 'version': 1,
                'profileId': profile['profileId'], 'profileHash': digest(profile_path)}
    owner = root / 'owner.json'
    if owner.exists():
        assert json.loads(owner.read_text()) == identity, 'Existing runtime belongs to another profile'
    else:
        assert not any(root.iterdir()), 'Refuse to adopt existing files'
        owner.write_text(json.dumps(identity, indent=2) + '\n')
    lock = root / '.setup.lock'
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.write(fd, str(os.getpid()).encode()); os.close(fd)
    if (root / '.eval.lock').exists():
        lock.unlink()
        raise RuntimeError('An evaluation already owns this runtime; inspect its receipt first')
    stamp = str(time.time_ns())
    receipt = {**identity, 'status': 'running', 'pid': os.getpid(), 'startedAt': time.time(),
               'modelCalled': False, 'steps': [], 'modelFiles': [], 'sourceFiles': [], 'downloads': []}
    def save():
        (root / 'setup-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    def command(name, argv):
        log = root / f'{stamp}-{name}.log'
        with log.open('w') as output:
            value = subprocess.run(argv, stdout=output, stderr=subprocess.STDOUT,
                                   env={**os.environ, 'PYTHONNOUSERSITE': '1', 'PIP_DISABLE_PIP_VERSION_CHECK': '1'})
        receipt['steps'].append({'name': name, 'exitCode': value.returncode, 'log': log.name}); save()
        if value.returncode:
            raise RuntimeError(f'{name} failed ({value.returncode}); inspect the local log')
    def download(url, target, expected_bytes=None, expected_hash=None, git_hash=None):
        target.parent.mkdir(exist_ok=True, parents=True)
        def valid(file):
            if not file.is_file() or (expected_bytes is not None and file.stat().st_size != expected_bytes): return False
            if expected_hash and digest(file) != expected_hash: return False
            if git_hash:
                data = file.read_bytes()
                if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != git_hash: return False
            return True
        if not valid(target):
            if target.exists(): raise RuntimeError('Existing file does not match the pinned profile: ' + target.name)
            temporary = target.with_suffix(target.suffix + '.part')
            if not valid(temporary):
                before_bytes = temporary.stat().st_size if temporary.exists() else 0
                resume = ['--continue-at', '-'] if temporary.exists() and temporary.stat().st_size else []
                value = subprocess.run(['/usr/bin/curl', '--http1.1', '-fsSL', '--connect-timeout', '20', '--max-time', '600',
                                        *resume, '--output', str(temporary), url], capture_output=True)
                # Preserve the transport evidence locally; these diagnostics can
                # include machine-specific proxy details and are not exported.
                log_name = f'{stamp}-download-{hashlib.sha256(str(target.relative_to(root)).encode()).hexdigest()[:12]}.log'
                (root / log_name).write_bytes(value.stderr[:65536])
                receipt['downloads'].append({'path': str(target.relative_to(root)), 'httpVersion': '1.1',
                    'resumedFromBytes': before_bytes, 'partialBytesAfter': temporary.stat().st_size if temporary.exists() else 0,
                    'exitCode': value.returncode, 'stderrLog': log_name, 'stderrTruncated': len(value.stderr) > 65536})
                save()
                if value.returncode: raise RuntimeError(f'Pinned download failed ({value.returncode}); partial bytes retained: {target.name}')
                if not valid(temporary): raise RuntimeError('Pinned file integrity failed: ' + target.name)
            temporary.replace(target)
        disk = os.statvfs(root)
        if disk.f_bavail * disk.f_frsize < profile['minimumFreeBytes']: raise RuntimeError('Free disk floor reached')
        return {'path': str(target.relative_to(root)), 'bytes': target.stat().st_size, 'sha256': digest(target)}
    try:
        previous = root / 'setup-receipt.json'
        if previous.exists():
            history = root / 'setup-history'; history.mkdir(exist_ok=True)
            (history / f'{stamp}.json').write_bytes(previous.read_bytes())
        save()
        py = root / 'venv/bin/python3'
        if not py.exists(): command('create-venv', [sys.executable, '-I', '-m', 'venv', str(root / 'venv')])
        packages = profile['pythonPackages']
        assert len({row['name'].lower() for row in packages}) == len(packages)
        assert not any(row['name'].lower() in {'pykakasi', 'unidecode', 'num2words', 'librosa', 'torchaudio', 'gruut', 'g2p-en'} for row in packages)
        def requirements(rows, file):
            lines = []
            for row in rows:
                url = urllib.parse.urlparse(row['url'])
                assert url.scheme == 'https' and url.hostname == 'files.pythonhosted.org' and not url.username and not url.query
                assert re.fullmatch('[a-f0-9]{64}', row['sha256'])
                lines.append(f"{row['name']} @ {row['url']} --hash=sha256:{row['sha256']}")
            file.write_text('\n'.join(lines) + '\n')
        for name, rows in [('bootstrap', [row for row in packages if row['name'].lower() in {'setuptools', 'wheel', 'packaging'}]),
                           ('profile', packages)]:
            installed = inspect_packages(py, root, packages)
            missing = [row for row in rows if row['name'].lower().replace('_', '-') not in installed]
            if missing:
                requirements(missing, root / f'{name}.lock')
                command(f'install-{name}', [str(py), '-I', '-m', 'pip', '--isolated', 'install', '--no-index', '--no-cache-dir',
                        '--no-deps', '--no-build-isolation', '--require-hashes', '-r', str(root / f'{name}.lock')])
            else:
                receipt['steps'].append({'name': f'reuse-exact-{name}', 'exitCode': 0}); save()
        command('pip-check', [str(py), '-I', '-m', 'pip', '--isolated', 'check'])
        installed = inspect_packages(py, root, packages)
        if len(installed) != len(packages) + 1: raise RuntimeError('Pinned Python profile is incomplete')
        source = profile['source']
        assert source['repo'] == 'myshell-ai/MeloTTS' and re.fullmatch('[a-f0-9]{40}', source['revision'])
        vendor = root / 'vendor'
        for row in source['files']:
            name = row['path']; assert not name.startswith('/') and '..' not in Path(name).parts
            assert name == 'LICENSE' or name.startswith('melo/')
            target = vendor / name
            # Original verified source is retained once; patches go into a separate import tree.
            receipt['sourceFiles'].append(download(f"https://raw.githubusercontent.com/{source['repo']}/{source['revision']}/{name}",
                                                  target, row['bytes'], row['sha256']))
        for model in profile['models']:
            assert model['repo'] in {'myshell-ai/MeloTTS-Chinese', 'google-bert/bert-base-multilingual-uncased'}
            assert re.fullmatch('[a-f0-9]{40}', model['revision']) and model['role'] in {'speech', 'textEncoder'}
            for row in model['files']:
                assert Path(row['path']).name == row['path']
                receipt['modelFiles'].append(download(f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{row['path']}",
                        root / 'models' / model['role'] / row['path'], row['bytes'], row['sha256'], row['gitBlobSha1'] if not row['sha256'] else None))
                save()
        logical = sum(file.stat().st_size for file in root.rglob('*') if file.is_file() and not file.is_symlink())
        if logical > profile['maxInstalledBytes']: raise RuntimeError('Installed logical bytes exceed profile budget')
        receipt.update(status='passed', installedLogicalBytes=logical, finishedAt=time.time())
        (root / 'runtime-profile.json').write_bytes(profile_path.read_bytes())
    except BaseException as error:
        receipt.update(status='failed', error=str(error), finishedAt=time.time()); raise
    finally:
        save(); lock.unlink()
    print(json.dumps({'status': receipt['status'], 'installedLogicalBytes': receipt['installedLogicalBytes'],
                      'modelCalled': False, 'productInvocationAllowed': False}))


if __name__ == '__main__':
    main()
