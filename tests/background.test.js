import test from 'node:test';
import assert from 'node:assert/strict';
const listeners={},store={};
globalThis.chrome={
 runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:fn=>listeners.message=fn}},
 storage:{session:{get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,value)}},
 action:{onClicked:{addListener:()=>{}},setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
 tabs:{onRemoved:{addListener:fn=>listeners.remove=fn},onUpdated:{addListener:fn=>listeners.update=fn},get:async id=>({id,url:'https://wx.zsxq.com/topic/123',title:'Test course'})},
 webRequest:{onCompleted:{addListener:fn=>listeners.capture=fn}},scripting:{executeScript:async()=>{throw Error('Must not run');}}
};
await import('../extension/background.js');
const sender={id:'fixture',url:'chrome-extension://fixture/app.html'};
const send=(body,who=sender)=>new Promise(resolve=>listeners.message(body,who,resolve));
test('captures only successful playlist requests initiated by the official page',async()=>{
  listeners.capture({tabId:1,statusCode:200,initiator:'https://evil.test',url:'https://videos.zsxq.com/a.m3u8'});
  assert.deepEqual((await send({type:'list'})).data,[]);
  listeners.capture({tabId:1,statusCode:403,initiator:'https://wx.zsxq.com',url:'https://videos.zsxq.com/a.m3u8'});
  assert.deepEqual((await send({type:'list'})).data,[]);
  listeners.capture({tabId:1,statusCode:200,initiator:'https://wx.zsxq.com',url:'https://videos.zsxq.com/a.m3u8'});
  const result=await send({type:'list'});assert.equal(result.data.length,1);assert.equal(result.data[0].pageURL,'https://wx.zsxq.com/topic/123');
});
test('arbitrary senders and arbitrary key requests are denied',async()=>{
  assert.equal((await send({type:'list'},{id:'fixture',url:'https://wx.zsxq.com/topic/123'})).ok,false);
  assert.equal((await send({type:'key',id:'missing',keyURL:'https://evil.test/key'})).ok,false);
});
test('navigation and closed pages clear the captured links',async()=>{
  listeners.update(1,{url:'https://wx.zsxq.com/topic/999'});assert.equal((await send({type:'list'})).data.length,0);
  listeners.capture({tabId:1,statusCode:200,initiator:'https://wx.zsxq.com',url:'https://videos.zsxq.com/a.m3u8'});
  await send({type:'list'});listeners.remove(1);assert.equal((await send({type:'list'})).data.length,0);
});
test('expired links are pruned and manual clear removes current links',async()=>{
  store.captures=[{id:'expired',time:Date.now()-31*60*1000}];assert.equal((await send({type:'list'})).data.length,0);
  assert.equal((await send({type:'clear'})).ok,true);
});
