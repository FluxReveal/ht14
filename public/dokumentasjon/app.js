/* ==========================================================
   Badehus-dokumentasjon – felles skript
   - Hamburgermeny på mobil
   - Automatisk innholdsfortegnelse (h2/h3) + ankerlenker
   - Enkelt søk på tvers av alle dokumentasjonssidene (indeks bygges i nettleseren)
   Ingen avhengigheter, ingen byggesteg.
   ========================================================== */
(function () {
  "use strict";

  /* ---------- Hamburgermeny ---------- */
  var btn = document.querySelector(".hamburger");
  var scrim = document.querySelector(".scrim");
  function setNav(open) {
    document.body.classList.toggle("nav-open", open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (btn) btn.addEventListener("click", function () {
    setNav(!document.body.classList.contains("nav-open"));
  });
  if (scrim) scrim.addEventListener("click", function () { setNav(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setNav(false); });

  /* ---------- Ankerlenker + innholdsfortegnelse ---------- */
  function slug(t) {
    return t.toLowerCase()
      .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  var article = document.querySelector("article");
  var tocList = document.querySelector(".toc ol");
  var heads = article ? article.querySelectorAll("h2, h3") : [];
  var used = {};
  Array.prototype.forEach.call(heads, function (h) {
    if (h.closest(".card, .device, figure, .hero")) return;
    if (!h.id) {
      var s = slug(h.textContent) || "seksjon";
      while (used[s]) s += "-x";
      h.id = s;
    }
    used[h.id] = true;
    var a = document.createElement("a");
    a.className = "anchor"; a.href = "#" + h.id; a.textContent = "#";
    a.setAttribute("aria-label", "Lenke til denne seksjonen");
    h.appendChild(a);
    if (tocList) {
      var li = document.createElement("li");
      li.className = h.tagName === "H3" ? "l3" : "l2";
      var l = document.createElement("a");
      l.href = "#" + h.id;
      var c = h.cloneNode(true), an = c.querySelector(".anchor");
      if (an) an.remove();
      l.textContent = c.textContent.replace(/\s+/g, " ").trim();
      li.appendChild(l); tocList.appendChild(li);
    }
  });
  if (tocList && !tocList.children.length) {
    var toc = document.querySelector(".toc"); if (toc) toc.style.display = "none";
  }
  // Marker aktiv seksjon i innholdsfortegnelsen
  if (tocList && "IntersectionObserver" in window) {
    var links = tocList.querySelectorAll("a");
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          links.forEach(function (l) {
            l.classList.toggle("active", l.getAttribute("href") === "#" + en.target.id);
          });
        }
      });
    }, { rootMargin: "0px 0px -75% 0px" });
    Array.prototype.forEach.call(heads, function (h) { if (h.id) obs.observe(h); });
  }

  /* ---------- Søk ----------
     Indeksen bygges i nettleseren første gang søkefeltet brukes:
     alle sider i menyen hentes (samme mappe) og deles opp på h2/h3. */
  var input = document.getElementById("sok");
  var out = document.getElementById("sok-resultat");
  var IDX = null, loading = null;
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function clean(node) {
    node.querySelectorAll("pre.mermaid, svg, table.cal, script, .anchor").forEach(function (n) { n.remove(); });
    return node.textContent.replace(/\s+/g, " ").trim();
  }
  function buildIndex() {
    if (loading) return loading;
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav a[data-sok]"));   // bare dokumentasjonssidene
    loading = Promise.all(links.map(function (a) {
      var url = a.getAttribute("href"), title = a.textContent.replace(/^\d+/, "").trim();
      return fetch(url).then(function (r) { return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var art = doc.querySelector("article"), entries = [], cur = { u: url, p: title, h: title, t: "" };
        if (!art) return entries;
        art.querySelectorAll(".pagenav, .footer").forEach(function (n) { n.remove(); });
        Array.prototype.forEach.call(art.children, function walk(el) {
          if (/^H[234]$/.test(el.tagName) && el.id) {
            entries.push(cur);
            cur = { u: url + "#" + el.id, p: title, h: clean(el.cloneNode(true)), t: "" };
          } else if (el.querySelector && el.querySelector("h2[id], h3[id], h4[id]") && !el.matches(".hero, .card, .device, figure, .part-toc")) {
            Array.prototype.forEach.call(el.children, walk);
          } else {
            cur.t += " " + clean(el.cloneNode(true));
          }
        });
        entries.push(cur);
        return entries;
      }).catch(function () { return []; });
    })).then(function (lists) { IDX = [].concat.apply([], lists); return IDX; });
    return loading;
  }
  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) { out.innerHTML = ""; return; }
    if (!IDX) { out.innerHTML = '<li><a href="#" tabindex="-1">Laster søk …</a></li>'; buildIndex().then(function () { search(input.value); }); return; }
    var words = q.split(/\s+/);
    var hits = IDX.map(function (e) {
      var hay = (e.h + " " + e.t).toLowerCase(), score = 0;
      for (var i = 0; i < words.length; i++) {
        if (hay.indexOf(words[i]) === -1) return null;
        if (e.h.toLowerCase().indexOf(words[i]) !== -1) score += 5;
        score += 1;
      }
      return { e: e, s: score };
    }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).slice(0, 12);
    if (!hits.length) {
      out.innerHTML = IDX.length ? '<li><a href="#" tabindex="-1">Ingen treff<small>Prøv et annet ord</small></a></li>'
                                 : '<li><a href="#" tabindex="-1">Søk er ikke tilgjengelig<small>Åpne siden via ht14.no eller en lokal webserver</small></a></li>';
      return;
    }
    out.innerHTML = hits.map(function (h) {
      var t = h.e.t.trim(), i = t.toLowerCase().indexOf(words[0]);
      var snip = i > -1 ? (i > 40 ? "…" : "") + t.slice(Math.max(0, i - 40), i + 70) + "…" : t.slice(0, 100);
      return '<li><a href="' + h.e.u + '">' + esc(h.e.h) + "<small>" + esc(h.e.p) + " · " + esc(snip) + "</small></a></li>";
    }).join("");
  }
  if (input && out) {
    input.addEventListener("focus", buildIndex);
    input.addEventListener("input", function () { search(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var f = out.querySelector("a[href]:not([href='#'])"); if (f) location.href = f.getAttribute("href"); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
    });
  }
})();
