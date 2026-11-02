"""Check signed APK build evidence and freeze the exact bytes accepted by upgrade CI.

This does not replace apksigner, application/version checks or device upgrade tests.
No APK is extracted or executed, and no author data or credentials are read.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import zipfile


SOURCE = 'storyforge/build-source.json'
PREFIX = 'assets/public/'
BRIDGE_FILES = {'capacitor.js', 'capacitor.plugins.json', 'cordova.js', 'cordova_plugins.js'}
PHASES = ['seed.txt', 'baseline-restart.txt', 'restore.txt', 'restart.txt']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with pathlib.Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(apk, commit, tree, version, web=None):
    require(re.fullmatch('[a-f0-9]{40}', commit) and re.fullmatch('[a-f0-9]{40}', tree), 'Exact source commit/tree required')
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate APK ZIP entry')
        require(PREFIX + SOURCE in names, 'APK has no build-source evidence; do not reuse a legacy same-version APK')
        info = json.loads(archive.read(PREFIX + SOURCE))
        require(set(info) == {'schema', 'version', 'packageVersion', 'sourceCommit', 'sourceTree', 'dirty', 'files'}, 'Invalid build-source fields')
        require(info['schema'] == 'storyforge.android-build-source' and info['version'] == 1, 'Unsupported build-source evidence')
        require(info['sourceCommit'] == commit and info['sourceTree'] == tree, 'APK source commit/tree mismatch')
        require(info['packageVersion'] == version and info['dirty'] is False, 'APK version mismatch or dirty build source')
        require(isinstance(info['files'], list) and info['files'], 'Empty APK payload evidence')
        expected = set()
        for row in info['files']:
            require(isinstance(row, dict) and set(row) == {'path', 'bytes', 'sha256'}, 'Invalid payload row')
            name = row['path']
            require(isinstance(name, str) and name and not name.startswith('/') and '\\' not in name
                    and all(part not in ['', '.', '..'] for part in name.split('/')) and name != SOURCE,
                    'Unsafe payload evidence path')
            require(name not in expected, 'Duplicate payload evidence path')
            expected.add(name)
            require(type(row['bytes']) is int and row['bytes'] >= 0 and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'Invalid payload digest')
            require(PREFIX + name in names, 'APK payload entry missing')
            entry = archive.getinfo(PREFIX + name)
            require((entry.external_attr >> 16) & 0o170000 != 0o120000, 'APK payload symlink rejected')
            with archive.open(entry) as stream:
                sha = hashlib.file_digest(stream, 'sha256').hexdigest()
            require(entry.file_size == row['bytes'] and sha == row['sha256'], 'APK payload bytes differ from build evidence')
            if web is not None:
                target = pathlib.Path(web) / name
                require(target.is_file() and not target.is_symlink() and target.stat().st_size == row['bytes']
                        and digest(target) == sha, 'APK payload differs from the current independently built web payload')
        require({'index.html', 'storyforge/index.html'} <= expected, 'APK entry pages missing')
        actual = {name[len(PREFIX):] for name in names if name.startswith(PREFIX) and not name.endswith('/')}
        require(actual - {SOURCE} - BRIDGE_FILES == expected - BRIDGE_FILES, 'Unexpected or missing APK web payload')
        if web is not None:
            local = {p.relative_to(web).as_posix() for p in pathlib.Path(web).rglob('*') if p.is_file()}
            require(local - {SOURCE} == expected, 'Current web payload file set differs from APK')
            require(json.loads((pathlib.Path(web) / SOURCE).read_text()) == info, 'Current build-source evidence differs from APK')
    return {'schema': 'storyforge.android-verified-source', 'version': 1, 'sourceCommit': commit,
            'sourceTree': tree, 'packageVersion': version, 'apkSha256': digest(apk),
            'apkBytes': pathlib.Path(apk).stat().st_size, 'webFiles': len(expected)}


def record_tested(apk, preflight, directory, commit, tree, version):
    current = verify(apk, commit, tree, version)
    require(json.loads(pathlib.Path(preflight).read_text()) == current, 'APK changed after upgrade preflight')
    phases = {}
    for name in PHASES:
        p = pathlib.Path(directory) / name
        body = p.read_text()
        require(re.search(r'\bOK \(1 test\)', body) and 'FAILURES' not in body, 'A complete successful upgrade phase is required')
        phases[name] = digest(p)
    return {'schema': 'storyforge.android-tested-release', 'version': 1, 'source': current, 'phases': phases}


def check_tested(apk, receipt, directory, commit, tree, version):
    evidence = json.loads(pathlib.Path(receipt).read_text())
    require(set(evidence) == {'schema', 'version', 'source', 'phases'} and evidence['schema'] == 'storyforge.android-tested-release'
            and evidence['version'] == 1, 'Invalid tested-release receipt')
    require(evidence['source'] == verify(apk, commit, tree, version), 'Publish APK differs from the exact upgrade-tested APK')
    require(set(evidence['phases']) == set(PHASES), 'Incomplete upgrade phase receipt')
    for name in PHASES:
        p = pathlib.Path(directory) / name
        require(p.is_file() and digest(p) == evidence['phases'][name], 'Upgrade evidence changed after verification')
        require(re.search(r'\bOK \(1 test\)', p.read_text()) and 'FAILURES' not in p.read_text(), 'Upgrade phase is not successful')
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['verify', 'record-tested', 'check-tested'])
    parser.add_argument('apk')
    parser.add_argument('--commit', required=True)
    parser.add_argument('--tree', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--web')
    parser.add_argument('--preflight')
    parser.add_argument('--receipt')
    parser.add_argument('--phases')
    args = parser.parse_args()
    if args.operation == 'verify':
        result = verify(args.apk, args.commit, args.tree, args.version, args.web)
    elif args.operation == 'record-tested':
        require(args.preflight and args.phases, 'Upgrade preflight and phase directory required')
        result = record_tested(args.apk, args.preflight, args.phases, args.commit, args.tree, args.version)
    else:
        require(args.receipt and args.phases, 'Tested receipt and phase directory required')
        result = check_tested(args.apk, args.receipt, args.phases, args.commit, args.tree, args.version)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile) as error:
        print('Android release source verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
