"""Four native Chinese presets on fixed public text. No application input.

Reviewed Kokoro / Misaki Apache-2.0 modules, with upstream StyleTTS2 MIT
notices retained in the pinned asset directory. No reference-person audio.
"""
from pathlib import Path
import hashlib, importlib.metadata, json, os, resource, signal, sys, time, wave

def sha(b): return hashlib.sha256(b).hexdigest()

def main():
    started = time.monotonic()
    base = Path(__file__).resolve().parent
    profile_bytes = (base / 'native-voice-eval-profile.json').read_bytes()
    p = json.loads(profile_bytes)
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192: raise ValueError('Oversized evaluation paths')
    v = json.loads(raw)
    if set(v) != {'meloRuntime', 'nativeRuntime', 'outputDir', 'profileSha256', 'workerSha256'}:
        raise ValueError('Only the fixed native evaluation is allowed')
    if v['profileSha256'] != sha(profile_bytes) or v['workerSha256'] != sha(Path(__file__).read_bytes()): raise ValueError('Source changed')
    registry = json.loads((base.parent.parent / 'src/lib/agent/ai-entry-registry.json').read_text())
    rows = [r for r in registry['limitedTransports'] if r['entryId'] == p['entryId']]
    if len(rows) != 1 or rows[0]['boundary'] != 'offline-fixture-audio-eval' or rows[0]['adoptAllowed'] is not False or rows[0]['allowedCallers'] != ['scripts/ttrpg-local-tts/native-voice-evaluate.mjs']:
        raise ValueError('Unregistered fixed native evaluation')
    if p['version'] != 1 or p['network'] != 'disabled' or p['adoptionAllowed'] is not False or p['productInvocationAllowed'] is not False or p['maxCalls'] != 4 or len(p['voices']) != 4:
        raise ValueError('Unsupported boundary')
    melo, root, output = (Path(v[k]).resolve() for k in ['meloRuntime', 'nativeRuntime', 'outputDir'])
    if output.parent != root / 'evaluations' or {x.name for x in output.iterdir()} != {'attempt.json', 'worker.log'}: raise ValueError('Output must be a new attempt')
    if Path(sys.prefix).resolve() != melo / 'venv' or sha((melo / 'runtime-profile.json').read_bytes()) != p['sharedPythonAssetProfileSha256']:
        raise ValueError('Shared interpreter identity changed')
    for row in json.loads((melo / 'runtime-profile.json').read_text())['pythonPackages']:
        if importlib.metadata.version(row['name']) != row['version']: raise ValueError('Shared package drift')
    def verify():
        if sha((base / 'native-voice-eval-profile.json').read_bytes()) != v['profileSha256'] or sha(Path(__file__).read_bytes()) != v['workerSha256']: raise ValueError('Source drift')
        for row in p['sourceFiles']:
            data = (root / 'original' / row['path']).read_bytes()
            if sha(data) != row['sha256']: raise ValueError('Original source mismatch')
            text = data.decode()
            patch = next(x for x in p['patches'] if x['path'] == row['path'])
            for edit in patch['edits']:
                if text.count(edit['old']) != 1: raise ValueError('Patch base mismatch')
                text = text.replace(edit['old'], edit['new'])
            if text.encode() != (root / 'vendor' / row['path']).read_bytes() or sha(text.encode()) != patch['sha256']: raise ValueError('Derived source mismatch')
        for row in p['overlayFiles']:
            data = (root / 'overlay' / row['path']).read_bytes()
            if len(data) != row['bytes'] or sha(data) != row['sha256']: raise ValueError('Overlay mismatch')
        for row in p['licenses']:
            if sha((root / 'licenses' / row['path']).read_bytes()) != row['sha256']: raise ValueError('License missing')
        for row in p['modelFiles']:
            data = (root / 'models' / row['path']).read_bytes()
            actual = sha(data) if row.get('lfs') else hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
            if len(data) != row['size'] or actual != (row['lfs']['oid'] if row.get('lfs') else row['oid']): raise ValueError('Model identity mismatch')
        for asset, lock in [(melo, '.setup.lock'), (root, '.prepare.lock')]:
            if (asset / lock).exists() or json.loads((asset / 'setup-receipt.json').read_text())['status'] != 'passed': raise ValueError('Setup incomplete')
    verify()
    def offline(event, args):
        if event in {'socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.fork', 'os.forkpty'}:
            raise RuntimeError('Evaluation network and child processes disabled')
    sys.addaudithook(offline)
    def timeout(signum, frame): raise TimeoutError('Fixed evaluation deadline')
    signal.signal(signal.SIGALRM, timeout); signal.alarm(p['timeoutMs'] // 1000 - 2)
    sys.path[:0] = [str(root / 'vendor'), str(root / 'overlay')]
    import numpy as np
    import torch
    from kokoro.model import KModel
    from misaki.zh_frontend import ZHFrontend
    if any(x in sys.modules for x in ['kokoro.pipeline', 'misaki.en', 'pypinyin_dict', 'misaki.transcription']): raise ValueError('Unexpected multilingual or mixed-source frontend')
    torch.set_num_threads(2); torch.set_num_interop_threads(1); torch.manual_seed(0)
    # The same complete public text. Only its punctuation is mapped to the
    # upstream Chinese frontend's model vocabulary; no arbitrary text/numbers.
    text = p['fixture'].replace('，', ', ').replace('。', '. ').strip()
    phonemes, tokens = ZHFrontend()(text)
    if ''.join(t.text for t in tokens) != ''.join(text.split()) or '❓' in phonemes: raise ValueError('Text/phoneme coverage incomplete')
    model = KModel(repo_id=p['model']['repo'], config=str(root / 'models/config.json'), model=str(root / 'models/kokoro-v1_1-zh.pth')).cpu().eval()
    if len(phonemes) + 2 > model.context_length or any(c not in model.vocab for c in phonemes): raise ValueError('Do not truncate or drop fixed text')
    result = {'status': 'running', 'entryId': p['entryId'], 'profileSha256': v['profileSha256'], 'workerSha256': v['workerSha256'],
              'text': p['fixture'], 'phonemes': phonemes, 'tokens': [t.text for t in tokens], 'network': 'disabled',
              'adoptionAllowed': False, 'calls': 0, 'voices': [], 'speed': p['speed'], 'humanListeningAcceptance': 'unproven',
              'largeMixedSourceLexiconLoaded': False, 'referencePersonAudio': False}
    def save(): (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    save()
    with (output / 'calls.jsonl').open('x') as calls, torch.inference_mode():
        for voice in p['voices']:
            preset = torch.load(root / 'models/voices' / (voice + '.pt'), map_location='cpu', weights_only=True)
            if preset.ndim != 3 or preset.shape[1:] != (1, 256) or len(preset) <= len(phonemes) or not torch.isfinite(preset).all(): raise ValueError('Invalid native preset')
            if result['calls'] >= p['maxCalls']: raise ValueError('Inference budget exhausted')
            result['calls'] += 1; save()
            calls.write(json.dumps({'event': 'requested', 'voice': voice, 'atNs': time.time_ns()}) + '\n');calls.flush();os.fsync(calls.fileno())
            torch.manual_seed(0); before = time.monotonic()
            audio = model(phonemes, preset[len(phonemes)], speed=p['speed']).float().numpy()
            if audio.ndim != 1 or not np.isfinite(audio).all() or not 5 <= len(audio) / p['sampleRate'] <= p['maxSecondsPerVoice']: raise ValueError('Invalid/incomplete audio')
            peak = float(np.abs(audio).max()); gain = min(1., .99 / peak) if peak else 0.
            pcm = np.rint(audio * gain * 32767).astype('<i2')
            rms = float(np.sqrt(np.mean((pcm.astype(np.float64) / 32767)**2)))
            if rms < .00001: raise ValueError('Silent speech')
            target = output / (voice + '.wav')
            with wave.open(str(target) + '.part', 'wb') as w:
                w.setnchannels(1);w.setsampwidth(2);w.setframerate(p['sampleRate']);w.writeframes(pcm.tobytes())
            Path(str(target) + '.part').rename(target)
            row = {'voice': voice, 'audioSha256': sha(target.read_bytes()), 'sampleRate': p['sampleRate'], 'samples': len(pcm),
                   'durationSeconds': len(pcm) / p['sampleRate'], 'rms': rms, 'gain': gain, 'wallSeconds': time.monotonic() - before}
            calls.write(json.dumps({'event': 'returned', **row}) + '\n');calls.flush();os.fsync(calls.fileno())
            result['voices'].append(row);save()
    verify()
    usage = resource.getrusage(resource.RUSAGE_SELF)
    result.update(status='generated', wallSeconds=time.monotonic()-started, cpuSeconds=usage.ru_utime+usage.ru_stime, maxRssBytes=usage.ru_maxrss)
    save();signal.alarm(0)

if __name__ == '__main__': main()
