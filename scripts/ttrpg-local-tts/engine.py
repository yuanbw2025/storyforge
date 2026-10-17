"""Fixed-fixture CPU evaluation, adapted from MIT MeloTTS inference.

The installed vendor/LICENSE and pinned source receipt retain upstream notices.
No author input, database, adoption, playback, online model loading or retries.
"""
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import resource
import sys
import time
import wave


def sha_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''): h.update(data)
    return h.hexdigest()


def load_case(base, case_id):
    contract = json.loads((base / 'eval-contract.json').read_text())
    raw = (base / 'eval-cases.json').read_bytes()
    if (contract['schema'] != 'storyforge.ttrpg-local-tts-eval-contract' or contract['version'] != 2
        or contract['entryId'] != 'ttrpg.local-voice.eval' or contract['maxChars'] != 300
        or contract['maxAudioSeconds'] != 60 or contract['timeoutMs'] != 120000
        or hashlib.sha256(raw).hexdigest() != contract['fixtureSha256']): raise ValueError('Fixed fixture contract mismatch')
    cases = json.loads(raw)
    selected = [row for row in cases['cases'] if row['id'] == case_id]
    if len(selected) != 1 or not 0 < len(selected[0]['text']) <= 300: raise ValueError('Unknown or oversized fixture')
    return selected[0], contract


def derive_source(name, source):
    """Only exact, checksum-pinned upstream files reach these small patches."""
    if name == 'melo/text/__init__.py':
        source = source[:source.index('def get_bert(')] + 'def get_bert(*args, **kwargs):\n    raise RuntimeError("Feature extraction is owned by the offline CPU engine")\n'
    if name == 'melo/text/chinese_mix.py':
        source = source.replace('from .english import g2p as g2p_en', 'def g2p_en(*args, **kwargs):\n    raise ValueError("Mixed script is outside this Chinese-only evaluation profile")', 1)
        source = source.replace("model_id = 'bert-base-multilingual-uncased'", "model_id = os.environ['STORYFORGE_TTS_ENCODER_DIR']", 1)
        source = source.replace('AutoTokenizer.from_pretrained(model_id)', 'AutoTokenizer.from_pretrained(model_id, local_files_only=True, trust_remote_code=False)', 1)
        start = source.index('def get_bert_feature('); end = source.index('from .chinese import _g2p', start)
        source = source[:start] + 'def get_bert_feature(*args, **kwargs):\n    raise RuntimeError("Use the owning offline CPU engine")\n\n' + source[end:]
    if name == 'melo/models.py':
        original = '        y_lengths = torch.clamp_min(torch.sum(w_ceil, [1, 2]), 1).long()'
        if source.count(original) != 1: raise ValueError('Duration guard patch no longer matches upstream')
        source = source.replace(original, original + '\n        if torch.any(y_lengths > self.storyforge_max_frames):\n            raise ValueError("Predicted speech duration exceeds the evaluation limit")', 1)
    return source


