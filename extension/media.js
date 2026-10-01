export async function verifyMP4(ffmpeg,expected){
 const code=await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_type','-of','json','-o','probe.json','output.mp4']);
 // ffmpeg-core 0.12.10 may return -1 after successful ffprobe output.
 // The parsed output, video track and duration are the authoritative checks.
 if(code!==0&&code!==-1)throw new Error('MP4 校验失败，请重试。');
 let probe;try{probe=JSON.parse(new TextDecoder().decode(await ffmpeg.readFile('probe.json')));}catch{throw new Error('MP4 校验失败，请重试。');}
 const actual=Number(probe.format?.duration);
 if(!probe.streams?.some(s=>s.codec_type==='video')||!actual||Math.abs(actual-expected)>Math.max(5,expected*.01))throw new Error('视频时长不完整，请重试。');
 return {duration:actual,audio:probe.streams.some(s=>s.codec_type==='audio')};
}
