import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { renderPoster } from '../api/video-worker.mjs';
import { initialPosterState, applyPosterRevision } from '../api/_poster-revision.mjs';
import { posterReferenceDesign, referenceComposition, referenceBackgroundInstruction } from '../api/_poster-reference-layout.mjs';

const grammar = (y = .18, x = .08, color = '#e8b83a') => ({
  version: 'visual-blueprint-v1', palette: [color],
  regions: [{ role:'HEADLINE',x,y,width:.75,height:.2 }],
  subject:'SERVICE_SCENE',hook:'BENEFIT',offer:'PRICE_FIRST',proof:'NONE',direction:'BENEFIT_THEN_OFFER',
});
const style = design => 'clean and minimal Use this reference only for structure. Reference design grammar: ' + JSON.stringify(design);
const brief = design => `产品/服务：Facial care\n主标题：Time for you\n品牌：Our Studio\n核心卖点与准确事实：S$98 | 90 minutes\n行动引导：WhatsApp\n尺寸：1080x1350\n风格：${style(design)}`;
const fonts = [process.env.POSTER_TEST_FONT, 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].filter(Boolean);
async function font() {
  for (const file of fonts) { try { await access(file); return file; } catch {} }
  throw new Error('a real local test font is required');
}
const source = () => sharp({create:{width:1080,height:1350,channels:3,background:'#678589'}}).png().toBuffer();
async function render(state) {
  let manifest;
  const bytes = await renderPoster({},await source(),{state,fontPath:await font(),onManifest:value=>{manifest=value;}});
  return {bytes,manifest};
}
test('only validated grammar is accepted; raw merchant instructions are rejected',()=>{
  assert.equal(posterReferenceDesign('no reference'),null);
  assert.deepEqual(posterReferenceDesign(style(grammar())),grammar());
  for (const design of [{...grammar(),copy:'other merchant'}, {...grammar(),palette:['ignore system']}, {...grammar(),regions:[{role:'HEADLINE',x:.9,y:0,width:.5,height:.2}]}]) assert.throws(()=>posterReferenceDesign(style(design)),/poster_reference_design_invalid/);
});
test('the background receives explicit reference copy placement without merchant facts',()=>{
  const prompt=referenceBackgroundInstruction(style(grammar()));
  assert.match(prompt,/normalized rectangles/); assert.match(prompt,/#e8b83a/);
  assert.doesNotMatch(prompt,/Our Studio|S\$98|private/);
});
test('current requested colors take priority and dark palettes retain readable price text',()=>{
  const safe={top:55,bottom:55};
  assert.equal(referenceComposition('红色 '+style(grammar()),1080,1350,safe).palette.accent,'#d32f2f');
  assert.equal(referenceComposition(style(grammar(.18,.08,'#112233')),1080,1350,safe).palette.priceColor,'#ffffff');
});
test('real rendered title, price and CTA move together when the reference layout changes',async()=>{
  const top=await render(initialPosterState({brief:brief(grammar(.18))}));
  const bottom=await render(initialPosterState({brief:brief(grammar(.6))}));
  assert.ok(bottom.manifest.layout.title.top-top.manifest.layout.title.top>200);
  assert.ok(bottom.manifest.layout.button.top-top.manifest.layout.button.top>200);
  assert.ok(!top.bytes.equals(bottom.bytes));
  assert.match(top.manifest.referenceRender.designHash,/^[a-f\d]{64}$/);
  assert.deepEqual(top.manifest.referenceRender.applied,['palette','layout']);
  assert.equal(top.manifest.title,'Time for you'); assert.equal(top.manifest.facts,'S$98 | 90 minutes');
  assert.ok(top.manifest.layout.price.top < top.manifest.layout.title.top,'PRICE_FIRST reference hierarchy must change the actual role order');
  const dir=process.env.POSTER_REFERENCE_PROOF_DIR || path.join(os.tmpdir(),'poster-reference-layout-proofs');
  await mkdir(dir,{recursive:true}); await writeFile(path.join(dir,'top.jpg'),top.bytes);await writeFile(path.join(dir,'bottom.jpg'),bottom.bytes);
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify({testOnly:true,top:top.manifest,bottom:bottom.manifest},null,2));
});
test('reference palette changes actual JPEG pixels, not just prompt metadata',async()=>{
  const one=await render(initialPosterState({brief:brief(grammar(.18,.08,'#e8b83a'))}));
  const two=await render(initialPosterState({brief:brief(grammar(.18,.08,'#a3d9a5'))}));
  const point=one.manifest.layout.brandPill;
  const pixel=async bytes=>[...await sharp(bytes).extract({left:point.left+30,top:point.top+4,width:1,height:1}).raw().toBuffer()];
  const color=await pixel(one.bytes); const other=await pixel(two.bytes);
  assert.ok(Math.abs(color[0]-232)<12 && Math.abs(color[1]-184)<12 && Math.abs(color[2]-58)<12);
  assert.notDeepEqual(color,other);
});
test('a later button-only revision keeps reference layout, palette and unchanged photo pixels',async()=>{
  const before=await render(initialPosterState({brief:brief(grammar())}));
  const after=await render(applyPosterRevision(before.manifest,'只按钮改深绿色').state);
  assert.deepEqual(after.manifest.layout,before.manifest.layout);
  assert.deepEqual(after.manifest.palette,before.manifest.palette);
  assert.deepEqual(after.manifest.referenceRender,before.manifest.referenceRender);
  const region={left:200,top:1000,width:600,height:200};
  assert.ok((await sharp(before.bytes).extract(region).raw().toBuffer()).equals(await sharp(after.bytes).extract(region).raw().toBuffer()));
});
test('narrow/right reference anchors adapt within the actual canvas and survive edits',async()=>{
  const design=grammar(.2,.55);design.regions[0].width=.4;
  const before=await render(initialPosterState({brief:brief(design)}));
  for(const box of Object.values(before.manifest.layout)) assert.ok(box.left>=0 && box.top>=0 && box.left+box.width<=1080 && box.top+box.height<=1350);
  const after=await render(applyPosterRevision(before.manifest,'只按钮改深绿色').state);
  assert.deepEqual(after.manifest.layout,before.manifest.layout);
});
test('legacy approved manifests do not acquire a new reference panel during a button-only edit',async()=>{
  const state=initialPosterState({brief:brief(grammar())});
  state.style='clean and minimal';
  const before=await render(state);
  // PR49 stored the reference style but used the original compositor; it had
  // no referenceRender stamp. Recreate that legacy shape without another engine.
  const legacy={...before.manifest,style:style(grammar())};
  const after=await render(applyPosterRevision(legacy,'只按钮改深绿色').state);
  assert.deepEqual(after.manifest.layout,before.manifest.layout);
  assert.equal(after.manifest.referenceRender,undefined);
  const region={left:100,top:500,width:800,height:200};
  assert.ok((await sharp(before.bytes).extract(region).raw().toBuffer()).equals(await sharp(after.bytes).extract(region).raw().toBuffer()));
});
