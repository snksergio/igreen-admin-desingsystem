# iGreen Design System — Distribuição & Arquitetura (técnico)

> Documento técnico. Cobre **arquitetura, modelo de distribuição, versionamento,
> stack** e o **pipeline de IA** (DS-side: agents/commands/skills/hooks; consumer-side:
> orquestrador + skills que produzem telas padronizadas). Público: dev (a fundo) e
> produto técnico (acompanha). Para a versão de apresentação resumida, ver o deck.

---

## 1. Modelo de distribuição: copy-in via registry shadcn

O DS **não** é publicado como pacote npm consumível. É distribuído via **registry
shadcn (copy-in)**: o código-fonte de cada componente é **copiado para o `src/` do
projeto consumidor** no momento do `add`, passando a ser código do consumidor
(editável, versionado no Git dele).

| Eixo | Pacote npm | Copy-in via registry (adotado) |
|---|---|---|
| Entrega | artefato buildado em `node_modules` | fonte `.tsx`/`.ts` copiada para `src/components/ui/` |
| Edição pelo consumidor | inviável (código de terceiro) | livre (é código dele) |
| Atualização | `npm update` (semver, push a todos) | `igreen:update` opt-in, por componente |
| Acoplamento de build | peer deps + Tailwind config + `@source` em node_modules | nenhum — o código vive no projeto |
| Manutenção (mantenedor) | build de lib, types, matriz semver, breaking coordenado | um repositório; publica no registry |

**Justificativa técnica:** os produtos são CRMs/operações com telas sob medida — o
consumidor precisa **editar** componentes e a IA dele precisa **copiar/adaptar**
exemplos. Em `node_modules` isso é inviável. O custo (atualização opt-in) é mitigado
por manifesto + drift-check (§4). Mecanismo idêntico ao **shadcn/ui** (padrão de
mercado), sobre a infra `shadcn build` / `shadcn add`.

---

## 2. Organização do repositório

```
igreen-ds/
├─ tokens/brands/default/        # fonte dos design tokens (3 tiers)
│   ├─ primitives/               #   Tier 1 — paleta OKLCH, escalas, fonts, motion (privado)
│   ├─ semantic/                 #   Tier 2 — color-light/dark, spacing, sizing, shape, elevation, typography
│   ├─ components/               #   Tier 2.5 — form.*, layout.*, icon.*, padCard.*, padPage.*
│   └─ transforms/to-tailwind-v4.ts   # gera o CSS @theme (tokens:tw4)
├─ src/
│   ├─ components/ui/<Nome>/     # componentes iGreen (tv()): .tsx + .styles.ts + .types.ts + USAGE.md
│   ├─ components/shadcn/<nome>  # primitivos shadcn tematizados (Radix)
│   ├─ styles/theme/tailwind-theme.css   # CSS gerado (CSS vars OKLCH) — NÃO editar à mão
│   ├─ utils/tv.ts               # tv() + twMergeConfig (prefixos DS + presets tipográficos)
│   ├─ lib/utils.ts              # cn() (extendTailwindMerge)
│   ├─ examples/<tela>/          # telas-exemplo (extração 1:1 dos showcases) — itens example-*
│   └─ preview/pages/*Doc.tsx    # catálogo/styleguide (este preview)
├─ registry.json                 # MANIFESTO canônico do registry (itens, files, deps)
├─ public/r/                     # JSON por item gerado por `shadcn build` (gitignored)
├─ registry-app/                 # app Next.js que SERVE o registry na Vercel
│   ├─ app/r/[name]/route.ts     #   route handler com auth Bearer + no-store
│   └─ app/registry-data.ts      #   EMBED dos JSON (commitado — fonte do deploy serverless)
├─ scripts/                      # registry-stamp, registry-add-item, registry-check,
│                                #   examples-drift-check, check-foundationals, cli-rebake
├─ cli/                          # CLI npm @snksergio/create-design-system
│   └─ templates/default/        #   o projeto gerado no scaffold (com .claude/ + DESIGN.md)
├─ .claude/                      # pipeline de IA do DS (agents/skills/commands/hooks/rules)
└─ .ai/                          # contexto técnico, lições (L-001..L-037), audit log
```

**Fonte única:** o registry referencia **sempre `src/`** (os `files[].path` apontam pra
`src/components/...`). `dist-lib/` (build de lib npm) é **vestigial/depreciado** e não
participa da distribuição.

---

## 3. Pipeline de distribuição (fonte → consumidor)

