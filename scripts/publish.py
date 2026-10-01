"""Publish this explicitly scoped public project using existing GitHub Git credentials.

Credentials stay in memory and are sent only to GitHub. Never printed or committed.
Run after reviewing the repository and release package.
"""
import json, os, subprocess, urllib.request, urllib.error
from pathlib import Path
root = Path(__file__).resolve().parents[1]
env = {**os.environ, 'GIT_TERMINAL_PROMPT':'0', 'GCM_INTERACTIVE':'never',
       'GIT_CONFIG_COUNT':'1', 'GIT_CONFIG_KEY_0':'safe.directory', 'GIT_CONFIG_VALUE_0':root.as_posix()}
result = subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,env=env,timeout=30)
credential = dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
token = credential.get('password')
if not token: raise SystemExit('GitHub publishing requires an existing Git login. No credential was available.')
headers = {'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'CourseKeep-Publisher'}
def api(path, body=None, method=None):
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request('https://api.github.com'+path,data=payload,headers={**headers,'Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(request,timeout=30) as response: return json.load(response)
profile = api('/user')
owner = profile['login']
name = 'coursekeep-extension'
try:
    repo = api(f'/repos/{owner}/{name}')
    if repo.get('private'): raise SystemExit('The existing repository is private; stopped without changing visibility.')
except urllib.error.HTTPError as error:
    if error.code != 404: raise
    repo = api('/user/repos', {'name':name,'private':False,'description':'CourseKeep Chrome extension preview: official-page playback detection and local MP4 processing.','auto_init':False})
print('Public repository: '+repo['html_url'])
def git(*args):
    subprocess.run(['git',*args],cwd=root,env=env,check=True,timeout=120)
if not (root/'.git').exists(): git('init','-b','main')
remote = subprocess.run(['git','remote','get-url','origin'],cwd=root,env=env,text=True,capture_output=True)
if remote.returncode:
    git('remote','add','origin',repo['clone_url'])
elif remote.stdout.strip() != repo['clone_url']:
    raise SystemExit('Existing remote differs; stopped without changing it.')
git('add','extension','tests','scripts','README.md','LICENSE','package.json','.gitignore','.gitattributes','.github')
git('diff','--cached','--check','--','.',':(exclude)extension/vendor/**')
staged = subprocess.run(['git','diff','--cached','--quiet'],cwd=root,env=env)
if staged.returncode: git('commit','-m','Build CourseKeep Chrome extension preview')
git('push','-u','origin','main')
try:
    release = api(f'/repos/{owner}/{name}/releases/tags/v0.1.0')
except urllib.error.HTTPError as error:
    if error.code != 404: raise
    release = api(f'/repos/{owner}/{name}/releases', {'tag_name':'v0.1.0','name':'CourseKeep 0.1.0 preview','prerelease':True,'body':'Chrome extension preview. Download the ZIP, extract it, and load its folder in chrome://extensions with Developer mode enabled. No cURL, Python or FFmpeg installation needed. Login/playback detection and full-course saving still require validation in a real Chrome session. Only download content you are authorized to save. See README and bundled privacy statement.'})
asset = root/'dist/coursekeep-extension-0.1.0.zip'
if not any(item['name']==asset.name for item in release['assets']):
    upload = release['upload_url'].split('{')[0]+'?name='+asset.name
    request = urllib.request.Request(upload,data=asset.read_bytes(),headers={**headers,'Content-Type':'application/zip'},method='POST')
    with urllib.request.urlopen(request,timeout=120) as response:
        print('Download: '+json.load(response)['browser_download_url'])
print('Release: '+release['html_url'])
