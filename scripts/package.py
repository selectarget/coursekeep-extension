"""Package only audited extension files, never workspace private media or credentials."""
from pathlib import Path
import json, zipfile
root = Path(__file__).resolve().parents[1]
extension = root / 'extension'
version = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))['version']
names = {'manifest.json','background.js','hls.js','app.html','app.js','style.css','media.js','privacy.html'}
files = [extension / name for name in sorted(names)]
files += sorted((extension / 'icons').glob('*.png'))
files += sorted((extension / 'vendor').rglob('*.js'))
files += sorted((extension / 'vendor').rglob('*.wasm'))
files += sorted((extension / 'vendor').rglob('LICENSE'))
files += [extension / 'vendor/THIRD-PARTY.txt']
target = root / f'dist/coursekeep-extension-{version}.zip'
target.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        if not path.is_file() or path.is_symlink(): raise RuntimeError(f'Invalid package file: {path.name}')
        archive.write(path, path.relative_to(extension))
    archive.write(root / 'LICENSE', 'LICENSE')
    archive.write(root / 'README.md', 'README.md')
print(f'{target} ({target.stat().st_size:,} bytes; {len(files)+2} files)')
