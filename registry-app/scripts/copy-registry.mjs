/**
 * copy-registry.mjs — gera app/registry-data.ts a partir do public/r do DS.
 * Embute os JSON num módulo (em vez de fs no runtime) pra funcionar igual no
 * Vercel (serverless não traça leitura dinâmica de arquivo fora do root dir).
 *
 * ⚠️ Rode SEMPRE com cwd = registry-app/: o SRC é resolvido relativo ao cwd, então
 * da raiz do repo ele aponta pro PAI do repo, não acha nada e sai 0 em silêncio.
 *     (cd registry-app && node scripts/copy-registry.mjs)
 *
 * Pré-requisito: `npm run registry:build` na raiz do DS (gera ../public/r/*.json).
 *
 * ## Por que este script se recusa a escrever quando o public/r está velho
 *
 * `public/r` é gitignored e NÃO é regenerado por este script — é só a saída do
 * `registry:build`. Se ele estiver de uma release anterior, gerar o embed a partir
 * dele REGRIDE o que o consumidor recebe, em silêncio e com todo check verde até
 * alguém rodar o `registry-check`. Caso real (2026-07-29): o `public/r` da máquina
 * do mantenedor era de **v0.29.0** enquanto o embed commitado estava em v0.30.0 —
 * regenerar teria (a) revertido 86 itens pra v0.29.0, (b) re-injetado os headers
 * `@igreen-stamp` que a v0.30.0 removeu de propósito, e (c) DROPADO o
 * `choropleth-map`, que nem existia no registry naquela release. Exatamente a L-058
 * se repetindo, no mesmo componente.
 *
 * Por isso: valida ANTES de escrever, e falha alto em vez de produzir artefato ruim.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("..", "public", "r"); // cwd = registry-app/ → ../public/r do DS
const OUT = path.resolve("app", "registry-data.ts");
const REGISTRY = path.resolve("..", "registry.json");

// Sem ../public/r (ex.: build no Vercel sem "include outside root") → mantém o
// registry-data.ts commitado. Só regenera quando o public/r do DS está presente.
if (!fs.existsSync(SRC)) {
  console.log("../public/r ausente — mantém app/registry-data.ts commitado.");
  process.exit(0);
}

const map = {};
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith(".json") || f === "registry.json") continue; // só os items
  map[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
}

// ── Guarda: o public/r tem que cobrir o registry.json, na mesma versão ──────────
// Só roda quando o registry.json está alcançável (da raiz do DS). Se não estiver,
// não há com o que comparar e o comportamento antigo é preservado.
if (fs.existsSync(REGISTRY)) {
  const STAMP = /igreen-ds · [^·]+ · v([\d.]+) · ([0-9a-f]+) ·/;
  const items = JSON.parse(fs.readFileSync(REGISTRY, "utf8")).items ?? [];
  const erros = [];

  const ausentes = items.map((i) => i.name).filter((n) => !(n in map));
  if (ausentes.length) {
    erros.push(
      `${ausentes.length} item(ns) do registry.json não estão em public/r: ${ausentes.join(", ")}`,
    );
  }

  // Versão do carimbo: public/r de release anterior = embed regredido.
  const vDe = (s) => (STAMP.exec(s ?? "") ?? [])[1];
  const vRegistry = [...new Set(items.map((i) => vDe(i.meta?.stamp)).filter(Boolean))];
  const vDisco = [...new Set(Object.values(map).map((i) => vDe(i?.meta?.stamp)).filter(Boolean))];
  const defasadas = vDisco.filter((v) => !vRegistry.includes(v));
  if (defasadas.length) {
    erros.push(
      `carimbo divergente — registry.json está em v${vRegistry.join("/")} e public/r em v${vDisco.join("/")}`,
    );
  }

  if (erros.length) {
    console.error("✗ public/r DEFASADO — embed NÃO foi escrito (o antigo está intacto).");
    for (const e of erros) console.error(`   ${e}`);
    console.error("   → regenere a fonte primeiro, da raiz do DS:  npm run registry:build");
    console.error("     depois:  (cd registry-app && node scripts/copy-registry.mjs)");
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  "// AUTO-GERADO por scripts/copy-registry.mjs — não editar.\n" +
    "export const registry: Record<string, unknown> = " +
    JSON.stringify(map, null, 2) +
    ";\n",
);
console.log("registry-data.ts:", Object.keys(map).length, "items →", Object.keys(map).join(", "));
