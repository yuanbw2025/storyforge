"""Pinned offline product speech. No fixture resolver or evaluation inference.
The owning Node job creates the input/claim before launch. All outputs stay in
that job, including partial WAV, call journal and failures. No retry/adoption.
"""
from pathlib import Path
import hashlib, json, os, re, resource, signal, subprocess, sys, time, wave, math, threading, contextlib, importlib.util

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))

def sha(data):
    return hashlib.sha256(data).hexdigest()

def utf16(text):
    return len(text.encode('utf-16-le')) // 2

class OriginalLease:
    """A repeated wall-clock expiry cannot extend an orphan's authorization."""
    def __init__(self, job_key, input_hash, nonce, duration_ms):
        self.identity = (job_key, input_hash, nonce)
        self.duration_ms = duration_ms
        self.sequence, self.deadline, self.expired = 0, 0., False
        self.lock = threading.Lock()

    def valid(self, value):
        if not isinstance(value, dict) or set(value) != {'jobKey', 'inputArtifactHash', 'launchNonce', 'sequence', 'expiresAt'}:
            return False
        sequence, expiry = value['sequence'], value['expiresAt']
        if (value['jobKey'], value['inputArtifactHash'], value['launchNonce']) != self.identity or type(sequence) is not int or sequence < 1 or type(expiry) not in {int, float} or not math.isfinite(expiry):
            return False
        with self.lock:
            now = time.monotonic()
            if self.expired or self.sequence and now >= self.deadline:
                self.expired = True
                return False
            if sequence > self.sequence:
                remaining = min(self.duration_ms, expiry - time.time() * 1000) / 1000
                if remaining <= 0:
                    self.expired = True
                    return False
                self.sequence, self.deadline = sequence, now + remaining
            return now < self.deadline

def atomic(path, value):
    temp = path.with_name(path.name + '.tmp')
    with temp.open('w') as f:
        json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    temp.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(directory)
    finally: os.close(directory)

