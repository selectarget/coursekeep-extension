export function topicURL(raw) {
  const url = new URL(String(raw).trim());
  if (url.origin !== 'https://wx.zsxq.com' || url.username || url.password || !/^\/(?:group\/\d+\/)?topic\/\d+\/?$/.test(url.pathname)) throw new Error('请输入知识星球帖子网址，每行一个。');
  return url.origin + url.pathname;
}

export function resourceURL(raw, host, suffix = '') {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || (suffix && !url.pathname.endsWith(suffix))) throw new Error('不支持的资源地址。');
  return url.href;
}

export function parsePlaylist(text, base) {
  resourceURL(base, 'videos.zsxq.com', '.m3u8');
  if (!text.startsWith('#EXTM3U') || !text.includes('#EXT-X-ENDLIST')) throw new Error('目前仅支持完整的点播视频，请先播放课程。');
  if (/#EXT-X-(STREAM-INF|DISCONTINUITY|BYTERANGE|MAP|SESSION-KEY|PART|GAP)/.test(text)) throw new Error('此播放格式暂不支持。');
  let keyURL = null, explicitIV = null, sequence = 0n, duration = 0, keyCount = 0;
  const segments = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-KEY:')) {
      if (++keyCount > 1) throw new Error('暂不支持轮换播放密钥。');
      const attrs = Object.fromEntries([...line.slice(11).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
      if (attrs.METHOD === 'NONE') continue;
      if (attrs.METHOD !== 'AES-128' || (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity') || segments.length) throw new Error('此加密方式暂不支持。');
      keyURL = resourceURL(new URL(attrs.URI, base).href, 'auth.zsxq.com');
      if (new URL(keyURL).pathname !== '/ali_mts_key') throw new Error('播放密钥地址不受支持。');
      if (attrs.IV) {
        if (!/^0x[0-9a-f]{1,32}$/i.test(attrs.IV)) throw new Error('无效的播放初始化向量。');
        explicitIV = attrs.IV.slice(2).padStart(32, '0');
      }
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      if (!/^\d+$/.test(line.slice(22))) throw new Error('无效的分片序号。');
      sequence = BigInt(line.slice(22));
    } else if (line.startsWith('#EXTINF:')) {
      const length = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(length) || length <= 0) throw new Error('无效的视频时长。');
      duration += length;
    } else if (line && !line.startsWith('#')) {
      const iv = explicitIV || (sequence + BigInt(segments.length)).toString(16).padStart(32, '0');
      if (iv.length !== 32) throw new Error('分片序号过大。');
      segments.push({url: resourceURL(new URL(line, base).href, 'videos.zsxq.com', '.ts'), iv});
    } else if (line.includes('URI=')) throw new Error('此播放格式暂不支持。');
  }
  if (!segments.length || segments.length > 1000 || !duration || duration > 10800) throw new Error('视频长度超出当前支持范围。');
  return {keyURL, segments, duration};
}

export async function readLimited(response, limit, signal) {
  if (!response.ok) throw new Error(`资源读取失败（${response.status}），请在原页面重新播放后再试。`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('资源超过处理大小限制。');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const {value, done} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error('资源超过处理大小限制。');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}
