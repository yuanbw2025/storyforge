"""Pinned native engine for the existing durable product worker only.
No fixture entry, browser path, cloning, automatic retry, playback or adoption.
The asset descriptor is read as frozen asset/source metadata, not authority.
"""
from pathlib import Path
import hashlib, importlib.metadata, json, os, sys

def sha(data): return hashlib.sha256(data).hexdigest()

def verify_assets(base, root, shared, p, expected_hash):
    if sha((base/'qwen-native-eval-profile.json').read_bytes()) != expected_hash: raise ValueError('Native asset descriptor changed')
    if root.is_symlink() or root.stat().st_uid != os.getuid() or not root.is_dir(): raise ValueError('Unowned native assets')
    if sha((shared/'runtime-profile.json').read_bytes()) != p['sharedPythonAssetProfileSha256']: raise ValueError('Shared runtime changed')
    for row in json.loads((shared/'runtime-profile.json').read_text())['pythonPackages']:
        if importlib.metadata.version(row['name']) != row['version']: raise ValueError('Shared environment drift')
    for row in p['sourceFiles']:
        data=(root/'original'/row['path']).read_bytes()
        if sha(data)!=row['sha256']:raise ValueError('Original source mismatch')
        patch=next(x for x in p['patches'] if x['path']==row['path']);text=data.decode()
        for edit in patch['edits']:
            if text.count(edit['old'])!=1:raise ValueError('Patch base mismatch')
            text=text.replace(edit['old'],edit['new'])
        if text.encode()!=(root/'vendor'/row['path']).read_bytes() or sha(text.encode())!=patch['sha256']:raise ValueError('Derived source mismatch')
    for row in p['overlayFiles']:
        file=root/'overlay'/row['path']
        if file.stat().st_size!=row['bytes'] or sha(file.read_bytes())!=row['sha256']:raise ValueError('Overlay mismatch')
    for row in p['licenses']:
        if sha((root/'licenses'/row['path']).read_bytes())!=row['sha256']:raise ValueError('License missing')
    for row in p['modelFiles']:
        file=root/'models'/row['path']
        if file.stat().st_size!=row['size']:raise ValueError('Model length mismatch')
        data=file.read_bytes();actual=sha(data) if row.get('lfs') else hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()
        if actual!=(row['lfs']['oid'] if row.get('lfs') else row['oid']):raise ValueError('Model hash mismatch')
    for asset,lock in [(shared,'.setup.lock'),(root,'.prepare.lock')]:
        if (asset/lock).exists() or json.loads((asset/'setup-receipt.json').read_text())['status']!='passed':raise ValueError('Asset setup incomplete')

