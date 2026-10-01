import {resourceURL, topicURL, parsePlaylist, readLimited} from './hls.js';
let mutations = Promise.resolve();
const TTL = 30 * 60 * 1000;
function mutate(fn) {
  mutations = mutations.catch(() => {}).then(async () => {
    const data = await chrome.storage.session.get('captures');
    const captures = (data.captures || []).filter(item => Date.now() - item.time < TTL);
    await chrome.storage.session.set({captures: await fn(captures)});
  });
  return mutations;
}
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const tabs = await chrome.tabs.query({url});
  if (tabs[0]) await chrome.tabs.update(tabs[0].id, {active: true});
  else await chrome.tabs.create({url});
});
chrome.webRequest.onCompleted.addListener(details => {
  if (details.tabId < 0 || details.statusCode !== 200 || details.initiator !== 'https://wx.zsxq.com') return;
  let playlist;
  try { playlist = resourceURL(details.url, 'videos.zsxq.com', '.m3u8'); } catch { return; }
  mutate(async captures => {
    let tab; try { tab = await chrome.tabs.get(details.tabId); } catch { return captures; }
    let pageURL; try { pageURL = topicURL(tab.url); } catch { return captures; }
    const id = `${details.tabId}:${new URL(playlist).pathname}`;
    const record = {id, tabId: details.tabId, pageURL, playlist, title: (tab.title || '知识星球课程').slice(0, 120), time: Date.now()};
    await chrome.action.setBadgeText({tabId: details.tabId, text: '✓'});
    await chrome.action.setBadgeBackgroundColor({tabId: details.tabId, color: '#237957'});
    return [record, ...captures.filter(item => item.id !== id)].slice(0, 30);
  }).catch(() => {});
}, {urls: ['https://videos.zsxq.com/*.m3u8*']});
chrome.tabs.onRemoved.addListener(tabId => { mutate(items => items.filter(item => item.tabId !== tabId)).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (!changes.url) return;
  mutate(items => items.filter(item => item.tabId !== tabId || item.pageURL === changes.url)).catch(() => {});
  chrome.action.setBadgeText({tabId, text: ''}).catch(() => {});
});

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('app.html')) throw new Error('不支持的请求来源。');
  if (message.type === 'list') { await mutate(items => items); return (await chrome.storage.session.get('captures')).captures || []; }
  if (message.type === 'clear') { await mutate(() => []); return true; }
  if (message.type !== 'key') throw new Error('不支持的操作。');
  await mutations;
  const captures = (await chrome.storage.session.get('captures')).captures || [];
  const capture = captures.find(item => item.id === message.id && Date.now() - item.time < TTL);
  if (!capture) throw new Error('视频链接已过期，请在原页面重新播放。');
  const tab = await chrome.tabs.get(capture.tabId);
  if (topicURL(tab.url) !== capture.pageURL) throw new Error('请保持原课程页面开启。');
  // Derive the key URL from the captured playlist, never from an arbitrary page message.
  const response = await fetch(resourceURL(capture.playlist, 'videos.zsxq.com', '.m3u8'), {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000)});
  const meta = parsePlaylist(new TextDecoder().decode(await readLimited(response, 2_000_000)), capture.playlist);
  if (!meta.keyURL) return {key: null};
  if (meta.keyURL !== message.keyURL) throw new Error('播放链接已更新，请重新识别。');
  const results = await chrome.scripting.executeScript({
    target: {tabId: capture.tabId}, world: 'MAIN',
    func: async keyURL => {
      try {
        const url = new URL(keyURL);
        if (location.origin !== 'https://wx.zsxq.com' || url.origin !== 'https://auth.zsxq.com' || url.pathname !== '/ali_mts_key') return {error: '页面或资源地址不受支持。'};
        const response = await fetch(url.href, {credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15000)});
        if (!response.ok) return {error: '播放认证失败，请重新登录知识星球。'};
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytes.length === 16 ? {key: Array.from(bytes)} : {error: '无法获取播放认证，请在官方页面重新登录并播放课程。'};
      } catch { return {error: '页面无法完成播放认证，请重新播放课程。'}; }
    }, args: [meta.keyURL]
  });
  const result = results[0]?.result;
  if (result?.error) throw new Error(result.error);
  if (!Array.isArray(result?.key) || result.key.length !== 16 || result.key.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('播放认证响应无效。');
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ok: true, data}), error => respond({ok: false, error: error.message || '操作失败。'}));
  return true;
});
