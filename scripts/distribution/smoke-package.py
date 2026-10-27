"""Exercise the actual bundled runtime and built assets without author browser data."""
import json, subprocess, sys, time, urllib.request, tempfile, zipfile
from pathlib import Path
archive = Path(sys.argv[1]).resolve()
temporary = tempfile.TemporaryDirectory(prefix='storyforge-package-')
with zipfile.ZipFile(archive) as bundle:
    bundle.extractall(temporary.name)
    for info in bundle.infolist():
        path = Path(temporary.name) / info.filename
        if path.is_file() and sys.platform != 'win32':
            path.chmod((info.external_attr >> 16) & 0o777 or 0o644)
root = next(Path(temporary.name).iterdir())
node = root / 'runtime' / ('node.exe' if sys.platform == 'win32' else 'node')
proc = subprocess.Popen([str(node), str(root / 'scripts/distribution/server.mjs'), '--no-open'], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    for attempt in range(80):
        if proc.poll() is not None:
            raise RuntimeError(f'Bundled runtime exited with {proc.returncode}: ' + proc.stdout.read().decode())
        try:
            html = urllib.request.urlopen('http://localhost:1111/storyforge/', timeout=2).read().decode()
            break
        except Exception:
            time.sleep(.25)
    else:
        raise RuntimeError('Bundled server did not start.')
    assert '/storyforge/assets/' in html and 'showcase-entry' not in html
    manifest = json.loads((root / 'release.json').read_text())
    # Use the actual shipped Node and physical helper files, not the checkout.
    # Hash validation is not inference or a device/listening acceptance claim.
    module = (root / 'scripts/ttrpg-local-tts/product-contract.mjs').as_uri()
    script = 'import {productProfiles,assertProductImplementation} from ' + json.dumps(module) + '; for (const p of productProfiles) assertProductImplementation(p); console.log(JSON.stringify({profileIds:productProfiles.map(p=>p.profileId),modelCalls:0}))'
    helper = subprocess.run([str(node), '--input-type=module', '-e', script], cwd=root, capture_output=True, text=True, timeout=30, check=True)
    print(json.dumps({'launch': 'passed', 'release': manifest, 'localTtsResources': json.loads(helper.stdout)}))
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    temporary.cleanup()