def verify_runtime(base, root):
    expected = base / 'runtime-profile.json'
    profile = json.loads(expected.read_text())
    owner = json.loads((root / 'owner.json').read_text())
    receipt = json.loads((root / 'setup-receipt.json').read_text())
    if (profile['schema'] != 'storyforge.ttrpg-local-tts-runtime-profile' or profile['version'] != 1
        or profile['productInvocationAllowed'] is not False or profile['profileId'] != 'melo-zh-eval-v1'
        or owner['profileHash'] != sha_file(expected) or owner['profileId'] != profile['profileId']
        or receipt['status'] != 'passed' or receipt['profileHash'] != owner['profileHash']
        or (root / '.setup.lock').exists() or sha_file(root / 'runtime-profile.json') != sha_file(expected)):
        raise ValueError('Pinned runtime setup is not complete')
    for component in profile['models']:
        for row in component['files']:
            path = root / 'models' / component['role'] / row['path']
            if path.stat().st_size != row['bytes']: raise ValueError('Model size mismatch')
            if row['sha256']:
                if sha_file(path) != row['sha256']: raise ValueError('Model SHA-256 mismatch')
            else:
                data = path.read_bytes()
                if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != row['gitBlobSha1']: raise ValueError('Pinned model metadata bytes mismatch')
    for row in profile['pythonPackages']:
        if importlib.metadata.version(row['name']) != row['version']: raise ValueError('Python package version mismatch: ' + row['name'])
    # Keep original source and a deterministic derivative, each with its own hash.
    imports = root / 'import-kernels'
    rows = []
    for row in profile['source']['files']:
        path = root / 'vendor' / row['path']
        if sha_file(path) != row['sha256']: raise ValueError('Kernel source mismatch')
        target = imports / row['path']; target.parent.mkdir(parents=True, exist_ok=True)
        data = path.read_bytes()
        if path.suffix == '.py': data = derive_source(row['path'], data.decode()).encode()
        if target.exists() and target.read_bytes() != data: raise ValueError('Existing derivative differs from this engine')
        if not target.exists(): target.write_bytes(data)
        rows.append({'path': row['path'], 'upstreamSha256': row['sha256'], 'derivativeSha256': hashlib.sha256(data).hexdigest()})
    (imports / 'source-receipt.json').write_text(json.dumps({'upstreamRevision': profile['source']['revision'],
        'engineSha256': sha_file(Path(__file__)), 'frontendPatchNotes': profile['patches'],
        'durationPatch': 'Reject predicted frame counts over 60 seconds before attention/decoder allocation; never truncate speech.',
        'files': rows}, indent=2) + '\n')
    return profile, imports


