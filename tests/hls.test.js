import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylist,topicURL,resourceURL,readLimited} from '../extension/hls.js';
const base='https://videos.zsxq.com/course.m3u8?token=sample';
const plain='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:22\n#EXTINF:10,\ncourse-00022.ts\n#EXTINF:5,\ncourse-00023.ts\n#EXT-X-ENDLIST\n';
test('resolves media paths and sequence IVs accurately',()=>{
  const meta=parsePlaylist(plain,base); assert.equal(meta.duration,15); assert.equal(meta.keyURL,null);
  assert.equal(meta.segments[0].iv,'00000000000000000000000000000016'); assert.equal(meta.segments[1].iv,'00000000000000000000000000000017');
  assert.equal(meta.segments[0].url,'https://videos.zsxq.com/course-00022.ts');
});
test('AES attributes may be in any order and include explicit IV',()=>{
  const meta=parsePlaylist(plain.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:IV=0x1,URI="https://auth.zsxq.com/ali_mts_key?sample=1",METHOD=AES-128'),base);
  assert.equal(meta.keyURL,'https://auth.zsxq.com/ali_mts_key?sample=1');assert.equal(meta.segments[1].iv,'00000000000000000000000000000001');
});
test('rejects untrusted or credential-bearing URLs',()=>{
  for(const value of ['https://evil.test/x.ts','https://videos.zsxq.com.evil.test/x.ts','http://videos.zsxq.com/x.ts','https://u:p@videos.zsxq.com/x.ts','https://videos.zsxq.com:444/x.ts']) assert.throws(()=>resourceURL(value,'videos.zsxq.com'));
  assert.throws(()=>parsePlaylist(plain.replace('course-00022.ts','https://evil.test/x.ts'),base));
  assert.throws(()=>parsePlaylist(plain.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.test/key"'),base));
});
test('rejects live, DRM, rotating keys and unsupported segment types',()=>{
  const invalid=[plain.replace('#EXT-X-ENDLIST',''),plain.replace('#EXTM3U','#EXTM3U\n#EXT-X-DISCONTINUITY'),plain.replace('#EXTM3U','#EXTM3U\n#EXT-X-MAP:URI="init.mp4"'),plain.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="https://auth.zsxq.com/ali_mts_key"'),plain.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXT-X-KEY:METHOD=NONE'),plain.replace('10,','NaN,'),plain.replace('course-00022.ts','part.m4s')];
  for(const text of invalid)assert.throws(()=>parsePlaylist(text,base));
});
test('topic parsing accepts official paths only',()=>{
  assert.equal(topicURL('https://wx.zsxq.com/group/123/topic/456?x=1'),'https://wx.zsxq.com/group/123/topic/456');
  for(const value of ['https://evil.test/topic/1','https://u@wx.zsxq.com/topic/1','https://wx.zsxq.com/','https://wx.zsxq.com/topic/x'])assert.throws(()=>topicURL(value));
});
test('streaming reads enforce limits without content length',async()=>{
  await assert.rejects(readLimited(new Response(new Uint8Array(11)),10),/大小限制/);
  const data=await readLimited(new Response(new Uint8Array([1,2,3])),10);assert.deepEqual([...data],[1,2,3]);
  await assert.rejects(readLimited(new Response('',{status:403}),10),/403/);
});
test('aborted reads cannot return usable media',async()=>{
  const control=new AbortController();control.abort();
  await assert.rejects(readLimited(new Response(new Uint8Array([1])),10,control.signal),{name:'AbortError'});
});
