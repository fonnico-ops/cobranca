import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("boleto.pdf")), useSystemFonts: true }).promise;
console.log("paginas:", doc.numPages);
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 2.0 });
console.log("viewport:", Math.round(vp.width), "x", Math.round(vp.height));

const t = await page.getTextContent();
console.log("\n--- texto que um leitor de PDF real extrai ---");
console.log(t.items.map(i => i.str).filter(s => s.trim()).join(" | "));

const ops = await page.getOperatorList();
const OPS = pdfjs.OPS;
const conta = {};
for (const f of ops.fnArray) { const n = Object.keys(OPS).find(k => OPS[k] === f) || f; conta[n] = (conta[n]||0)+1; }
console.log("\n--- operadores que o parser reconheceu ---");
console.log(Object.entries(conta).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join("  "));

const canvas = createCanvas(vp.width, vp.height);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff"; ctx.fillRect(0,0,vp.width,vp.height);
await page.render({ canvasContext: ctx, viewport: vp }).promise;
writeFileSync("boleto.png", canvas.toBuffer("image/png"));
console.log("\nboleto.png gravado:", readFileSync("boleto.png").length, "bytes");
