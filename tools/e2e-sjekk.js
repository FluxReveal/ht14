// Nettleser-sjekk av ht14.no lokalt (WebKit = Safari/iPhone, og Chromium).
// Start først:  npx wrangler dev     Kjør så:  node tools/e2e-sjekk.js [adresse] [mappe-for-skjermbilder]
// Krever Playwright (npm i playwright). Lagrer skjermbilder fra WebKit i iPhone-størrelse.
const { chromium, webkit } = require("playwright");
const B = process.argv[2] || "http://127.0.0.1:8787/";
const SH = process.argv[3] || "./skjermbilder/";
const CHROME = process.env.CHROME_PATH;   // valgfritt: egen Chrome
const PAGES = [["teknisk.html", "Teknisk dokumentasjon"], ["regler.html", "Regler for bruk av badehuset"], ["vedtekter.html", "Forslag til tillegg i vedtektene"], ["arshjul.html", "Årshjul"], ["hva-er-nytt.html", "Hva er nytt"]];
const REDIR = [["dokumentasjon/", /dokumentasjon\/teknisk(\.html)?$/], ["dokumentasjon/hld.html#sikkerhet", /teknisk(\.html)?#sikkerhet$/],
  ["dokumentasjon/adminmanual.html#steg-3-github-token-som-bare-nar-data-repoet", /teknisk(\.html)?#oppsett$/], ["dokumentasjon/beslutninger.html", /:\d+\/$/],
  ["index.html#hva-er-nytt", /hva-er-nytt(\.html)?$/]];
(async () => {
  let fails = 0;
  for (const [bn, bt] of [["webkit", webkit], ["chromium", chromium]]) {
    const b = await bt.launch(bn === "chromium" && CHROME ? { executablePath: CHROME } : {});
    const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: bn === "chromium" });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    const prob = []; p.on("pageerror", e => prob.push("JS: " + e.message));
    const shoot = async n => { if (bn === "webkit") await p.screenshot({ path: `${SH}ht14-${n}.png` }); };
    const ov = async l => { const r = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (r > 1) prob.push(`${l}: ${r}px sidelengs`); };
    try {
      // Startsiden
      await p.goto(B, { waitUntil: "networkidle" }); await ov("start"); await shoot("1-startside");
      const cards = await p.locator(".cards a b").allTextContents();
      for (const t of ["Badehusappen", ...PAGES.map(x => x[1])]) if (!cards.includes(t)) prob.push("start: mangler kort " + t);
      const hrefs = await p.locator("a[href]").evaluateAll(as => as.map(a => a.getAttribute("href")));
      if (hrefs.some(h => /HT14|fluxreveal\.com/.test(h))) prob.push("start: gammel adresse");
      // Dokumentasjonen
      for (const [f, t] of PAGES) {
        await p.goto(B + "dokumentasjon/" + f, { waitUntil: "networkidle" }); await ov(f);
        const h1 = (await p.locator("article h1").first().textContent()).trim(); if (h1 !== t) prob.push(`${f}: h1 «${h1}»`);
        const txt = await p.locator("article").innerText();
        if (/GitHub Pages|workers\.dev|Workers KV|fluxreveal\.com/.test(txt)) prob.push(f + ": gammel arkitektur-tekst");
        const meta = await p.locator(".hero .meta").innerText().catch(() => "");
        if (/Status|Versjon|Godkjent|v\d/i.test(meta)) prob.push(f + ": ulovlig meta " + meta);
        if (f === "teknisk.html") {
          for (const id of ["kort-for-alle", "hld", "lld", "drift", "overlevering"]) if (!(await p.locator(`.part-toc a[href="#${id}"]`).count())) prob.push("teknisk: toc mangler " + id);
          await shoot("2-teknisk-topp");
          await p.locator("#oppsett").scrollIntoViewIfNeeded(); await p.evaluate(() => document.getElementById("oppsett").scrollIntoView()); await p.waitForTimeout(300); await shoot("3-teknisk-oppsett");
        }
        if (f === "hva-er-nytt.html") { if (!(await p.locator("#d-2026-10-26").count())) prob.push("hva er nytt: mangler 26. oktober"); await shoot("4-hva-er-nytt"); }
      }
      for (const [u, re] of REDIR) { await p.goto(B + u); try { await p.waitForURL(re, { timeout: 5000 }); } catch (e) { prob.push(`omdirigering ${u} → ${p.url()}`); } }
      // API
      const helse = await (await p.request.get(B + "api/helse")).json(); if (helse.ok !== true) prob.push("api/helse: " + JSON.stringify(helse));
      const r404 = await p.request.get(B + "finnes-ikke"); if (r404.status() !== 404) prob.push("404: status " + r404.status());
      // Badehusappen: velg hus, book én periode
      await p.goto(B + "badehusappen/", { waitUntil: "networkidle" });
      await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "networkidle" });
      await p.waitForSelector(".day"); await ov("app"); await shoot("5-app-uke");
      const man = await p.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); return (await fetch(l.href)).json(); });
      if (man.scope !== "/" || man.start_url !== "/badehusappen/?kilde=hjemskjerm") prob.push("manifest: " + JSON.stringify([man.scope, man.start_url]));
      await p.click("#myHouseBtn"); await p.click('#sheetBody [data-house="A"]'); await p.waitForTimeout(200);
      await p.click("#nextBtn"); await p.waitForTimeout(200);
      await p.locator(".day").nth(2).locator(".dnum").click(); await p.waitForSelector("#bookBtn");
      await p.click('#sheetBody [data-type="AM"]'); await p.click('#sheetBody [data-type="PM"]');
      const bt = await p.textContent("#bookBtn"); if (!/ettermiddag/i.test(bt)) prob.push("bookknapp: " + bt);
      await shoot("6-app-booking");
      await p.click("#bookBtn"); await p.waitForFunction(() => !document.querySelector("#sheet").open);
      const day = await p.locator(".day").nth(2).innerText();
      if ((day.match(/Hus A/g) || []).length !== 1) prob.push("booking vises ikke som én periode: " + day.replace(/\s+/g, " "));
      const saved = await p.evaluate(() => JSON.stringify(localStorage).length); if (saved < 20) prob.push("ingenting lagret");
      await p.waitForTimeout(600); await shoot("7-app-booket");
      // Lenker fra appen
      await p.click('.tabs [data-view="mer"]'); await p.waitForSelector("#view-mer:not([hidden])");
      const links = await p.locator("#view-mer a").evaluateAll(as => as.map(a => a.getAttribute("href")));
      if (JSON.stringify(links) !== JSON.stringify(["/dokumentasjon/regler.html", "/dokumentasjon/teknisk.html"])) prob.push("mer-lenker: " + JSON.stringify(links));
      await p.click("header .brand"); await p.waitForURL(/:\d+\/$/);
    } catch (e) { prob.push("feil: " + e.message.split("\n")[0]); }
    if (prob.length) fails++;
    console.log(`${prob.length ? "FEIL" : "ok  "} ${bn} iPhone 402x874${prob.length ? "\n   " + prob.join("\n   ") : ""}`);
    await ctx.close(); await b.close();
  }
  console.log("feil:", fails); process.exit(fails ? 1 : 0);
})();
