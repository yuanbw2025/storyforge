"""Source-preserving pronunciation preview. No model imports or audio output.

Execute only the four checksum-pinned MeloTTS MIT normalization definitions;
never import its module (which initializes tokenizer/model dependencies).
Upstream notices remain in the installed vendor/LICENSE, shared with evaluation.
"""
import ast
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def utf16_length(text):
    return len(text.encode('utf-16-le')) // 2


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def apply_readings(text, overrides, profile):
    if not isinstance(text, str) or not text.strip() or utf16_length(text) > profile['maxSourceUtf16']:
        raise ValueError('Original source is empty or over its UTF-16 budget')
    if not isinstance(overrides, list) or len(overrides) > profile['maxOverrides']:
        raise ValueError('Invalid pronunciation choices')
    # Positions are the product's original UTF-16 offsets, never Python indices.
    offsets = {0: 0}
    length = 0
    for index, char in enumerate(text):
        length += utf16_length(char)
        offsets[length] = index + 1
    cursor = 0
    pieces = []
    for row in overrides:
        if not exact(row, ['textOffset', 'textLength', 'spokenText']):
            raise ValueError('Unexpected pronunciation fields')
        start, size, reading = row['textOffset'], row['textLength'], row['spokenText']
        if (type(start) is not int or type(size) is not int or size < 1 or start < cursor
            or start not in offsets or start + size not in offsets or not isinstance(reading, str)
            or not reading.strip() or utf16_length(reading) > profile['maxReadingUtf16']):
            raise ValueError('Pronunciation choices must be ordered original ranges without split characters')
        pieces.extend([text[offsets[cursor]:offsets[start]], reading])
        cursor = start + size
    pieces.append(text[offsets[cursor]:])
    result = ''.join(pieces)
    if utf16_length(result) > profile['maxReadingUtf16']:
        raise ValueError('Expanded reading exceeds its separate budget')
    return result


def inspect_reading(text):
    issues = []
    # Everything outside this finite Chinese frontend must be chosen explicitly;
    # upstream otherwise deletes glyphs or calls the excluded English frontend.
    allowed = re.compile(r'[\u4e00-\u9fa50-9。！？；：，、（）《》“”‘’…,.!?\-\' \r\n\t·【】\[\]—～~「」]')
    for match in re.finditer(r'[^\u4e00-\u9fa50-9。！？；：，、（）《》“”‘’…,.!?\-\' \r\n\t·【】\[\]—～~「」]+', text):
        code = 'unsupported-script' if re.search(r'[a-zA-Z]', match.group()) else 'unsupported-character'
        issues.append({'code': code, 'textOffset': utf16_length(text[:match.start()]),
                       'textLength': utf16_length(match.group())})
    assert all(allowed.fullmatch(char) for char in text) or issues
    # These patterns have ambiguous/destructive upstream readings. Do not guess
    # whether a numeral is an identifier, sign, date, clock, range or dice rule.
    for pattern in [r'(?<![0-9])0[0-9]+', r'[+\-—～~][0-9零〇一二三四五六七八九十百千万亿两]+', r'[0-9]+[:/\-][0-9]+',
                    r'[0-9]+(?:\.[0-9]+)?[%‰°℃]', r'[0-9]{17,}', r'(?<![0-9])\.[0-9]+',
                    r'[0-9]+(?:\.[0-9]+){2,}', r'[0-9]+[,，][0-9]{3}(?:[,，][0-9]{3})*',
                    r'[0-9]{3,4}年', r'(?:编号|号码|邮编|电话|房间号|代号|序号)[^0-9]{0,4}[0-9]+']:
        for match in re.finditer(pattern, text):
            issue = {'code': 'ambiguous-number', 'textOffset': utf16_length(text[:match.start()]),
                     'textLength': utf16_length(match.group())}
            if issue not in issues:
                issues.append(issue)
    return sorted(issues, key=lambda row: (row['textOffset'], row['code'], row['textLength']))


