import assert from 'node:assert/strict';

export const companyNames={example:'Online Trading Academy',stress:'Online Trading Academy — Financial Education and Trading Workshops'};

export async function checkThreadRow(page,expectedName,{requireTruncation=false}={}){
  const row=page.locator('[data-thread="sms-main"] .thread-top');
  await row.waitFor({state:'visible'});
  await page.evaluate(()=>document.fonts.ready);
  const measure=()=>row.evaluate(node=>{
    const sender=node.querySelector('strong'),time=node.querySelector('time'),copy=node.closest('.thread-copy');
    const bounds=element=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom}};
    const range=document.createRange();range.selectNodeContents(time);
    const lines=[...range.getClientRects()].filter(box=>box.width>0);
    const style=getComputedStyle(sender),timeStyle=getComputedStyle(time);
    return {sender:{text:sender.textContent,...bounds(sender),whiteSpace:style.whiteSpace,overflow:style.overflow,textOverflow:style.textOverflow,clientWidth:sender.clientWidth,scrollWidth:sender.scrollWidth},time:{text:time.textContent,...bounds(time),lineCount:lines.length,whiteSpace:timeStyle.whiteSpace,flexShrink:timeStyle.flexShrink},copy:bounds(copy)};
  });
  const value=await measure();
  assert.equal(value.sender.text,expectedName,'The full company name must remain in the row');
  assert.equal(value.time.text,'Now ›');
  assert.equal(value.time.whiteSpace,'nowrap','The timestamp must explicitly prevent wrapping across fonts and browsers');
  assert.equal(value.time.flexShrink,'0','The timestamp must reserve its intrinsic width');
  assert.equal(value.time.lineCount,1,'Now and its chevron must occupy one text line');
  assert.ok(value.sender.right<=value.time.left+1,'The company name must not overlap the timestamp');
  assert.ok(value.time.left>=value.copy.left-1&&value.time.right<=value.copy.right+1,'The timestamp must remain inside its row');
  assert.equal(value.sender.whiteSpace,'nowrap');
  assert.equal(value.sender.overflow,'hidden');
  assert.equal(value.sender.textOverflow,'ellipsis');
  if(requireTruncation)assert.ok(value.sender.scrollWidth>value.sender.clientWidth,'The stress name must actually exercise ellipsis truncation');
  return value;
}