```
src/ + registry.json
   │  npm run registry:build  =  tokens:tw4 → registry:stamp → shadcn build
   ▼
public/r/<item>.json   (conteúdo embutido + import paths)
   │  registry-app/scripts/copy-registry.mjs
   ▼
registry-app/app/registry-data.ts   (EMBED commitado)
   │  git merge em main  →  Vercel auto-deploy (Root=registry-app)
   ▼
https://igreen-registry.vercel.app/r/<item>.json   (Bearer-protected)
   │  consumidor: npm run igreen:add -- <item>   (= npx shadcn add @igreen/<item>)
   ▼
src/components/ui/<Nome>/...   no projeto do consumidor
```

**Detalhes técnicos relevantes:**

- **Schema do item** (`registry.json`): `name`, `type` (`registry:ui` | `registry:file`),
  `registryDependencies` (namespaced `@igreen/*`), `dependencies` (npm, ex.:
  `@tanstack/react-virtual@^3.13.24`), `files[]` (`path` em `src/…`, `target` em
  `components/ui/…`), `meta.stamp`.
- **Reescrita de import no `add`** (copy-in transform): imports `@/components/shadcn/X`
  de um componente que é `registryDependency` são reescritos para o alias do consumidor
  `@/components/ui/X`. Imports relativos (`./`, `../`) são preservados — por isso os
  exemplos multi-arquivo espelham a estrutura de pastas.
- **Embed vs `public/r`:** o serverless da Vercel não lê `../public/r` fora do root dir;
  por isso o conteúdo é embutido em `registry-data.ts` (commitado) e servido por um
  **route handler** (`force-dynamic` + `no-store`, valida `Authorization: Bearer`).
  Sem isso, servir estático vazava 200 sem token via CDN.
- **Bundle data-table:** `@igreen/data-table` empacota DataTable + TableToolbar (104
  arquivos) num único item, resolvendo a dependência circular entre eles.

### ⚠️ Três armadilhas desta cadeia (achadas em 2026-07-29)

**1. O passo do meio é manual — e o `prebuild` NÃO cobre.** O `registry-app/package.json`
tem `"prebuild": "node scripts/copy-registry.mjs"`, o que dá a impressão de que o embed se
regenera no deploy. Não regenera: o `vercel.json` declara `buildCommand: "next build"`, que
**não** dispara o lifecycle `prebuild` do npm. E mesmo se disparasse, o script sai cedo
quando `../public/r` não existe (é gitignored e fica fora do root dir da Vercel) — por
design, mantendo o embed commitado. **Conclusão: a Vercel serve exatamente o
`registry-data.ts` que está commitado.** Regenerar é passo humano do `/ds-release`.

> **`public/r` velho REGRIDE o consumidor — o `copy-registry.mjs` agora se recusa.**
> `public/r` é gitignored e o script **não** o regenera; é só a saída do `registry:build`.
> Gerar o embed de um `public/r` de release anterior reverte o que o consumidor recebe, em
> silêncio. Caso real (2026-07-29): o `public/r` da máquina do mantenedor era de **v0.29.0**
> com o embed em v0.30.0 — regenerar teria revertido 86 itens, **re-injetado os headers
> `@igreen-stamp` que a v0.30.0 removeu de propósito**, e dropado o `choropleth-map`, que
> não existia no registry naquela release (a L-058 se repetindo, no mesmo componente).
> O script passou a comparar, **antes de escrever**, o conjunto de itens e a versão do
> carimbo contra o `registry.json`; divergência → `exit 1` sem tocar no embed. Sempre rode
> `npm run registry:build` antes.

**2. `registry-check` valida o embed por CARIMBO, não por nome.** Até 2026-07-29 ele só
checava se o embed continha o *nome* dos itens — e nome não muda entre releases, então era
verde-permanente com o conteúdo arbitrariamente velho. O cenário que passava batido: bump
pra 0.30.1 → `registry:build` carimba o `registry.json` → esquece o `copy-registry.mjs` →
**consumidor recebe o código de 0.30.0 rotulado como 0.30.1**, com todo check verde. Agora
o check compara `meta.stamp` (versão + hash git) dos dois artefatos commitados e reprova
com a instrução de conserto. Lógica em `scripts/lib/embed-staleness.mjs`.

**3. ⛔ NUNCA rode `npm audit fix --force` no `registry-app`.** O npm agrega os ranges dos
advisories do `next` em `9.3.4-canary.0 - 16.3.0-preview.7` e "corrige" instalando
**`next@9.3.3`** — downgrade de 6 majors, num serviço público. O caminho certo é subir o
piso à mão: os 8 advisories valem para `<15.5.21`, então `^15.5.22` resolve todos **sem
sair do 15.x**. `postcss`/`sharp` são transitivas do next e sobem por `overrides`. O
`registry-app` também passou a ter cobertura de CI (install do lockfile próprio, typecheck,
`next build`, audit informativo) — antes **nenhum** workflow o tocava, e foi por isso que
o lock ficou pinando um `next` vulnerável sem ninguém ver. `installCommand` virou `npm ci`:
com `npm install` a Vercel resolvia versões diferentes das auditadas.