def preview(text, overrides, normalize, profile):
    reading = apply_readings(text, overrides, profile)
    issues = inspect_reading(reading)
    normalized = None
    # A blocked preview preserves problematic input without invoking cn2an on
    # unbounded numbers or displaying dropped characters as a valid reading.
    if not issues:
        normalized = normalize(reading)
        if not normalized.strip() or utf16_length(normalized) > profile['maxReadingUtf16']:
            raise ValueError('Normalized reading exceeds its separate budget or is empty')
    return {'status': 'needs-reading-choice' if issues else 'ready-for-reading-review',
            'sourceText': text, 'sourceTextSha256': digest(text.encode()), 'overrides': overrides,
            'readingText': reading, 'normalizedText': normalized,
            'normalizedTextSha256': digest(normalized.encode()) if normalized is not None else None,
            'issues': issues[:profile['maxReportedIssues']], 'issueCount': len(issues), 'issueOffsetsReferTo': 'readingText-utf16',
            'modelCalled': False, 'generationAllowed': False, 'adoptionAllowed': False}


def load_normalizer(root, profile):
    expected = profile['assetProfileSha256']
    raw_profile = root / 'runtime-profile.json'
    owner = json.loads((root / 'owner.json').read_text())
    setup = json.loads((root / 'setup-receipt.json').read_text())
    if (digest(raw_profile.read_bytes()) != expected or owner['profileHash'] != expected
        or owner['profileId'] != profile['assetProfileId'] or setup['profileHash'] != expected
        or setup['status'] != 'passed' or (root / '.setup.lock').exists()):
        raise ValueError('Pinned shared installation is not ready')
    source = (root / 'vendor' / profile['normalizerPath']).read_bytes()
    if digest(source) != profile['normalizerSha256']:
        raise ValueError('Original normalization source changed')
    if importlib.metadata.version('cn2an') != profile['cn2anVersion']:
        raise ValueError('Pinned number frontend changed')
    import cn2an
    tree = ast.parse(source)
    names = {'punctuation', 'rep_map', 'replace_punctuation', 'text_normalize'}
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in names:
            nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in names:
            nodes.append(node)
    if len(nodes) != 4:
        raise ValueError('Pinned normalization definitions missing')
    namespace = {'re': re, 'cn2an': cn2an}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<pinned-melo-reading>', 'exec'), namespace)
    return namespace['text_normalize']


def main():
    # Explicit operator path; author payloads cannot supply paths, prompts,
    # project identities, output directories or generation switches.
    if len(sys.argv) != 3 or sys.argv[1] != '--runtime-dir':
        raise ValueError('Expected one operator-selected runtime directory')
    base = Path(__file__).resolve().parent
    profile = json.loads((base / 'reading-profile.json').read_text())
    if profile['modelInvocationAllowed'] is not False or profile['adoptionAllowed'] is not False:
        raise ValueError('Reading profile cannot invoke models or adopt')
    raw = sys.stdin.buffer.read(profile['maxPayloadBytes'] + 1)
    if len(raw) > profile['maxPayloadBytes']:
        raise ValueError('Reading preview payload exceeds its bound')
    payload = json.loads(raw)
    if not exact(payload, ['schema', 'version', 'text', 'overrides']) or payload['schema'] != 'storyforge.ttrpg-local-tts-reading-input' or type(payload['version']) is not int or payload['version'] != 1:
        raise ValueError('Expected exact reading-only payload')
    def offline(event, args):
        if event in {'socket.connect', 'socket.getaddrinfo'}:
            raise RuntimeError('Network disabled during reading preview')
    sys.addaudithook(offline)
    normalize = load_normalizer(Path(sys.argv[2]).resolve(), profile)
    result = preview(payload['text'], payload['overrides'], normalize, profile)
    result.update(schema='storyforge.ttrpg-local-tts-reading-preview', version=1,
                  profileHash=digest(json.dumps(profile, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()),
                  normalizerSha256=profile['normalizerSha256'], network='disabled')
    # These imports would breach the no-model preflight boundary even if no
    # inference were reported. Assert the real process, not a caller flag.
    if any(name.split('.')[0] in {'torch', 'transformers', 'melo'} for name in sys.modules):
        raise RuntimeError('Reading preview loaded a model dependency')
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ttrpg-reading-preview: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
