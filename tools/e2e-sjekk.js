// Nettleser-sjekk av ht14.no lokalt (WebKit = Safari/iPhone, og Chromium).
// Start først:  npx wrangler dev     Kjør så:  node tools/e2e-sjekk.js [adresse] [mappe-for-skjermbilder]
// Krever Playwright (npm i playwright). Lagrer skjermbilder i iPhone-størrelse (v05-*.png).
// Med ADMIN_EMAIL og ADMIN_PASSWORD (bare lokalt!) logger sjekken inn, booker, avbestiller og logger ut.
const { chromium, webkit } = require("playwright");
const B = process.argv[2] || "http://localhost:8787/";
const HOME = new RegExp("^" + B.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "$");
const LOCAL = /localhost|127\.0\.0\.1/.test(B);
const ADMIN = LOCAL && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD;
const SH = process.argv[3] || "./skjermbilder/";
const CHROME = process.env.CHROME_PATH;   // valgfritt: egen Chrome
const PAGES = [["teknisk.html", "Teknisk dokumentasjon"], ["regler.html", "Regler for bruk av badehuset"], ["vedtekter.html", "Forslag til tillegg i vedtektene"], ["arshjul.html", "Årshjul"], ["hva-er-nytt.html", "Hva er nytt"]];
const REDIR = [["dokumentasjon/", /dokumentasjon\/teknisk(\.html)?$/], ["dokumentasjon/hld.html#sikkerhet", /teknisk(\.html)?#sikkerhet$/],
  ["dokumentasjon/adminmanual.html#steg-3-github-token-som-bare-nar-data-repoet", /teknisk(\.html)?#oppsett$/], ["dokumentasjon/beslutninger.html", HOME],
  ["index.html#hva-er-nytt", /hva-er-nytt(\.html)?$/]];
(async () => {
  let fails = 0;
  for (const [bn, bt] of [["webkit", webkit], ["chromium", chromium]]) {
    const b = await bt.launch(bn === "chromium" && CHROME ? { executablePath: CHROME } : {});
    const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: bn === "chromium" });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    const prob = []; p.on("pageerror", e => prob.push("JS: " + e.message));
    // Skjermbilder fra WebKit (Safari). Innloggede bilder fra Chromium lokalt, fordi WebKit ikke lagrer Secure-cookies på http://localhost.
    const shoot = async (n, who = "webkit") => { if (bn === who) await p.screenshot({ path: `${SH}v05-${n}.png` }); };
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
      // Badehusappen uten innlogging: bare Hus A–D og innloggingen
      await p.goto(B + "badehusappen/", { waitUntil: "networkidle" });
      await p.waitForSelector("#loginForm"); await ov("app"); await shoot("1-app-innlogging");
      const houses = await p.locator("#om .houses li").allInnerTexts();
      if (JSON.stringify(houses.map(t => t.trim())) !== '["Hus A","Hus B","Hus C","Hus D"]') prob.push("om oss før innlogging: " + JSON.stringify(houses));
      if (!(await p.locator(".tabs").isHidden())) prob.push("faner vises før innlogging");
      const ac = await p.evaluate(() => [document.querySelector("#loginEmail").autocomplete, document.querySelector("#loginPassword").autocomplete]);
      if (ac.join() !== "username,current-password") prob.push("autocomplete: " + ac);
      if (/egen telefon|prøveversjon|Nullstill/i.test(await p.locator("body").innerText())) prob.push("gammel tekst om lagring på telefonen");
      const man = await p.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); return (await fetch(l.href)).json(); });
      if (man.scope !== "/" || man.start_url !== "/badehusappen/?kilde=hjemskjerm") prob.push("manifest: " + JSON.stringify([man.scope, man.start_url]));
      if ((await p.request.get(B + "api/contacts")).status() !== 401) prob.push("api/contacts uten innlogging er ikke 401");
      const csp = (await p.request.get(B + "badehusappen/")).headers()["content-security-policy"] || "";
      if (!/script-src 'self';/.test(csp)) prob.push("appen mangler streng CSP");
      await p.fill("#loginEmail", "finnes-ikke@example.no"); await p.fill("#loginPassword", "feil-passord-1"); await p.click("#loginBtn");
      await p.waitForFunction(() => document.querySelector("#loginMsg").textContent.length > 0);
      if (!/Feil e-post eller passord/.test(await p.textContent("#loginMsg"))) prob.push("feil innlogging: " + await p.textContent("#loginMsg"));
      if (ADMIN && bn === "chromium") {
        await p.fill("#loginEmail", process.env.ADMIN_EMAIL); await p.fill("#loginPassword", process.env.ADMIN_PASSWORD); await p.click("#loginBtn");
        await p.waitForSelector("#view-kalender:not([hidden]) .day"); await p.waitForTimeout(300); await shoot("2-kalender", "chromium");
        await p.click("#nextBtn"); await p.waitForTimeout(300);
        await p.locator(".day").nth(2).locator(".dnum").click(); await p.waitForSelector("#bookBtn");
        const pre = await p.locator('#sheetBody [data-type][aria-checked="true"]').evaluateAll(bs => bs.map(x => x.dataset.type));
        if (JSON.stringify(pre) !== '["PM"]') prob.push("forhåndsvalg er ikke kveld: " + JSON.stringify(pre));
        if (!/gjester/.test(await p.locator("#sheetBody").innerText())) prob.push("mangler hint om gjester");
        await p.click('#sheetBody [data-house="A"]');
        const bt = await p.textContent("#bookBtn"); if (!/kveld for Hus A/i.test(bt)) prob.push("bookknapp: " + bt);
        await p.waitForTimeout(400); await shoot("3-booking", "chromium");
        await p.click("#bookBtn"); await p.waitForFunction(() => !document.querySelector("#sheet").open);
        await p.waitForTimeout(300);
        const day = await p.locator(".day").nth(2).innerText();
        if ((day.match(/Hus A/g) || []).length !== 1) prob.push("booking vises ikke: " + day.replace(/\s+/g, " "));
        // avbestill igjen, så lokale data blir ryddige
        await p.locator(".day").nth(2).locator(".dnum").click(); await p.waitForSelector('#sheetBody [data-act="cancel"]');
        await p.click('#sheetBody [data-act="cancel"]'); await p.click("#sheetBody [data-yes]"); await p.waitForTimeout(500);
        await p.click("#sheetClose").catch(() => {});
        await p.click('.tabs [data-view="om"]'); await p.waitForSelector("#om h2"); await p.waitForTimeout(300); await shoot("4-om-oss", "chromium");
        await p.click('.tabs [data-view="mer"]'); await p.waitForSelector("#view-mer:not([hidden])");
        if (!/HT14 versjon 0\.5/.test(await p.locator("#view-mer").innerText())) prob.push("Mer mangler versjon");
        const links = await p.locator("#view-mer a").evaluateAll(as => as.map(a => a.getAttribute("href")));
        if (JSON.stringify(links) !== JSON.stringify(["/dokumentasjon/regler.html", "/dokumentasjon/teknisk.html", "/"])) prob.push("mer-lenker: " + JSON.stringify(links));
        await p.click("#adminLink button"); await p.waitForSelector("#admin .group"); await p.waitForTimeout(300); await shoot("5-admin", "chromium");
        await p.click('.tabs [data-view="mer"]'); await p.click("#logoutBtn"); await p.waitForSelector("#loginForm:visible");
        if ((await p.request.get(B + "api/me")).status() !== 401) prob.push("fortsatt innlogget etter utlogging");
      }
      await p.goto(B, { waitUntil: "networkidle" }); await shoot("6-startside");
      if (!/HT14 versjon 0\.5/.test(await p.locator("footer").innerText())) prob.push("startside: mangler versjon i bunnen");
      if (!(await p.locator(".cards a.hoved[href='/badehusappen/']").count())) prob.push("startside: mangler stor Badehusappen-knapp");
    } catch (e) { prob.push("feil: " + e.message.split("\n")[0]); }
    if (prob.length) fails++;
    console.log(`${prob.length ? "FEIL" : "ok  "} ${bn} iPhone 402x874${prob.length ? "\n   " + prob.join("\n   ") : ""}`);
    await ctx.close(); await b.close();
  }
  console.log("feil:", fails); process.exit(fails ? 1 : 0);
})();