---

## 4. Versionamento

- **Versão global única** = `package.json.version` (hoje `0.10.0`). **Não** há semver
  por-componente. Cada item do registry carrega `meta.stamp = essa versão` — inclusive
  `@igreen/theme` (tokens/tema). Logo **tokens e tema são versionados** junto.
- **Carimbo só em `meta.stamp`**, nunca no conteúdo do arquivo — assim o re-stamp de uma
  release não altera o `content`, e o `shadcn add` subsequente não força re-download.
- **Lado mantenedor:** `/ds-release` → bump `package.json` + entry no changelog
  (`updates-data.ts`) + `registry:build` (re-stamp + embed) + commit/PR. Merge → deploy.
- **Lado consumidor:**
  - `igreen:add` grava no `.igreen-ds/manifest.json`, **por componente**: `rev`
    (=stamp na hora) + `hash` do conteúdo instalado (baseline).
  - `igreen:drift` compara **hash de conteúdo** local vs registry → só acusa
    "atualização disponível" quando o **código** difere (não no re-stamp global);
    e acusa "editado localmente" quando o hash local ≠ baseline.
  - `igreen:update [-- <itens> | --all]` atualiza **pulando** componentes editados
    localmente (salvo `--force`) e re-baselina.
- **Rollback por componente:** via Git do consumidor (é código dele) — reverter só a
  pasta do componente. O registry serve **apenas a versão atual** (não é arquivo
  histórico); versão histórica por-componente é evolução futura (endpoints versionados).

---

## 5. Kit do consumidor — telas padronizadas via IA

Todo projeto scaffoldado nasce com um **pipeline de IA embutido** (`.claude/` +
`DESIGN.md`) que faz a IA do consumidor montar telas no padrão **por intenção, em
linguagem natural** — sem prompt técnico. Roteamento é por **skill** (mecanismo nativo
do Claude Code, disparado pela `description` — barato), **não por subagente** (que
custaria uma janela de contexto por requisição).

**Componentes do kit:**

| Peça | Arquivo | Função |
|---|---|---|
| Orquestrador (front-door) | `.claude/skills/ds-kit/SKILL.md` | classifica a intenção da tela → roteia pra skill/exemplo |
| Skill CRUD (entrevista) | `.claude/skills/crud-builder/` | tabela/CRUD: entrevista → blueprint (GATE) → geração espelhando `example-clientes` |
| Skills focadas | `page-edit`, `page-detail`, `dashboard`, `charts`, `chat`, `drawers`, `cards` | cada tipo de tela ancorado no seu `example-*`/componente |
| Slash commands | `.claude/commands/ds-create-crud.md`, `ds-build-page.md` | portas de entrada explícitas |
| Regras auto-carregadas | `.claude/rules/ds-design.md` (glob `**/*.tsx`) | aplica padrões sem ser pedido (anatomia de tela, `gap-form-gap`, tokens DS) |
| Guia de composição | `DESIGN.md` (raiz) | anatomia, ritmo de espaçamento, do/don't, responsividade; aponta pros `USAGE.md` |
| Hook de integridade | `.claude/hooks/protect-ds.mjs` (PreToolUse, exit 2) | bloqueia edição de tema/tokens/`cn`/`tv`; avisa edição de componente |
| Descoberta | `.mcp.json` (shadcn MCP) | a IA lista/adiciona `@igreen/*` por conta própria |

**Fluxo de intenção → tela:**
```
usuário: "monte uma tabela de produtos"
   → ds-kit classifica (tabela/lista/crud) → carrega crud-builder
   → entrevista (colunas, filtros, kanban) → blueprint [GATE]
   → igreen:add example-clientes + data-table → lê o exemplo → gera a tela
   → aplica DESIGN.md (wrapper flex h-full, gap pós-PageHeader, FormField em form)
   → npx tsc --noEmit → entrega
```
Cada tipo de tela tem um **exemplo de produção** (extração 1:1 dos showcases) como
referência viva: `example-clientes` (CRUD), `example-finance` (KPIs+DataTable+drawers),
`example-dashboard` (Recharts), `example-order-detail` (tabs), `example-edit-page`
(multi-step form), `example-chat` (inbox). A IA **adapta o exemplo**, não escreve do zero.

---

## 6. Governança / integridade (sem manutenção recorrente)

Copy-in = código do consumidor; não dá pra travar arquivo. A integridade é garantida em
3 camadas, todas embutidas no scaffold:

1. **Orientação** — `DESIGN.md` + `.claude/rules/ds-design.md` (auto-load).
2. **Trava (hook `protect-ds.mjs`)** — `exit 2` (bloqueia) em `src/styles/theme/**`,
   `src/lib/utils.ts` (cn), `src/utils/tv.ts` (tv), `src/lib/lucide-types.ts`;
   `exit 1` (avisa) em `src/components/ui/**`.
