import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyMP4} from '../extension/media.js';
test('real FFmpeg WASM output is accepted despite legacy ffprobe return code',async()=>{
 globalThis.self={location:{href:new URL('../extension/vendor/core/ffmpeg-core.js',import.meta.url).href}};
 const createCore=(await import('../extension/vendor/core/ffmpeg-core.js')).default;
 const core=await createCore({wasmBinary:await readFile(new URL('../extension/vendor/core/ffmpeg-core.wasm',import.meta.url))});
 assert.equal(core.exec('-f','lavfi','-i','color=black:s=16x16:r=1:d=1','-c:v','libx264','output.mp4'),0);
 core.reset();
 const checked=await verifyMP4({ffprobe:async args=>core.ffprobe(...args),readFile:async name=>core.FS.readFile(name)},1);
 assert.equal(checked.duration,1);assert.equal(checked.audio,false);
});
test('a truncated MP4 still fails duration validation',async()=>{
 const mocked={ffprobe:async()=>-1,readFile:async()=>new TextEncoder().encode(JSON.stringify({format:{duration:'10'},streams:[{codec_type:'video'}]}))};
 await assert.rejects(verifyMP4(mocked,600),/视频时长不完整/);
});
