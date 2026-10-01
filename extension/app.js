import {FFmpeg} from './vendor/ffmpeg/index.js';
import {verifyMP4} from './media.js';
import {topicURL, parsePlaylist, resourceURL, readLimited} from './hls.js';
const $ = id => document.getElementById(id);
const jobs = [], blobs = new Map();
let captures = [], running = false, waitingForSave = false, current = null, worker = null;
const labels = {queued:'等待下载', loading:'读取视频', downloading:'正在下载', merging:'合并 MP4', verifying:'校验视频', complete:'处理完成', failed:'下载失败', cancelled:'已取消'};
const active = new Set(['queued','loading','downloading','merging','verifying']);
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
async function message(body) {
  const result = await chrome.runtime.sendMessage(body);
  if (!result?.ok) throw new Error(result?.error || '扩展后台暂时不可用，请重新打开。');
  return result.data;
}
function button(text, handler, disabled = false, kind = '') {
  const element = document.createElement('button'); element.textContent = text; element.disabled = disabled; element.className = kind;
  element.addEventListener('click', () => Promise.resolve().then(handler).catch(error => notice(error.message, true)));
  return element;
}
function row(title, detail) {
  const element = document.createElement('article'); element.className = 'row';
  const content = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = title;
  const small = document.createElement('small'); small.textContent = detail; content.append(strong, small);
  const buttons = document.createElement('div'); buttons.className = 'buttons'; element.append(content, buttons);
  return {element, content, buttons};
}
function render() {
  $('captures').replaceChildren();
  if (!captures.length) { const p = document.createElement('p'); p.className='muted'; p.textContent='尚未识别视频。安装扩展后，在官方课程页面刷新并播放视频。'; $('captures').append(p); }
  for (const capture of captures) {
    const view = row(capture.title, `播放于 ${new Date(capture.time).toLocaleTimeString()} · 链接有效期约 30 分钟`);
    view.buttons.append(button('查看课程 ↗', () => chrome.tabs.update(capture.tabId, {active:true})), button('加入下载', () => enqueue(capture), !$('consent').checked || jobs.some(job => job.capture.id === capture.id && active.has(job.status)), 'download'));
    $('captures').append(view.element);
  }
  $('jobs').replaceChildren();
  if (!jobs.length) { const p = document.createElement('p'); p.className='muted'; p.textContent='下载完成后点击“保存 MP4”。'; $('jobs').append(p); }
  for (const job of jobs.slice().reverse()) {
    const view = row(job.title, `${labels[job.status]}${job.bytes ? ' · '+(job.bytes/1e6).toFixed(1)+' MB' : ''}${job.duration ? ' · '+Math.round(job.duration/60)+' 分钟' : ''}`);
    if (active.has(job.status)) {
      const progress = document.createElement('progress'); progress.max=100; progress.value=job.progress; progress.setAttribute('aria-label','下载进度'); view.content.append(progress);
      view.buttons.append(button('取消', () => cancel(job)));
    } else if (job.status === 'complete' && blobs.has(job.id)) {
      const save = document.createElement('a'); save.className='primary'; save.textContent='保存 MP4 ↓'; save.href=blobs.get(job.id); save.download=job.filename; view.buttons.append(save);
    } else if (job.status === 'failed' || job.status === 'cancelled') {
      view.buttons.append(button('重新识别', refresh));
    }
    if (job.error) { const error=document.createElement('p'); error.className='error'; error.textContent=job.error; view.content.append(error); }
    $('jobs').append(view.element);
  }
  if (waitingForSave && jobs.some(job=>job.status==='queued')) {
    $('jobs').append(button('已保存，继续队列 →',()=>{ waitingForSave=false; runQueue(); }));
  }
}
function update(job, changes) { Object.assign(job, changes); render(); }
async function refresh() { captures = await message({type:'list'}); render(); }
function enqueue(capture) {
  if (!$('consent').checked) throw new Error('请先确认你有权下载此内容。');
  if (jobs.some(job => job.capture.id === capture.id && active.has(job.status))) return;
  jobs.push({id:crypto.randomUUID(), capture:{...capture}, title:capture.title, status:'queued', progress:0, bytes:0});
  notice('任务已加入队列。下载时请保持原课程页面和此下载页开启。'); render(); runQueue();
}
function cancel(job) {
  if (current?.job === job) { current.abort.abort(); worker?.terminate(); }
  else update(job,{status:'cancelled'});
}
async function fetchResource(url, limit, signal) {
  resourceURL(url, 'videos.zsxq.com');
  return readLimited(await fetch(url, {credentials:'omit', redirect:'error', signal:AbortSignal.any([signal, AbortSignal.timeout(45000)])}), limit, signal);
}
async function download(job) {
  const abort = new AbortController(); const signal = abort.signal; current = {job, abort}; let ffmpeg;
  try {
    update(job,{status:'loading',progress:2});
    const text = new TextDecoder().decode(await fetchResource(job.capture.playlist, 2_000_000, signal));
    const meta = parsePlaylist(text, job.capture.playlist);
    const authorization = await message({type:'key',id:job.capture.id,keyURL:meta.keyURL});
    signal.throwIfAborted();
    const key = meta.keyURL ? await crypto.subtle.importKey('raw',new Uint8Array(authorization.key),{name:'AES-CBC'},false,['decrypt']) : null;
    authorization.key = null;
    ffmpeg = new FFmpeg(); worker = ffmpeg;
    await ffmpeg.load({coreURL:chrome.runtime.getURL('vendor/core/ffmpeg-core.js'),wasmURL:chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm'),classWorkerURL:chrome.runtime.getURL('vendor/ffmpeg/worker.js')},{signal});
    update(job,{status:'downloading',progress:5,duration:meta.duration});
    const files = meta.segments.map((_, i) => `s${String(i).padStart(5,'0')}.ts`);
    let next=0, done=0, total=0;
    async function downloader() {
      while (next < meta.segments.length) {
        const index=next++; signal.throwIfAborted();
        const part=meta.segments[index]; let data;
        for (let attempt=0; attempt<3; attempt++) {
          try { data=await fetchResource(part.url,50_000_000,signal); break; }
          catch(error) { if (signal.aborted || attempt===2) throw error; }
        }
        const iv=Uint8Array.from(part.iv.match(/.{2}/g),value=>parseInt(value,16));
        const clear=key ? new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv},key,data)) : data;
        signal.throwIfAborted(); total+=clear.length;
        if (total>600_000_000) throw new Error('视频超过 600 MB 浏览器处理限制。');
        await ffmpeg.writeFile(files[index],clear,{signal}); done++;
        update(job,{progress:5+Math.round(done/meta.segments.length*80),bytes:total});
      }
    }
    await Promise.all([downloader(),downloader(),downloader()]); signal.throwIfAborted();
    update(job,{status:'merging',progress:88});
    const code=await ffmpeg.exec(['-hide_banner','-loglevel','error','-fflags','+genpts','-i','concat:'+files.join('|'),'-c','copy','-movflags','+faststart','output.mp4'],120000,{signal});
    if (code!==0) throw new Error('视频合并失败，此格式可能不受支持。');
    for (const file of files) await ffmpeg.deleteFile(file);
    update(job,{status:'verifying',progress:98}); const checked=await verifyMP4(ffmpeg,meta.duration);
    const output=await ffmpeg.readFile('output.mp4'); signal.throwIfAborted();
    // Only keep the latest result to avoid accumulating large videos in memory.
    for (const [id,url] of blobs) { URL.revokeObjectURL(url); blobs.delete(id); }
    blobs.set(job.id,URL.createObjectURL(new Blob([output],{type:'video/mp4'})));
    const topic=job.capture.pageURL.match(/topic\/(\d+)/)[1];
    const filename=job.title.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,65)+'-'+topic+'.mp4';
    waitingForSave=true;
    update(job,{status:'complete',progress:100,bytes:output.length,duration:checked.duration,filename});
    notice('视频已处理完成，请点击“保存 MP4”。保存后点击“继续队列”处理下一条。');
  } catch(error) {
    const cancelled=signal.aborted; abort.abort();
    update(job,{status:cancelled?'cancelled':'failed',error:cancelled?'':error.message || '下载失败，请重新播放后识别。'});
  } finally { ffmpeg?.terminate(); worker=null; current=null; }
}
async function runQueue() {
  if (running || waitingForSave) return; running=true;
  try {
    let job;
    while ((job=jobs.find(item=>item.status==='queued'))) {
      await download(job);
      // Pause after success so the next job cannot revoke an unsaved result.
      if (job.status==='complete') break;
    }
  } finally {
    running=false;
    render();
  }
}
$('consent').addEventListener('change',render);
$('refresh').addEventListener('click',()=>refresh().catch(error=>notice(error.message,true)));
$('clear').addEventListener('click',async()=>{try{await message({type:'clear'});await refresh();notice('识别记录已清除。');}catch(error){notice(error.message,true);}});
$('open').addEventListener('click',async()=>{
  try {
    const raw=$('urls').value.trim().split(/\s+/).filter(Boolean);
    if (!raw.length || raw.length>10) throw new Error('请填写 1 到 10 个帖子网址。');
    const urls=[...new Set(raw.map(topicURL))];
    for (const url of urls) await chrome.tabs.create({url,active:false});
    $('urls').value='';notice(`已打开 ${urls.length} 个课程页面。请逐个登录并播放视频，然后刷新识别列表。`);
  }catch(error){notice(error.message,true);}
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.captures)refresh().catch(()=>{});});
window.addEventListener('beforeunload',event=>{if(running||blobs.size){event.preventDefault();event.returnValue='';}});
refresh().catch(error=>notice(error.message,true));
