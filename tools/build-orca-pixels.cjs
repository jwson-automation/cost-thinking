// Rebuild the source-guided native grids without resampling them.
// Run after installing the existing frontend dependencies: node tools/build-orca-pixels.cjs
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('../frontend/node_modules/sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'frontend/public/assets/orca');

async function main() {
  const { size, palette, scenes } = JSON.parse(
    await fs.readFile(path.join(root, 'docs/orca-pixels/native-frames.json'), 'utf8'),
  );
  assert.equal(size, 32);
  const colors = Object.fromEntries(Object.entries(palette).map(([key, hex]) => [
    key, [...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), 255],
  ]));
  colors['.'] = [0, 0, 0, 0];
  const metrics = {};
  const preview = {};
  for (const [name, frames] of Object.entries(scenes)) {
    assert.equal(frames.length, 4);
    assert.equal(new Set(frames.map((grid) => grid.join(''))).size, 4, 'All poses must differ');
    const layers = [];
    preview[name] = [];
    metrics[name] = [];
    for (const [index, grid] of frames.entries()) {
      assert.equal(grid.length, size);
      const pixels = [];
      let left = size, top = size, right = -1, bottom = -1, boundary = 0, ink = 0;
      grid.forEach((row, y) => {
        assert.equal(row.length, size);
        [...row].forEach((key, x) => {
          assert.ok(colors[key], `Unknown palette color ${key}`);
          pixels.push(...colors[key]);
          if (key === '.') return;
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
          if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !grid[y+dy]?.[x+dx] || grid[y+dy][x+dx] === '.')) {
            boundary++;
            if (key === 'K') ink++;
          }
        });
      });
      assert.ok(left > 0 && top > 0 && right < 31 && bottom < 31, 'Keep transparent margins');
      const png = await sharp(Buffer.from(pixels), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
      await fs.writeFile(path.join(output, `${name}-0${index + 1}.png`), png);
      preview[name].push('data:image/png;base64,' + png.toString('base64'));
      layers.push({ input: png, left: index * size, top: 0 });
      metrics[name].push({ frame: index + 1, bounds: [left, top, right, bottom], outline: Number((ink / boundary).toFixed(3)) });
    }
    await sharp({ create: { width: size * 4, height: size, channels: 4, background: '#00000000' } })
      .composite(layers).png().toFile(path.join(output, `${name}-sheet.png`));
  }
  await fs.writeFile(path.join(root, 'docs/orca-pixels/metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'docs/orca-pixels/review.html'), `<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>오르카 · 32×32 픽셀 리뷰</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#192438;font:15px/1.6 system-ui,sans-serif}main{max-width:840px;margin:auto;padding:32px 20px}h1{font-size:28px;letter-spacing:-1px}p{color:#617089}.controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:24px 0}button,select,a{font:inherit}button,select{padding:8px 14px;border:1px solid #ccd5e2;border-radius:8px;background:white}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px}article{background:white;border-radius:20px;padding:24px}h2{font-size:19px;margin:0 0 20px}.stage{display:grid;place-items:center;border-radius:12px;background:#eef2f8;height:272px}.dark .stage{background:#172237}.grid canvas{background-image:linear-gradient(#8590a433 1px,transparent 1px),linear-gradient(90deg,#8590a433 1px,transparent 1px);background-size:8px 8px}canvas{image-rendering:pixelated;max-width:100%;height:auto}.native{display:flex;align-items:center;gap:16px;margin:20px 0}img{image-rendering:pixelated}a{color:#1768df}footer{margin-top:24px;color:#617089}
</style><main><h1>작은 오르카의 두 가지 일</h1><p>각 프레임은 투명 배경의 실제 32×32 PNG입니다. 확대 보기는 정확히 8배입니다.</p>
<div class="controls"><button id="play">일시정지</button><label>프레임 <select id="frame"><option value="0">1</option><option value="1">2</option><option value="2">3</option><option value="3">4</option></select></label><label><input id="grid" type="checkbox">격자</label><label><input id="dark" type="checkbox">어두운 배경</label></div>
<section>${Object.keys(preview).map((name, i) => `<article data-scene="${name}"><h2>${i ? '편지를 배달하는 오르카' : '카드를 만드는 오르카'}</h2><div class="stage"><canvas width="256" height="256" aria-label="${i ? '우편배달부' : '카드 제작'} 확대 프레임"></canvas></div><div class="native"><img width="32" height="32" alt="원본 크기 프레임"><span>원본 32×32</span></div><a download="${name}-01.png">현재 프레임 PNG 저장</a></article>`).join('')}</section>
<footer>생성 원화를 바탕으로 32×32에서 윤곽·눈·연필·편지를 정리한 4프레임. 팔레트 12색, 알파 0/255.</footer></main>
<script>
const assets=${JSON.stringify(preview)};let frame=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;const images={};
const play=document.querySelector('#play'),select=document.querySelector('#frame');
function render(){select.value=frame;play.textContent=playing?'일시정지':'재생';document.querySelectorAll('article').forEach(article=>{const name=article.dataset.scene,img=images[name]?.[frame];if(!img?.complete)return;const ctx=article.querySelector('canvas').getContext('2d');ctx.clearRect(0,0,256,256);ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,256,256);article.querySelector('img').src=assets[name][frame];const a=article.querySelector('a');a.href=assets[name][frame];a.download=name+'-0'+(frame+1)+'.png';});}
Promise.all(Object.entries(assets).map(async([name,frames])=>{images[name]=await Promise.all(frames.map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.src=src;})));})).then(render);
play.onclick=()=>{playing=!playing;render();};select.onchange=()=>{playing=false;frame=Number(select.value);render();};document.querySelector('#grid').onchange=e=>document.body.classList.toggle('grid',e.target.checked);document.querySelector('#dark').onchange=e=>document.body.classList.toggle('dark',e.target.checked);setInterval(()=>{if(playing){frame=(frame+1)%4;render();}},350);
</script></html>`);
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
