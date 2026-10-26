#!/usr/bin/env node
/**
 * Lager PNG- og ICO-ikonene fra SVG-ene og skriver dem til src/ikoner.js (base64),
 * som Workeren serverer (repoet oppdateres via GitHub-API-et, som bare tar tekst).
 *
 *   node tools/lag-ikoner.mjs           (krever Playwright: npm i playwright)
 *
 * Kilder: public/favicon.svg (HT14) og public/badehusappen/ikoner/ikon.svg / ikon-maskable.svg.
 * apple-touch-icon lages uten runde hjørner (iOS runder dem selv).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = f => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const square = s => s.replace('<rect width="64" height="64" rx="14"', '<rect width="64" height="64"')
  .replace('<clipPath id="bh-clip"><rect width="64" height="64" rx="14"/></clipPath>', '<clipPath id="bh-clip"><rect width="64" height="64"/></clipPath>');
const ht14 = svg("favicon.svg"), app = svg("badehusappen/ikoner/ikon.svg"), appMask = svg("badehusappen/ikoner/ikon-maskable.svg");

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
async function png(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
/** ICO med PNG-bilder inni (støttes av alle nettlesere). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, data], i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, o); head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(data.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map(x => x[1])]);
}
const icoOf = async s => ico(await Promise.all([16, 32, 48].map(async n => [n, await png(s, n)])));

const out = {
  "/favicon.ico": ["image/x-icon", await icoOf(ht14)],
  "/apple-touch-icon.png": ["image/png", await png(square(ht14), 180)],
  "/badehusappen/favicon.ico": ["image/x-icon", await icoOf(app)],
  "/badehusappen/ikoner/apple-touch-icon.png": ["image/png", await png(square(app), 180)],
  "/badehusappen/ikoner/ikon-192.png": ["image/png", await png(app, 192)],
  "/badehusappen/ikoner/ikon-512.png": ["image/png", await png(app, 512)],
  "/badehusappen/ikoner/ikon-maskable-192.png": ["image/png", await png(appMask, 192)],
  "/badehusappen/ikoner/ikon-maskable-512.png": ["image/png", await png(appMask, 512)]
};
await browser.close();
if (process.env.PNG_DIR) for (const [p, [, b]] of Object.entries(out)) writeFileSync(process.env.PNG_DIR + "/" + p.slice(1).replace(/\//g, "_"), b);
writeFileSync(new URL("../src/ikoner.js", import.meta.url), `/**
 * Ikoner som binærfiler (PNG/ICO), lagret som base64 og servert av Workeren (src/index.js).
 * LAGES AUTOMATISK av tools/lag-ikoner.mjs fra SVG-ene – ikke rediger for hånd.
 * Hvorfor her og ikke i public/? Repoet oppdateres via GitHub-API-et, som bare tar tekst.
 */
export const ICONS = {
${Object.entries(out).map(([p, [type, b]]) => `  ${JSON.stringify(p)}: { type: "${type}", b64: "${b.toString("base64")}" },`).join("\n")}
};
`);
console.log("src/ikoner.js:", Object.keys(out).length, "ikoner");