def plan_segments(text, profile):
    if not isinstance(text, str) or not text or utf16(text) > profile['maxReadingUtf16']:
        raise ValueError('Invalid complete normalized reading')
    rows, start, offset = [], 0, 0
    while start < len(text):
        end = start
        while end < len(text) and utf16(text[start:end + 1]) <= profile['maxSegmentUtf16']: end += 1
        if end < len(text):
            cuts = [i + 1 for i in range(start, end) if text[i] in '.!?,; ' and utf16(text[start:i + 1]) >= profile['maxSegmentUtf16'] // 2]
            if cuts: end = cuts[-1]
        part = text[start:end]
        if not part or not re.search(r'[\u4e00-\u9fa5]', part):
            raise ValueError('A complete segment has no supported speakable text; choose a reading explicitly')
        rows.append({'index': len(rows), 'readingOffsetUtf16': offset, 'readingLengthUtf16': utf16(part), 'text': part, 'textSha256': sha(part.encode())})
        offset += utf16(part); start = end
    if len(rows) > min(profile['maxSegments'], profile['maxSpeechInferenceCalls'], profile['maxSpeechInferenceCalls'] if profile['engine']=='qwen3-tts-mlx-metal' else profile['maxTextEncoderCalls']) or ''.join(r['text'] for r in rows) != text:
        raise ValueError('Complete reading exceeds the bounded segment plan')
    return rows

def main():
    if len(sys.argv) != 5 or sys.argv[1] != '--runtime-dir' or sys.argv[3] != '--job-dir': raise ValueError('Only operator-owned runtime/job paths are allowed')
    base = Path(__file__).resolve().parent; repo = base.parent.parent
    root, job = Path(sys.argv[2]).resolve(), Path(sys.argv[4]).resolve()
    if job.parent != root / 'product-jobs-v2' or not re.fullmatch('[a-f0-9]{64}', job.name) or job.stat().st_uid != os.getuid(): raise ValueError('Invalid owned job directory')
    payload_bytes = (job / 'input.json').read_bytes()
    if len(payload_bytes) > 65536: raise ValueError('Input exceeds physical byte limit')
    payload = json.loads(payload_bytes); e = payload['execution']
    selected=e.get('profile',{});is_qwen=selected.get('engine')=='qwen3-tts-mlx-metal'
    files={'melo-zh-product-v2':'product-profile.json','qwen-mlx-uncle_fu-product-v1':'product-qwen-uncle_fu-v1.json','qwen-mlx-serena-product-v1':'product-qwen-serena-v1.json'}
    if selected.get('profileId') not in files: raise ValueError('Unknown product voice')
    profile_file=base/files[selected['profileId']];p=json.loads(profile_file.read_text())
    claim = json.loads((job / 'start.json').read_text())
    if claim.get('kind') != 'start-authorized' or sha(payload['jobKey'].encode()) != job.name or e['profile'] != p or e['profileHash'] != sha(canonical(p).encode()) or payload['inputArtifactHash'] != sha(canonical(e).encode()) or claim['inputArtifactHash'] != payload['inputArtifactHash'] or claim['jobKey'] != payload['jobKey']:
        raise ValueError('Original job, profile or launch claim changed')
    sources = p['implementation']['sources']
    expected = ['scripts/ttrpg-local-tts/product-contract.mjs', 'scripts/ttrpg-local-tts/product-worker.py', 'scripts/ttrpg-local-tts/product-jobs.mjs', 'scripts/ttrpg-local-tts/product-bridge.mjs', 'scripts/ttrpg-local-tts/engine.py', 'scripts/ttrpg-local-tts/reading_frontend.py', 'scripts/ttrpg-local-tts/reading-preview.mjs', 'src/lib/ttrpg/open-local-voice-transport.ts', 'src/lib/ttrpg/open-voice-execution.ts']
    if is_qwen: expected+=['scripts/ttrpg-local-tts/qwen-product.py','scripts/ttrpg-local-tts/qwen-native-eval-profile.json','src/lib/ttrpg/open-voice-execution-input.ts','src/lib/ttrpg/open-voice-product-profile.ts']
    def source_check():
        if json.loads(profile_file.read_text()) != p or [r['path'] for r in sources] != expected or any(sha((repo / r['path']).read_bytes()) != r['sha256'] for r in sources): raise ValueError('Pinned product implementation changed')
    source_check()
    if p['version'] != (3 if is_qwen else 2) or p['network'] != 'disabled' or p['adoptionAllowed'] is not False or p['automaticRetryAllowed'] is not False or p['maxSegmentAudioSeconds'] != 60:
        raise ValueError('Unsupported product boundary')
    atomic(job / 'worker-started.json', {'jobKey': payload['jobKey'], 'inputArtifactHash': payload['inputArtifactHash'], 'launchNonce': claim['nonce'], 'pid': os.getpid(),
                                       'processStart': subprocess.check_output(['ps', '-p', str(os.getpid()), '-o', 'lstart='], text=True, env={**os.environ, 'LC_ALL': 'C'}).strip()})
    started = time.monotonic(); cancelled = False
    def stop(signum, frame):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    # Keep a bounded orphan alive only while a currently authorized client
    # renews its original lease. The owning Node also enforces it externally.
    original_lease = OriginalLease(payload['jobKey'], payload['inputArtifactHash'], claim['nonce'], p['authorizationLeaseMs'])
    def lease_valid():
        try:
            lease = json.loads((job / 'lease.json').read_text())
            return original_lease.valid(lease)
        except (OSError, ValueError, KeyError): return False
    finished = threading.Event()
    def watchdog():
        nonlocal cancelled
        expired_at = None
        while not finished.wait(.25):
            expired = (job / 'cancel-request.json').exists() or not lease_valid() or time.monotonic() - started > p['timeoutMs'] / 1000
            if expired:
                cancelled = True
                if expired_at is None: expired_at = time.monotonic()
                if time.monotonic() - expired_at > 5: os._exit(3)
    threading.Thread(target=watchdog, name='original-voice-lease', daemon=True).start()
    def offline(event, args):
        if event in {'socket.connect', 'socket.getaddrinfo'}: raise RuntimeError('Network disabled in product speech worker')
        if event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.fork', 'os.forkpty'}: raise RuntimeError('Nested processes disabled in product speech worker')
    sys.addaudithook(offline)
    sys.path.insert(0, str(base)); sys.dont_write_bytecode = True
    from reading_frontend import load_normalizer, preview
    # Reuse only the pinned asset/source verifier, never engine.main/load_case.
    from engine import verify_runtime, sha_file
    reading_profile = json.loads((base / 'reading-profile.json').read_text())
    reading = e['reading']; source = e['source']
    normalizer = load_normalizer(root, reading_profile)
    actual = preview(source['text'], reading['overrides'], normalizer, reading_profile)
    actual.update(schema='storyforge.ttrpg-local-tts-reading-preview', version=1, profileHash=sha(canonical(reading_profile).encode()), normalizerSha256=reading_profile['normalizerSha256'], network='disabled')
    if actual['status'] != 'ready-for-reading-review' or actual['normalizedText'] != reading['normalizedText'] or actual['normalizedTextSha256'] != reading['normalizedTextSha256'] or sha(canonical(actual).encode()) != reading['previewHash'] or reading['profile'] != reading_profile:
        raise ValueError('Actual pinned frontend does not reproduce the exact confirmed reading')
    segments = plan_segments(actual['normalizedText'], p)
    if any(name.split('.')[0] in {'torch', 'transformers', 'melo'} for name in sys.modules): raise ValueError('Model loaded before original reading verification')
    progress = {'schema': 'storyforge.ttrpg-local-tts-worker-progress', 'version': 1, 'jobKey': payload['jobKey'], 'inputArtifactHash': payload['inputArtifactHash'], 'pid': os.getpid(), 'profileHash': e['profileHash'], 'segments': [],
                'usage': {'textEncoderCallsStarted': 0, 'textEncoderCallsCompleted': 0, 'speechCallsStarted': 0, 'speechCallsCompleted': 0}, 'status': 'verified-reading'}
    atomic(job / 'progress.json', progress)
    with (job / 'calls.jsonl').open('a') as ledger:
        def journal(kind, index):
            ledger.write(canonical({'type': kind, 'segment': index, 'atNs': time.time_ns()}) + '\n'); ledger.flush(); os.fsync(ledger.fileno())
        def current():
            source_check()
            if cancelled or not lease_valid() or (job / 'cancel-request.json').exists(): raise InterruptedError('Cancellation requested or original authorization lease expired')
            if time.monotonic() - started > p['timeoutMs'] / 1000: raise TimeoutError('Product speech deadline exceeded')
        current()
        _, imports = verify_runtime(base, root)
        native_rows=[];native_root=None
        if is_qwen:
            native_root=Path(os.environ.get('STORYFORGE_QWEN_ASSET_DIR','')).resolve()
            admission=json.loads((native_root/'product-asset-admission-v1.json').read_text())
            if admission.get('status')!='verified-assets-only' or admission.get('nativeAssetProfileSha256')!=p['nativeAssetProfileSha256'] or p['profileId'] not in admission.get('productProfileIds',[]): raise ValueError('Native product assets have not been explicitly admitted')
            spec=importlib.util.spec_from_file_location('storyforge_qwen_product',base/'qwen-product.py')
            engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
            native_descriptor=json.loads((base/'qwen-native-eval-profile.json').read_text())
            engine.verify_assets(base,native_root,root,native_descriptor,p['nativeAssetProfileSha256']);current()
            synthesize,native_evidence=engine.load_native(base,native_root,root,native_descriptor,current)
            import numpy as np
        else:
            cache = root / 'cache'; cache.mkdir(exist_ok=True)
            os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false', TMPDIR=str(cache), HF_HOME=str(cache / 'huggingface'), STORYFORGE_TTS_ENCODER_DIR=str(root / 'models/textEncoder'))
            sys.path.insert(0, str(imports))
            import torch
            import numpy as np
            from transformers import AutoModelForMaskedLM
            from melo.models import SynthesizerTrn
            from melo.text import cleaned_text_to_sequence, chinese_mix
            from melo import commons
            torch.set_num_threads(p['cpuThreads']); torch.set_num_interop_threads(1); torch.manual_seed(0)
            current()
            encoder = AutoModelForMaskedLM.from_pretrained(str(root / 'models/textEncoder'), local_files_only=True, trust_remote_code=False).to('cpu').eval()
            config = json.loads((root / 'models/speech/config.json').read_text())
            if config['data']['sampling_rate'] != p['sampleRate'] or p['speaker'] not in config['data']['spk2id']: raise ValueError('Pinned speaker/sample rate changed')
            model = SynthesizerTrn(len(config['symbols']), config['data']['filter_length'] // 2 + 1, config['train']['segment_size'] // config['data']['hop_length'], n_speakers=config['data']['n_speakers'], num_tones=config['num_tones'], num_languages=config['num_languages'], **config['model']).to('cpu').eval()
            model.load_state_dict(torch.load(root / 'models/speech/checkpoint.pth', map_location='cpu', weights_only=True)['model'], strict=True)
        sr = p['sampleRate']; hop = None if is_qwen else math.prod(config['model']['upsample_rates']); samples = 0; sum_squares = 0.; peak = 0.
        with wave.open(str(job / 'audio.wav.part'), 'wb') as wav, (contextlib.nullcontext() if is_qwen else torch.inference_mode()):
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sr)
            for segment in segments:
                current(); text = segment['text']
                if is_qwen:
                    current();progress['usage']['speechCallsStarted']+=1;journal('speech.requested',segment['index']);atomic(job/'progress.json',progress)
                    audio,native=synthesize(text,p['speaker'],p['maxCodecTokensPerSegment'])
                    progress['usage']['speechCallsCompleted']+=1;journal('speech.returned',segment['index']);native_rows.append({'index':segment['index'],**native})
                else:
                    phones, tones, word2ph = chinese_mix.g2p(text)
                    phone, tone, language = cleaned_text_to_sequence(phones, tones, 'ZH_MIX_EN', {s: i for i, s in enumerate(config['symbols'])})
                    if config['data']['add_blank']:
                        phone = commons.intersperse(phone, 0); tone = commons.intersperse(tone, 0); language = commons.intersperse(language, 0)
                        word2ph = [count * 2 for count in word2ph]; word2ph[0] += 1
                    current(); progress['usage']['textEncoderCallsStarted'] += 1; journal('encoder.requested', segment['index']); atomic(job / 'progress.json', progress)
                    features = encoder(**chinese_mix.tokenizer(text, return_tensors='pt'), output_hidden_states=True).hidden_states[-3][0]
                    progress['usage']['textEncoderCallsCompleted'] += 1; journal('encoder.returned', segment['index'])
                    if len(word2ph) != features.shape[0] or sum(word2ph) != len(phone): raise ValueError('Exact segment phoneme alignment failed')
                    bert = torch.repeat_interleave(features, torch.tensor(word2ph), dim=0).T
                    model.storyforge_max_frames = math.floor(min(p['maxSegmentAudioSeconds'], p['maxAudioSeconds'] - samples / sr) * sr / hop)
                    if model.storyforge_max_frames < 1: raise ValueError('No remaining sample budget')
                    current(); progress['usage']['speechCallsStarted'] += 1; journal('speech.requested', segment['index']); atomic(job / 'progress.json', progress)
                    audio = model.infer(torch.LongTensor(phone)[None, :], torch.LongTensor([len(phone)]), torch.LongTensor([config['data']['spk2id'][p['speaker']]]), torch.LongTensor(tone)[None, :], torch.LongTensor(language)[None, :], torch.zeros(1, 1024, len(phone)), bert[None, :, :], sdp_ratio=.2, noise_scale=.6, noise_scale_w=.8, length_scale=1)[0][0, 0].float().numpy()
                    progress['usage']['speechCallsCompleted'] += 1; journal('speech.returned', segment['index'])
                if not len(audio) or not np.isfinite(audio).all() or len(audio) > sr * p['maxSegmentAudioSeconds'] or samples + len(audio) > sr * p['maxAudioSeconds'] or 44 + (samples + len(audio)) * 2 > p['maxAudioBytes']: raise ValueError('Physical speech samples exceed the exact profile')
                original_peak = float(np.abs(audio).max()); gain = min(1., .99 / original_peak) if original_peak else 0.
                pcm = np.rint(audio * gain * 32767).astype('<i2'); normalized_pcm = pcm.astype('float64') / 32767
                energy = float(np.sum(normalized_pcm ** 2))
                if math.sqrt(energy / len(pcm)) < .00001: raise ValueError('Speech segment is silent')
                wav.writeframes(pcm.tobytes()); sum_squares += energy; peak = max(peak, float(np.abs(normalized_pcm).max()))
                progress['segments'].append({k: segment[k] for k in ['index', 'readingOffsetUtf16', 'readingLengthUtf16', 'textSha256']} | {'sampleOffset': samples, 'sampleCount': len(pcm), 'gain': gain})
                samples += len(pcm); progress['status'] = 'synthesizing'; atomic(job / 'progress.json', progress)
                current()
        current()
        with (job / 'audio.wav.part').open('rb') as completed: os.fsync(completed.fileno())
        (job / 'audio.wav.part').rename(job / 'audio.wav')
        # Verify assets again after inference; a modified installation cannot
        # become accepted raw output merely because it matched before loading.
        verify_runtime(base, root); current()
        usage = resource.getrusage(resource.RUSAGE_SELF)
        result = {'schema': 'storyforge.ttrpg-local-tts-product-result', 'version': 2 if is_qwen else 1, 'status': 'generated', 'jobKey': payload['jobKey'], 'inputArtifactHash': payload['inputArtifactHash'], 'profileHash': e['profileHash'],
                  'implementationHash': sha(canonical(p['implementation']).encode()), 'sourceTextHash': source['textHash'], 'normalizedTextSha256': reading['normalizedTextSha256'], 'previewHash': reading['previewHash'],
                  'audio': {'mimeType': 'audio/wav', 'byteSize': (job / 'audio.wav').stat().st_size, 'sha256': sha_file(job / 'audio.wav'), 'sampleRate': sr, 'channels': 1, 'sampleFormat': 's16le', 'samples': samples, 'durationMs': round(samples * 1000 / sr)},
                  'alignment': {'kind': 'normalized-reading-segments', 'wordAlignmentProvided': False, 'originalPart': source['part'], 'segments': progress['segments']}, 'usage': progress['usage'],
                  'metrics': {'wallMs': round((time.monotonic() - started) * 1000), 'cpuMs': round((usage.ru_utime + usage.ru_stime) * 1000), 'maxRssBytes': usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024), 'rms': math.sqrt(sum_squares / samples), 'peak': peak},
                  'network': 'disabled', 'candidateAccepted': False, 'adoptionAllowed': False, 'humanListening': 'unproven'}
        if is_qwen:
            engine.verify_assets(base,native_root,root,native_descriptor,p['nativeAssetProfileSha256']);current()
            result['native']={**native_evidence(p['speaker'],p['nativeAssetProfileSha256']),'segments':native_rows}
        atomic(job / 'result.json', result)
        finished.set()

if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print('ttrpg-product-voice: ' + str(error), file=sys.stderr)
        raise SystemExit(2 if isinstance(error, InterruptedError) else 1)
