"""Pinned Qwen CustomVoice public-fixture evaluation; no cloning/application input."""
from pathlib import Path
import hashlib, importlib.metadata, json, os, resource, signal, sys, time, wave

def sha(b): return hashlib.sha256(b).hexdigest()

def main():
    started=time.monotonic();base=Path(__file__).resolve().parent
    profile_bytes=(base/'qwen-native-eval-profile.json').read_bytes();p=json.loads(profile_bytes)
    raw=sys.stdin.buffer.read(8193)
    if len(raw)>8192:raise ValueError('Oversized evaluation identity')
    v=json.loads(raw)
    if set(v)!={'meloRuntime','nativeRuntime','outputDir','profileSha256','workerSha256'}:raise ValueError('Only fixed evaluation paths allowed')
    if sha(profile_bytes)!=v['profileSha256'] or sha(Path(__file__).read_bytes())!=v['workerSha256']:raise ValueError('Source changed')
    registry=json.loads((base.parent.parent/'src/lib/agent/ai-entry-registry.json').read_text())
    rows=[x for x in registry['limitedTransports'] if x['entryId']==p['entryId']]
    if len(rows)!=1 or rows[0]['boundary']!='offline-fixture-audio-eval' or rows[0]['adoptAllowed'] is not False or rows[0]['allowedCallers']!=['scripts/ttrpg-local-tts/native-voice-evaluate.mjs']:raise ValueError('Unregistered evaluation')
    if p['version']!=3 or p['decodeUpsampleRate']!=1920 or p['decoderChunkTokens']!=100 or p['decoderLeftContextTokens']!=25 or p['gpuMemoryLimitBytes']!=6*1024**3 or p['maxCalls']!=2 or p['voices']!=['uncle_fu','serena'] or p['productInvocationAllowed'] is not False or p['adoptionAllowed'] is not False or p['network']!='disabled' or p['instructAllowed'] is not False or p['referenceVoiceAllowed'] is not False or p['stream'] is not False:raise ValueError('Unsupported fixed boundary')
    melo,root,output=(Path(v[k]).resolve() for k in ['meloRuntime','nativeRuntime','outputDir'])
    if output.parent!=root/'evaluations' or {x.name for x in output.iterdir()}!={'attempt.json','worker.log'}:raise ValueError('Output must be a new attempt')
    if Path(sys.prefix).resolve()!=melo/'venv' or sha((melo/'runtime-profile.json').read_bytes())!=p['sharedPythonAssetProfileSha256']:raise ValueError('Shared runtime mismatch')
    for row in json.loads((melo/'runtime-profile.json').read_text())['pythonPackages']:
        if importlib.metadata.version(row['name'])!=row['version']:raise ValueError('Shared environment drift')
    def verify():
        if sha((base/'qwen-native-eval-profile.json').read_bytes())!=v['profileSha256'] or sha(Path(__file__).read_bytes())!=v['workerSha256']:raise ValueError('Evaluation source drift')
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
        for asset,lock in [(melo,'.setup.lock'),(root,'.prepare.lock')]:
            if (asset/lock).exists() or json.loads((asset/'setup-receipt.json').read_text())['status']!='passed':raise ValueError('Asset setup incomplete')
    verify()
    def offline(event,args):
        if event in {'socket.connect','socket.getaddrinfo','subprocess.Popen','os.system','os.posix_spawn','os.fork','os.forkpty'}:raise RuntimeError('Offline evaluation; no nested processes')
    sys.addaudithook(offline)
    def timeout(signum,frame):raise TimeoutError('Fixed Qwen evaluation deadline')
    signal.signal(signal.SIGALRM,timeout);signal.alarm(p['timeoutMs']//1000-2)
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
    memory_checks=0;stage_peaks={}
    def check_memory(stage):
        nonlocal memory_checks
        peak=mx.get_peak_memory();memory_checks+=1;stage_peaks[stage]=max(stage_peaks.get(stage,0),peak)
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
    ids=model.tokenizer.encode(p['fixture'],add_special_tokens=False)
    if model.tokenizer.decode(ids)!=p['fixture']:raise ValueError('Text tokenization changed public text')
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
    result={'status':'running','entryId':p['entryId'],'profileSha256':v['profileSha256'],'workerSha256':v['workerSha256'],
            'engine':'Qwen3-TTS-0.6B-CustomVoice-8bit-MLX','text':p['fixture'],'textTokens':len(ids),'network':'disabled','adoptionAllowed':False,
            'calls':0,'voices':[],'instruct':None,'referencePersonAudio':False,'referenceEncoderLoaded':False,
            'humanListeningAcceptance':'unproven','modelSpeed':'native; no post-generation tempo or pitch change',
            'neuralInferenceDevice':'Metal GPU','sharedTorchImportedByTokenizer':'torch' in sys.modules}
    def save():(output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    save()
    with (output/'calls.jsonl').open('x') as calls:
        for voice in p['voices']:
            if result['calls']>=p['maxCalls']:raise ValueError('Speech generation budget exhausted')
            result['calls']+=1;save()
            calls.write(json.dumps({'event':'requested','voice':voice,'atNs':time.time_ns(),'maxCodecTokens':p['maxCodecTokensPerVoice']})+'\n');calls.flush();os.fsync(calls.fileno())
            before=time.monotonic();mx.random.seed(0)
            check_memory('before-voice')
            outputs=list(model.generate_custom_voice(text=p['fixture'],speaker=voice,language='chinese',instruct=None,
                         max_tokens=p['maxCodecTokensPerVoice'],temperature=.8,top_k=50,top_p=1.,repetition_penalty=1.05,verbose=False,stream=False))
            if len(outputs)!=1 or not model._fixture_eos_seen:raise ValueError('Incomplete or unexpected generated segments')
            generated=outputs[0];mx.eval(generated.audio);audio=np.array(generated.audio,dtype=np.float32)
            check_memory('generated-voice')
            if len(audio)!=generated.token_count*p['decodeUpsampleRate']:raise ValueError('Complete codec clock mismatch; valid zero code must not shorten audio')
            if generated.sample_rate!=p['sampleRate'] or audio.ndim!=1 or generated.samples!=len(audio) or not np.isfinite(audio).all() or not 5<=len(audio)/p['sampleRate']<=p['maxSecondsPerVoice'] or not 1<=generated.token_count<p['maxCodecTokensPerVoice']:raise ValueError('Invalid native generated PCM or codec usage')
            peak=float(np.abs(audio).max());gain=min(1.,.99/peak) if peak else 0.
            pcm=np.rint(audio*gain*32767).astype('<i2');rms=float(np.sqrt(np.mean((pcm.astype(np.float64)/32767)**2)))
            if rms<.00001:raise ValueError('Silent generated speech')
            target=output/(voice+'.wav')
            with wave.open(str(target)+'.part','wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(p['sampleRate']);w.writeframes(pcm.tobytes())
            Path(str(target)+'.part').rename(target)
            row={'voice':voice,'audioSha256':sha(target.read_bytes()),'sampleRate':p['sampleRate'],'samples':len(pcm),'durationSeconds':len(pcm)/p['sampleRate'],
                 'codecTokens':generated.token_count,'eosObserved':True,'gain':gain,'rms':rms,'wallSeconds':time.monotonic()-before}
            calls.write(json.dumps({'event':'returned',**row})+'\n');calls.flush();os.fsync(calls.fileno());result['voices'].append(row);save();mx.clear_cache()
    verify();usage=resource.getrusage(resource.RUSAGE_SELF);check_memory('final')
    result.update(status='generated',wallSeconds=time.monotonic()-started,cpuSeconds=usage.ru_utime+usage.ru_stime,maxRssBytes=usage.ru_maxrss,peakMetalBytes=mx.get_peak_memory(),
                  resourceAcceptance='passed',memoryGuidelineBytes=p['gpuMemoryLimitBytes'],memoryChecks=memory_checks,memoryStagePeaks=stage_peaks)
    save();signal.alarm(0)

if __name__=='__main__':main()
