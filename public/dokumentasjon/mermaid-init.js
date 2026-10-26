/* Laster Mermaid fra jsDelivr (CDN) og tegner alle diagrammer klientsiden.
   Diagramkilden står som ren tekst i <pre class="mermaid"> i HTML-en,
   så den kan leses og endres uten verktøy. */
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  themeVariables: {
    primaryColor: "#ecfeff", primaryBorderColor: "#0e7490", primaryTextColor: "#0f172a",
    lineColor: "#475569", secondaryColor: "#f1f5f9", tertiaryColor: "#fff7ed",
    actorBkg: "#ecfeff", actorBorder: "#0e7490", noteBkgColor: "#fffbeb", noteBorderColor: "#f59e0b",
    fontSize: "14px"
  },
  flowchart: { curve: "basis", htmlLabels: true },
  sequence: { mirrorActors: false, showSequenceNumbers: true }
});
await mermaid.run({ querySelector: ".mermaid" });
