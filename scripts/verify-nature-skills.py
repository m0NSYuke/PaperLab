"""Verify the pinned project-local Nature Skills bundle without running it."""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def verify(root: Path) -> dict:
    manifest = json.loads((root / 'docs/nature-skills-installation.json').read_text(encoding='utf-8'))
    destination = root / manifest['destination']
    assert destination.resolve() == (root / '.agents/skills').resolve(), 'Unexpected installation root'
    expected = {item['path']: item for item in manifest['files']}
    errors = []
    for relative, item in expected.items():
        path = destination / relative
        if not path.resolve().is_relative_to(destination.resolve()) or path.is_symlink():
            errors.append('Unsafe installed path: ' + relative)
            continue
        if not path.is_file():
            errors.append('Missing file: ' + relative)
            continue
        data = path.read_bytes()
        if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            errors.append('Changed bytes: ' + relative)
        if hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != item['git_blob_sha1']:
            errors.append('Upstream Git blob mismatch: ' + relative)
    names = []
    catalog = (root / 'docs/NATURE_SKILLS.md').read_text(encoding='utf-8')
    for skill in manifest['skills']:
        folder = destination / skill['directory']
        text = (folder / 'SKILL.md').read_text(encoding='utf-8') if (folder / 'SKILL.md').is_file() else ''
        header = text.split('---', 2)[1] if text.startswith('---') else ''
        match = re.search(r'(?m)^name:\s*([a-z0-9-]+)\s*$', header)
        name = match.group(1) if match else None
        if name != skill['name']: errors.append('Incorrect skill trigger: ' + skill['directory'])
        names.append(name)
        if '../.agents/skills/' + skill['directory'] + '/SKILL.md' not in catalog:
            errors.append('Skill missing from task catalog: ' + skill['directory'])
        if not (folder / 'agents/openai.yaml').is_file():
            errors.append('Missing agent metadata: ' + skill['directory'])
    if len(set(names)) != len(names): errors.append('Duplicate trigger names')
    support = (destination / 'nature-shared/agents/openai.yaml').read_text(encoding='utf-8')
    if 'allow_implicit_invocation: false' not in support:
        errors.append('Shared support must not be an independent automatic workflow')
    for adapter in ('paper', 'rap'):
        if not (destination / adapter / 'SKILL.md').is_file(): errors.append('Existing adapter missing: ' + adapter)
    paper = (destination / 'paper/SKILL.md').read_text(encoding='utf-8')
    if '../nature-paper-xray/SKILL.md' not in paper: errors.append('Paper reading adapter is missing')
    agents = (root / 'AGENTS.md').read_text(encoding='utf-8')
    if '## Research skill routing' not in agents or 'docs/NATURE_SKILLS.md' not in agents:
        errors.append('Automatic project routing is missing')
    if not (root / 'docs/third-party/nature-skills/LICENSE').is_file(): errors.append('Upstream license missing')
    return {
        'checked_at': datetime.now(timezone.utc).isoformat(), 'status': 'failed' if errors else 'passed',
        'repository': manifest['repository'], 'commit': manifest['commit'],
        'skill_directories': len(manifest['skills']), 'task_skills': manifest['task_skill_count'],
        'support_packages': manifest['support_package_count'], 'upstream_files': len(expected),
        'upstream_bytes': sum(item['size'] for item in expected.values()),
        'checks': ['SHA-256 and upstream Git blob hashes', 'trigger names and catalog coverage',
                   'shared support metadata', 'paper/rap preservation and reading adapter',
                   'project task routing and license presence'],
        'not_tested': ['new-session automatic selection', 'optional service authentication',
                       'all upstream scripts end to end', 'paid API or image generation'],
        'errors': errors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, help='Optional project-local JSON result file')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    result = verify(root)
    if args.report:
        report = (root / args.report).resolve()
        if not report.is_relative_to(root): parser.error('Report must stay inside the project')
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