3. **Detecção** — `igreen:drift` (conteúdo vs registry + edição local).

Regra de ouro: **customizar na composição** (variantes/props + classes na tela), nunca
nos tokens/internals. Mudar tema = re-sincronizar com o DS.

---

## 7. Pipeline do DS (lado mantenedor)

O desenvolvimento do DS roda sobre um pipeline próprio em `.claude/`:

- **Agents** (`.claude/agents/`): `orchestrator` (classifica/roteia), `ds-designer`
  (especifica token/componente), `ds-dev` (implementa), `ds-reviewer` (valida). Fluxo:
  designer → **[GATE humano]** → dev → reviewer. (`app-designer`/`app-dev-react` são
  reservados, não-operacionais.)
- **Commands** (`.claude/commands/`): `/ds-add-token`, `/ds-create-component`,
  `/ds-add-shadcn`, `/ds-create-composite`, `/ds-extract-figma`, `/ds-create-crud`,
  `/ds-update`, `/ds-release`.
- **Skills** (`.claude/skills/<agent>/`): procedimentos (spec-token, impl-igreen/shadcn/
  composite, review-component, pre-commit-check, release, crud-builder…).
- **Hooks** (`.claude/settings.json`): PostToolUse — `ds-lint-styles`
  (L-001..L-007 em `*.styles.*`), `ds-inventory-check` (USAGE/inventory/registry),
  `ds-tokens-check` (avisa `tokens:tw4`+release). PreToolUse — `block-rm-rf`,
  `block-sensitive-edit` (`.env`/credenciais, exit 2).
- **CI** (`.github/workflows/ci.yml`): `tsc` + `vitest` + `registry-check`
  (paths/embed/backslash) + `examples-drift-check` + `check-foundationals` (sync CLI↔DS).
- **Rules/contexto**: `.claude/rules/ds-standards.md` (auto-load) + `.ai/status/lessons.md`
  (L-001..L-037) + `.ai/status/pipeline-state.md` (audit log).

---

## 8. Stack

- **UI:** React 19 · TypeScript · Vite · Tailwind CSS v4 (`@theme`/`@theme inline`).
- **Estilo:** `tailwind-variants` (`tv()` via `@/utils/tv`) + `cn` (extendTailwindMerge
  com prefixos DS) · Radix UI (primitivos shadcn) · cores **OKLCH** + `color-mix()`.
- **Dados/UX:** `@tanstack/react-virtual` (DataTable) · `@dnd-kit` (Kanban) ·
  `recharts` (Chart) · `lucide-react` · `react-day-picker` · Geist (fonte).
- **Distribuição:** shadcn registry (`shadcn build`/`add`) · Next.js (registry-app) ·
  Vercel (deploy + auth Bearer) · npm (apenas o CLI `@snksergio/create-design-system`).
- **Qualidade:** Vitest · GitHub Actions · hooks Claude Code.

---

## 9. Decisões de arquitetura (racional)

| Decisão | Racional técnico |
|---|---|
| Copy-in (não npm) | telas sob medida exigem editar; IA copia/adapta; sem acoplamento de build em node_modules |
| Registry na Vercel + embed | serve central/privado; serverless não lê fora do root → embed commitado + route handler com Bearer |
| Versão global única | 1 mantenedor; menos cerimônia; stamp em `meta` evita churn de download; per-componente fica pra escala |
| Drift por hash de conteúdo | re-stamp global não gera falso "defasado"; só conteúdo real conta |
| Roteamento por skill (não agente) | nativo/barato (description-triggered); subagente só pra trabalho pesado paralelo |
| Integridade por hook (não lock) | impossível travar código do consumidor → orienta + bloqueia o crítico + detecta |
| Exemplos = extração 1:1 | garantia de produção conforme showcases; drift-check alerta divergência da fonte |

---

## 10. FAQ

**É pacote npm?** Não — só o CLI é npm. Componentes são copy-in.
**Editar quebra no update?** Não — `igreen:update` pula editados (ou `--force`).
**Tokens/tema versionados?** Sim, pelo stamp da versão global.
**Voltar versão de um componente?** Sim, via Git do projeto (é código dele); o registry
serve só a versão atual.
**Como a IA garante o padrão?** Kit no scaffold: `ds-kit` roteia a intenção, skills
geram a partir dos exemplos, `DESIGN.md`+rules aplicam espaçamento/tokens, `protect-ds`
bloqueia edição do núcleo.

---

*Referência viva: página **Distribution** + **Structure** no catálogo do DS;
`README-PIPELINE-WORKFLOW.md` (pipeline completo). Distribuição/versão são estampadas
por release via `/ds-release`.*