def main():
    started = time.monotonic()
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192: raise ValueError('Evaluation payload exceeds limit')
    payload = json.loads(raw)
    if set(payload) != {'caseId', 'runtimeDir', 'outputDir'}: raise ValueError('Only fixed-case evaluation arguments are allowed')
    base = Path(__file__).resolve().parent
    selected, contract = load_case(base, payload['caseId'])
    root = Path(payload['runtimeDir']).resolve(); output = Path(payload['outputDir']).resolve()
    if output.parent != root / 'evaluations' or not re.fullmatch(r'run-[a-f0-9-]{36}', output.name): raise ValueError('Invalid evaluation output directory')
    if not output.is_dir() or {p.name for p in output.iterdir()} != {'attempt.json'}: raise ValueError('Evaluation output must be a new attempt')
    # Reject rather than silently deleting Latin, emojis or unsupported glyphs.
    if not re.fullmatch(r'[\u4e00-\u9fa5\d。！？；：，、（）《》“”‘’…,.!?\- \r\n]+', selected['text']):
        result = {'schema': 'storyforge.ttrpg-local-tts-eval-result', 'version': 1, 'caseId': selected['id'],
                  'status': 'expected-rejection', 'reasonCode': 'unsupported-script', 'modelCalled': False,
                  'evaluationOnly': True, 'adoptAllowed': False}
        (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n'); return
    profile, imports = verify_runtime(base, root)
    cache = root / 'cache'; cache.mkdir(exist_ok=True)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                      TOKENIZERS_PARALLELISM='false', TMPDIR=str(cache), HF_HOME=str(cache / 'huggingface'),
                      STORYFORGE_TTS_ENCODER_DIR=str(root / 'models/textEncoder'))
    def offline(event, args):
        if event in {'socket.connect', 'socket.getaddrinfo'}: raise RuntimeError('Network is disabled during speech evaluation')
    sys.addaudithook(offline)
    sys.path.insert(0, str(imports))
    import torch
    import numpy as np
    from transformers import AutoModelForMaskedLM
    from melo.models import SynthesizerTrn
    from melo.text import cleaned_text_to_sequence
    from melo.text import chinese_mix
    from melo import commons
    torch.set_num_threads(2); torch.set_num_interop_threads(1); torch.manual_seed(0)
    normalized = chinese_mix.text_normalize(selected['text'])
    if normalized != selected['expectedNormalizedText']:
        raise ValueError('Fixed normalization changed or omitted source content')
    phones, tones, word2ph = chinese_mix.g2p(normalized)
    config = json.loads((root / 'models/speech/config.json').read_text())
    phone, tone, language = cleaned_text_to_sequence(phones, tones, 'ZH_MIX_EN', {s: i for i, s in enumerate(config['symbols'])})
    if config['data']['add_blank']:
        phone = commons.intersperse(phone, 0); tone = commons.intersperse(tone, 0); language = commons.intersperse(language, 0)
        word2ph = [count * 2 for count in word2ph]; word2ph[0] += 1
    encoder = AutoModelForMaskedLM.from_pretrained(str(root / 'models/textEncoder'), local_files_only=True, trust_remote_code=False).to('cpu').eval()
    model = SynthesizerTrn(len(config['symbols']), config['data']['filter_length'] // 2 + 1,
            config['train']['segment_size'] // config['data']['hop_length'], n_speakers=config['data']['n_speakers'],
            num_tones=config['num_tones'], num_languages=config['num_languages'], **config['model']).to('cpu').eval()
    weights = torch.load(root / 'models/speech/checkpoint.pth', map_location='cpu', weights_only=True)
    model.load_state_dict(weights['model'], strict=True)
    sr = config['data']['sampling_rate']; hop = math.prod(config['model']['upsample_rates'])
    model.storyforge_max_frames = math.floor(contract['maxAudioSeconds'] * sr / hop)
    with torch.inference_mode():
        features = encoder(**chinese_mix.tokenizer(normalized, return_tensors='pt'), output_hidden_states=True).hidden_states[-3][0]
        if len(word2ph) != features.shape[0] or sum(word2ph) != len(phone): raise ValueError('Text/token/phoneme alignment mismatch')
        ja_bert = torch.repeat_interleave(features, torch.tensor(word2ph), dim=0).T
        audio = model.infer(torch.LongTensor(phone)[None, :], torch.LongTensor([len(phone)]),
                torch.LongTensor([config['data']['spk2id']['ZH']]), torch.LongTensor(tone)[None, :],
                torch.LongTensor(language)[None, :], torch.zeros(1, 1024, len(phone)), ja_bert[None, :, :],
                sdp_ratio=.2, noise_scale=.6, noise_scale_w=.8, length_scale=1)[0][0, 0].float().numpy()
    if not sr // 4 <= len(audio) <= sr * contract['maxAudioSeconds'] or not np.isfinite(audio).all(): raise ValueError('Invalid or oversized speech samples')
    peak = float(np.abs(audio).max()); gain = min(1.0, .99 / peak) if peak else 0
    audio = audio * gain; rms = float(np.sqrt(np.mean(audio ** 2)))
    if rms < .00001: raise ValueError('Generated speech is silent')
    with wave.open(str(output / 'audio.wav.part'), 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sr)
        wav.writeframes(np.rint(audio * 32767).astype('<i2').tobytes())
    (output / 'audio.wav.part').replace(output / 'audio.wav')
    usage = resource.getrusage(resource.RUSAGE_SELF)
    result = {'schema': 'storyforge.ttrpg-local-tts-eval-result', 'version': 1, 'caseId': selected['id'],
              'status': 'generated', 'modelCalled': True, 'evaluationOnly': True, 'adoptAllowed': False,
              'profileHash': sha_file(base / 'runtime-profile.json'), 'fixtureSha256': contract['fixtureSha256'],
              'text': selected['text'], 'normalizedText': normalized, 'sampleRate': sr, 'samples': len(audio),
              'durationMs': round(1000 * len(audio) / sr), 'peakBeforeGain': peak, 'appliedGain': gain, 'rms': rms,
              'audioSha256': sha_file(output / 'audio.wav'), 'wallSeconds': time.monotonic() - started,
              'cpuSeconds': usage.ru_utime + usage.ru_stime, 'maxRssBytes': usage.ru_maxrss,
              'threads': 2, 'network': 'disabled', 'humanListeningAcceptance': 'unproven'}
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
