"""Fixed synthetic preset evaluation. No project input or production adoption.

Spectrogram/conversion adapted from MIT OpenVoice (Copyright 2024 MyShell.ai),
revision 74a1d147b17a8c3092dd5430504bd83ef6c7eb23. See OpenVoice-LICENSE.
Only its pure torch model modules are imported. No upstream text frontend,
reference-person extraction, remote code, optional watermark model or new deps.
"""
from pathlib import Path
import hashlib, importlib.metadata, json, os, resource, signal, sys, time, wave

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    started = time.monotonic()
    base = Path(__file__).resolve().parent
    profile_bytes = (base / 'timbre-eval-profile.json').read_bytes()
    p = json.loads(profile_bytes)
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192: raise ValueError('Oversized evaluation identity')
    v = json.loads(raw)
    if set(v) != {'meloRuntime', 'timbreRuntime', 'sourceWav', 'outputDir', 'profileSha256', 'workerSha256'}:
        raise ValueError('Only fixed evaluation paths and hashes are allowed')
    if v['profileSha256'] != sha(profile_bytes) or v['workerSha256'] != sha(Path(__file__).read_bytes()): raise ValueError('Evaluation source changed')
    registry = json.loads((base.parent.parent / 'src/lib/agent/ai-entry-registry.json').read_text())
    entries = [r for r in registry['limitedTransports'] if r['entryId'] == p['entryId']]
    if len(entries) != 1 or entries[0]['boundary'] != 'offline-fixture-audio-eval' or entries[0]['adoptAllowed'] is not False or entries[0]['allowedCallers'] != ['scripts/ttrpg-local-tts/timbre-evaluate.mjs']:
        raise ValueError('Unregistered fixed-fixture evaluation')
    if p['version'] != 1 or p['sourceSpeaker'] != 'zh' or p['maxCalls'] != 10 or len(p['targetSpeakers']) != 10 or p['network'] != 'disabled' or p['productInvocationAllowed'] is not False or p['adoptionAllowed'] is not False:
        raise ValueError('Unsupported fixed boundary')
    melo, root, output, source = (Path(v[k]).resolve() for k in ['meloRuntime', 'timbreRuntime', 'outputDir', 'sourceWav'])
    if output.parent != root / 'evaluations' or {x.name for x in output.iterdir()} != {'attempt.json', 'worker.log'}:
        raise ValueError('Output must belong to a new attempt')
    setup = json.loads((root / 'setup-receipt.json').read_text())
    runtime_profile = json.loads((melo / 'runtime-profile.json').read_text())
    if setup['status'] != 'passed' or (root / '.prepare.lock').exists() or sha((melo / 'runtime-profile.json').read_bytes()) != p['pythonAssetProfileSha256'] or json.loads((melo / 'setup-receipt.json').read_text())['status'] != 'passed':
        raise ValueError('Pinned runtime setup incomplete')
    if Path(sys.prefix).resolve() != melo / 'venv': raise ValueError('Do not create or use a replacement environment')
    for row in runtime_profile['pythonPackages']:
        if importlib.metadata.version(row['name']) != row['version']: raise ValueError('Package version drift')
    def verify_assets():
        if sha((base / 'timbre-eval-profile.json').read_bytes()) != v['profileSha256'] or sha(Path(__file__).read_bytes()) != v['workerSha256']: raise ValueError('Source drift')
        for row in p['source']['files']:
            if sha((root / 'vendor' / row['path']).read_bytes()) != row['sha256']: raise ValueError('Pinned source mismatch')
        for row in p['model']['files']:
            data = (root / 'models' / row['path']).read_bytes()
            actual = sha(data) if row['lfs'] else hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
            if len(data) != row['size'] or actual != (row['lfs']['oid'] if row['lfs'] else row['oid']): raise ValueError('Pinned model mismatch')
        if sha(source.read_bytes()) != p['fixture']['sourceWavSha256']: raise ValueError('Only the original public synthetic WAV is allowed')
    verify_assets()
    def offline(event, args):
        if event in {'socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.fork', 'os.forkpty'}:
            raise RuntimeError('Network and child processes disabled during fixed evaluation')
    sys.addaudithook(offline)
    def timeout(signum, frame): raise TimeoutError('Fixed total evaluation deadline')
    signal.signal(signal.SIGALRM, timeout); signal.alarm(p['timeoutMs'] // 1000 - 2)
    sys.path.insert(0, str(root / 'vendor'))
    import numpy as np
    import torch
    from openvoice.models import SynthesizerTrn
    torch.set_num_threads(2); torch.set_num_interop_threads(1)
    config = json.loads((root / 'models/converter/config.json').read_text())
    sr = config['data']['sampling_rate']
    if sr != 22050: raise ValueError('Only the verified exact 2:1 sampling profile is supported')
    with wave.open(str(source)) as wav:
        if wav.getframerate() != 44100 or wav.getnframes() != p['fixture']['sourceSamples'] or wav.getnchannels() != 1 or wav.getsampwidth() != 2: raise ValueError('Original fixed PCM mismatch')
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float64) / 32767
    # Linear-phase low-pass before exact 2:1 decimation. No speed/pitch effect,
    # no new scipy/librosa dependency, and no text or silent-part trimming.
    n = np.arange(-63, 64); taps = .475 * np.sinc(.475 * n) * np.kaiser(127, 8.6); taps /= taps.sum()
    audio = np.convolve(np.pad(audio, (63, 63), mode='reflect'), taps, mode='valid')[::2].astype(np.float32)
    torch.manual_seed(0)
    model = SynthesizerTrn(0, config['data']['filter_length'] // 2 + 1, n_speakers=config['data']['n_speakers'], **config['model']).cpu().eval()
    state = torch.load(root / 'models/converter/checkpoint.pth', map_location='cpu', weights_only=True)
    model.load_state_dict(state['model'], strict=True)
    source_se = torch.load(root / 'models/base_speakers/ses/zh.pth', map_location='cpu', weights_only=True)
    y = torch.from_numpy(audio)[None, :]
    fft, hop, win = (config['data'][k] for k in ['filter_length', 'hop_length', 'win_length'])
    y = torch.nn.functional.pad(y.unsqueeze(1), ((fft - hop) // 2, (fft - hop) // 2), mode='reflect').squeeze(1)
    spec = torch.stft(y, fft, hop_length=hop, win_length=win, window=torch.hann_window(win), center=False, normalized=False, onesided=True, return_complex=True)
    spec = torch.sqrt(spec.abs().square() + 1e-6)
    lengths = torch.LongTensor([spec.shape[-1]])
    result = {'status': 'running', 'entryId': p['entryId'], 'profileSha256': v['profileSha256'], 'workerSha256': v['workerSha256'],
              'evaluationOnly': True, 'adoptionAllowed': False, 'network': 'disabled', 'calls': 0, 'voices': [],
              'sourceAudioSha256': p['fixture']['sourceWavSha256'], 'sourceSpeaker': p['sourceSpeaker'], 'text': p['fixture']['text'],
              'resampling': '127-tap Kaiser low-pass FIR, exact 2:1 decimation; no tempo/pitch change',
              'watermark': 'optional upstream watermark model not loaded; no existing watermark removed', 'humanListeningAcceptance': 'unproven'}
    def save(): (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    save()
    with (output / 'calls.jsonl').open('x') as calls, torch.inference_mode():
        for preset in p['targetSpeakers']:
            if result['calls'] >= p['maxCalls']: raise ValueError('Physical inference budget exhausted')
            target = torch.load(root / 'models/base_speakers/ses' / (preset + '.pth'), map_location='cpu', weights_only=True)
            if source_se.shape != (1, 256, 1) or target.shape != source_se.shape or not torch.isfinite(target).all(): raise ValueError('Invalid official preset')
            result['calls'] += 1; save()
            calls.write(json.dumps({'event': 'requested', 'preset': preset, 'atNs': time.time_ns()}) + '\n'); calls.flush(); os.fsync(calls.fileno())
            torch.manual_seed(0)
            before = time.monotonic()
            converted = model.voice_conversion(spec, lengths, sid_src=source_se, sid_tgt=target, tau=p['tau'])[0][0, 0].float().numpy()
            if not np.isfinite(converted).all() or abs(len(converted) / sr - p['fixture']['sourceSamples'] / 44100) > .04: raise ValueError('Invalid/incomplete converted PCM')
            peak = float(np.abs(converted).max()); gain = min(1., .99 / peak) if peak else 0.
            pcm = np.rint(converted * gain * 32767).astype('<i2')
            rms = float(np.sqrt(np.mean((pcm.astype(np.float64) / 32767)**2)))
            if rms < .00001: raise ValueError('Silent converted speech')
            path = output / (preset + '.wav')
            with wave.open(str(path) + '.part', 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sr); wav.writeframes(pcm.tobytes())
            Path(str(path) + '.part').rename(path)
            row = {'preset': preset, 'sampleRate': sr, 'samples': len(pcm), 'durationSeconds': len(pcm)/sr, 'rms': rms, 'gain': gain,
                   'audioSha256': sha(path.read_bytes()), 'conversionWallSeconds': time.monotonic() - before}
            calls.write(json.dumps({'event': 'returned', **row}) + '\n'); calls.flush(); os.fsync(calls.fileno())
            result['voices'].append(row); save()
    verify_assets()
    usage = resource.getrusage(resource.RUSAGE_SELF)
    result.update(status='generated', wallSeconds=time.monotonic() - started, cpuSeconds=usage.ru_utime+usage.ru_stime, maxRssBytes=usage.ru_maxrss)
    save(); signal.alarm(0)

if __name__ == '__main__': main()
