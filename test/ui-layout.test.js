const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const fitSource = fs.readFileSync(require.resolve('../assets/v2/preview-fit.js'), 'utf8');
function fitEnvironment() {
  const frames=[],values=new Map(),classes=new Set();
  const style={setProperty:(key,value)=>values.set(key,value)};
  const canvas={style:{},className:'v2-preview-canvas'};
  let device;
  const stage={clientWidth:800,clientHeight:900,style,dataset:{},classList:{remove(){}},closest:()=>null,querySelector:selector=>selector==='.phone,.gmail'?device:canvas};
  const context={window:{addEventListener(){}},document:{readyState:'complete',body:{classList:{contains:name=>classes.has(name)}},querySelector:selector=>selector==='#stage'?stage:{value:context.mode,addEventListener(){}},addEventListener(){}},getComputedStyle:()=>({paddingLeft:'20',paddingRight:'20',paddingTop:'20',paddingBottom:'20'}),ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},requestAnimationFrame:callback=>frames.push(callback),mode:'auto'};
  const replace=()=>{device={offsetWidth:350,offsetHeight:710,classList:{contains:()=>false},style:{setProperty(){throw new Error('Device inline transform must not compete with inherited fit')}}};};
  replace();vm.runInNewContext(fitSource,context);
  return {context,stage,canvas,values,classes,replace,flush(){frames.splice(0).forEach(callback=>callback())}};
}

test('fit updates the persistent stage scale after replacement and landscape resize',()=>{
  const env=fitEnvironment();env.flush();assert.equal(env.values.get('--v2-device-scale'),'1');
  env.stage.clientHeight=223;env.replace();env.context.window.TwoWayV2.refreshPreviewFit();env.flush();
  const scale=183/710;assert.equal(Number(env.values.get('--v2-device-scale')),scale);assert.equal(env.canvas.style.height,'183px');assert.equal(env.stage.dataset.previewScale,String(scale));
});

test('focus enlarges within bounds while every manual zoom remains exact',()=>{
  const env=fitEnvironment();env.classes.add('v2-focus-mode');env.flush();
  assert.ok(Number(env.values.get('--v2-device-scale'))>1);assert.ok(parseFloat(env.canvas.style.height)<=860);
  for(const [mode,expected] of [['1',1],['.85',.85],['.7',.7]]){env.context.mode=mode;env.context.window.TwoWayV2.refreshPreviewFit();env.flush();assert.equal(Number(env.values.get('--v2-device-scale')),expected)}
  env.classes.clear();env.context.mode='auto';env.context.window.TwoWayV2.refreshPreviewFit();env.flush();assert.equal(Number(env.values.get('--v2-device-scale')),1);
});

test('crop dialog wraps both Tab boundaries, skips hidden/disabled controls and leaves interior Tab native',()=>{
  const html=fs.readFileSync(require.resolve('../interactive-simulator-builder.html'),'utf8');
  const source=html.slice(html.indexOf('    function trapRcsCropTab('),html.indexOf('    function openRcsImageCropper('));
  const document={activeElement:null};let prevented=0;
  const node=(extra={})=>({disabled:false,tabIndex:0,getClientRects:()=>[{}],focus(){document.activeElement=this},...extra});
  const first=node(),middle=node(),last=node(),disabled=node({disabled:true}),hidden=node({getClientRects:()=>[]});
  const modal={querySelectorAll:()=>[hidden,first,middle,disabled,last]},context={document};vm.runInNewContext(source,context);
  const press=(active,shiftKey=false,key='Tab')=>{document.activeElement=active;context.trapRcsCropTab({key,shiftKey,preventDefault(){prevented++}},modal)};
  press(last);assert.equal(document.activeElement,first);assert.equal(prevented,1);
  press(first,true);assert.equal(document.activeElement,last);assert.equal(prevented,2);
  press(middle);assert.equal(document.activeElement,middle);assert.equal(prevented,2);
  press(first,false,'Escape');assert.equal(prevented,2);
});
