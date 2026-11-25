/* =========================================================
   Render opener jadi urutan PNG, frame demi frame.

   Bukan rekaman layar: skrip ini MENYETEL waktu timeline, menunggu
   browser selesai menggambar, baru menangkap. Jadi tidak ada frame
   yang drop walau satu frame butuh 300 ms untuk dirender.

   Prasyarat:
     npm i puppeteer
     python -m http.server 5178      (di folder proyek, jendela lain)

   Pakai:
     node tools/export-frames.mjs
     ffmpeg -framerate 60 -i frames/f%05d.png -c:v libx264 -pix_fmt yuv420p -crf 16 opener.mp4
   ========================================================= */

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

const URL   = process.env.URL   || 'http://127.0.0.1:5178/index.html?clean=1';
const FPS   = Number(process.env.FPS   || 60);
const OUT   = process.env.OUT   || 'frames';
const SCALE = Number(process.env.SCALE || 1);   // 1 = ukuran stage (1920x1080 / 1080x1920), 0.5 = separuh

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--enable-gpu', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: SCALE });
await page.goto(URL, { waitUntil: 'networkidle0' });

// tunggu sampai modul selesai dimuat dan timeline terpasang
await page.waitForFunction('window.OPENER && window.OPENER.ready && (!window.OPENER.clipsReady || window.OPENER.clipsReady())', { timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { window.OPENER.tl.pause(0); });

// ukuran stage dari halaman (16:9 1920x1080, 9:16 1080x1920, 1:1 ...), bukan dikunci 16:9
const { W, H } = await page.evaluate(() => ({ W: window.OPENER.W || 1920, H: window.OPENER.H || 1080 }));
await page.setViewport({ width: W, height: H, deviceScaleFactor: SCALE });
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

const DURATION = await page.evaluate(() => window.OPENER.DURATION);
const total = Math.ceil(DURATION * FPS);
console.log(`${total} frame @ ${FPS} fps (${DURATION}s, ${W}x${H}) -> ${OUT}/`);

for(let i = 0; i < total; i++){
  const t = i / FPS;

  // setel waktu, lalu biarkan DUA rAF lewat: satu untuk GSAP menulis gaya,
  // satu lagi untuk loop render menggambar frame dengan nilai baru itu.
  await page.evaluate(async (time) => {
    if (window.OPENER.seekFrame) await window.OPENER.seekFrame(time);   // ada klip video: tunggu frame-nya siap
    else (window.OPENER.seek||window.OPENER.tl.time.bind(window.OPENER.tl))(time);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);

  await page.screenshot({
    path: `${OUT}/f${String(i).padStart(5, '0')}.png`,
    clip: { x: 0, y: 0, width: W, height: H },
    optimizeForSpeed: true,
  });

  if(i % FPS === 0) process.stdout.write(`\r${i}/${total}  ${t.toFixed(1)}s`);
}

console.log(`\nselesai — ${total} frame di ${OUT}/`);
await browser.close();