def load_native(base, root, shared, p, current):
    sys.path[:0]=[str(root/'vendor'),str(root/'overlay')]
    import numpy as np
    import mlx.core as mx
    from transformers import AutoTokenizer
    from mlx_audio.utils import apply_quantization
    from mlx_audio.tts.models.qwen3_tts.qwen3_tts import Model
    from mlx_audio.tts.models.qwen3_tts.config import ModelConfig,Qwen3TTSTokenizerConfig
    from mlx_audio.tts.models.qwen3_tts.speech_tokenizer import Qwen3TTSSpeechTokenizer
    if not mx.metal.is_available() or str(mx.default_device())!='Device(gpu, 0)':raise ValueError('Pinned Metal device unavailable; no silent fallback')
    for row in p['wheels']:
        if importlib.metadata.version(row['name'])!=row['version']:raise ValueError('Private runtime version mismatch')
    mx.set_memory_limit(p['gpuMemoryLimitBytes']);mx.set_cache_limit(256*1024**2)
    memory_checks=0
    def check_memory(stage):
        nonlocal memory_checks
        current()
        peak=mx.get_peak_memory();memory_checks+=1
        if not isinstance(peak,int) or peak<0 or peak>p['gpuMemoryLimitBytes']:raise MemoryError(f'Observed Metal peak exceeds admission threshold at {stage}: {peak}')
    config=json.loads((root/'models/config.json').read_text())
    if config['tts_model_type']!='custom_voice' or config['tts_model_size']!='0b6' or config['quantization']!={'group_size':64,'bits':8,'mode':'affine'}:raise ValueError('Wrong selected model')
    model=Model(ModelConfig.from_dict(config))
    weights=mx.load(str(root/'models/model.safetensors'))
    index=json.loads((root/'models/model.safetensors.index.json').read_text())['weight_map']
    if set(weights)!=set(index) or set(index.values())!={'model.safetensors'}:raise ValueError('Exact weight index mismatch')
    weights=model.sanitize(weights);apply_quantization(model,config,weights,getattr(model,'model_quant_predicate',None))
    model.load_weights(list(weights.items()),strict=True);mx.eval(model.parameters());model.eval();del weights
    check_memory('main-loaded')
    if model.speaker_encoder is not None or not set(p['voices']).issubset(set(model.supported_speakers)):raise ValueError('Expected native presets only')
    model.tokenizer=AutoTokenizer.from_pretrained(str(root/'models'),local_files_only=True,trust_remote_code=False)
    tc=json.loads((root/'models/speech_tokenizer/config.json').read_text())
    selected={k:tc[k] for k in ['decoder_config','input_sample_rate','output_sample_rate','decode_upsample_rate','encode_downsample_rate','encoder_valid_num_quantizers'] if k in tc}
    selected['encoder_config']=None
    tokenizer=Qwen3TTSSpeechTokenizer(Qwen3TTSTokenizerConfig(**selected))
    raw_weights=mx.load(str(root/'models/speech_tokenizer/model.safetensors'))
    if any(not k.startswith(('encoder.','decoder.')) for k in raw_weights):raise ValueError('Unknown codec component')
    decoder_weights={k:a for k,a in raw_weights.items() if k.startswith('decoder.')}
    if not decoder_weights:raise ValueError('Decoder weights absent')
    decoder_weights=Qwen3TTSSpeechTokenizer.sanitize(decoder_weights)
    tokenizer.load_weights(list(decoder_weights.items()),strict=True);mx.eval(tokenizer.parameters());tokenizer.eval()
    if tokenizer.encoder_model is not None or tokenizer.output_sample_rate!=p['sampleRate']:raise ValueError('Reference encoder must remain absent')
    model.load_speech_tokenizer(tokenizer);model.load_generate_config(json.loads((root/'models/generation_config.json').read_text()))
    del raw_weights,decoder_weights
    check_memory('codec-loaded')
    model._fixture_resource_guard=check_memory;tokenizer.decoder._fixture_resource_guard=check_memory
    unexpected=[x for x in sys.modules if x in {'sounddevice','miniaudio','librosa','scipy'} or x.startswith(('mlx_audio.codec.models.descript','mlx_audio.codec.models.encodec'))]
    if unexpected:raise ValueError('Unneeded audio/model stack loaded: '+str(unexpected))

    def synthesize(text, speaker, max_tokens):
        ids=model.tokenizer.encode(text,add_special_tokens=False)
        if model.tokenizer.decode(ids)!=text: raise ValueError('Complete confirmed reading token roundtrip failed')
        current(); mx.random.seed(0); check_memory('before-segment')
        outputs=list(model.generate_custom_voice(text=text,speaker=speaker,language='chinese',instruct=None,
                     max_tokens=max_tokens,temperature=.8,top_k=50,top_p=1.,repetition_penalty=1.05,verbose=False,stream=False))
        if len(outputs)!=1 or not model._fixture_eos_seen: raise ValueError('Native reading incomplete; no retry')
        generated=outputs[0];mx.eval(generated.audio);check_memory('generated-segment')
        audio=np.array(generated.audio,dtype=np.float32)
        if generated.sample_rate!=24000 or audio.ndim!=1 or generated.samples!=len(audio) or not np.isfinite(audio).all() or not 1<=generated.token_count<max_tokens or len(audio)!=generated.token_count*1920: raise ValueError('Native complete codec clock failed')
        return audio, {'codecTokens':generated.token_count,'eosObserved':True}
    def evidence(speaker, asset_hash):
        check_memory('final')
        return {'kind':'qwen3-tts-native-v1','speaker':speaker,'assetProfileSha256':asset_hash,
                'memoryGuidelineBytes':p['gpuMemoryLimitBytes'],'peakMetalBytes':mx.get_peak_memory(),'memoryChecks':memory_checks}
    return synthesize,evidence

if __name__ == '__main__':
    # Explicit operator operation: verify/admit the existing bytes for the new
    # product purpose without rewriting the historical evaluation owner file.
    if len(sys.argv)!=5 or sys.argv[1]!='--admit-assets' or sys.argv[3]!='--shared-runtime': raise SystemExit('Only --admit-assets ROOT --shared-runtime ROOT is supported')
    base=Path(__file__).resolve().parent;root=Path(sys.argv[2]).resolve();shared=Path(sys.argv[4]).resolve()
    if Path(sys.prefix).resolve()!=shared/'venv': raise ValueError('Expected existing shared Python')
    descriptor=(base/'qwen-native-eval-profile.json').read_bytes();p=json.loads(descriptor)
    # Claims use the same exclusive candidate slot as native evaluations. This
    # command performs no neural call and will not displace a live/unknown claim.
    fd=os.open(root/'.eval.lock',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    claim=json.dumps({'kind':'product-asset-admission','pid':os.getpid(),'nativeAssetProfileSha256':sha(descriptor)}).encode()
    try:
        os.write(fd,claim);os.fsync(fd);os.close(fd)
        if (shared/'.eval.lock').exists(): raise ValueError('Shared inference slot is occupied')
        verify_assets(base,root,shared,p,sha(descriptor))
        import time
        value={'schema':'storyforge.ttrpg-qwen-product-assets','version':1,'nativeAssetProfileSha256':sha(descriptor),
               'productProfileIds':['qwen-mlx-uncle_fu-product-v1','qwen-mlx-serena-product-v1'],
               'status':'verified-assets-only','modelCalls':0,'adoptionAllowed':False,'humanRightsAcceptance':'unproven','atNs':time.time_ns()}
        target=root/'product-asset-admission-v1.json'
        if target.exists():
            existing=json.loads(target.read_text())
            if any(existing.get(k)!=v for k,v in value.items() if k!='atNs'): raise ValueError('Conflicting prior product asset admission; preserve it')
        else:
            with target.open('x') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
        print(json.dumps(value))
    finally:
        if (root/'.eval.lock').read_bytes()==claim:(root/'.eval.lock').unlink()
