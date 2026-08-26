# `client/` — вага пакетів, застарілість, вразливості

Дата аналізу: 2026-08-26 · pnpm 11.20.0 · Node v24.5.0. Прогнано `pnpm outdated` / `pnpm audit` на вже наявному `client/node_modules` (install не запускався).

### 1. Наскільки важкий client/

- **`node_modules` = 620 MB**, у `node_modules/.pnpm/` — **440 унікальних резолвнутих пакетів** (транзитивно).
- Прямих залежностей: 11 `dependencies` + 11 `devDependencies` = 22.
- Найважчі на диску: `next@15.5.19` (152 MB) + `@next/swc-darwin-arm64` (124 MB, нативний біндінг) = ~276 MB від одного фреймворка; `mermaid@11.15.0` (75 MB, тягне cytoscape, cytoscape-fcose, katex, dompurify, es-toolkit, @mermaid-js/parser — сумарно ще ~35 MB довкола нього); `lucide-react@0.469.0` (36 MB, стара версія); `typescript@5.9.3` (23 MB, dev); `sharp-libvips` (15 MB, транзитивна через `next`).
- Висновок: не критично важкий проєкт, але дві залежності — `next` і `mermaid` — дають непропорційно велику частку ваги. Якщо mermaid використовується для обмеженого функціоналу, варто оцінити lazy-load (`next/dynamic`) або легшу альтернативу.

### 2. Застарілі пакети (pnpm outdated)

17 з 22 прямих залежностей мають новішу версію; 7 — мажорний розрив: `next` 15.5.19→16.3.2, `next-intl` 3.26.5→4.13.7, `zod` 3.25.76→4.4.3, `recharts` 2.15.4→3.10.1, `react-markdown` 9.1.0→10.1.0, `lucide-react` 0.469.0→1.34.0, `vitest` 2.1.9→4.1.11 (dev), плюс `jsdom` 25→30, `typescript` 5.9→7.0, `@vitejs/plugin-react` 4.7→6.1 (усі dev). Патч-рівня: `react`/`react-dom` 19.2.7→19.2.8, `tailwindcss` 4.3.0→4.3.3, `postcss` 8.5.15→8.5.26, `mermaid` 11.15.0→11.17.1 (мінор, але закриває security-фікси — див. нижче).

### 3. Вразливості (pnpm audit)

**32 вразливості: 1 critical · 10 high · 18 moderate · 3 low.** Ключові, з підтвердженою встановленою версією:

- **critical**: `vitest@2.1.9` — довільне читання/виконання файлів через Vitest UI server (fix `>=3.2.6`).
- **high**: `next@15.5.19` — DoS у Server Actions (App Router), SSRF у Server Actions на кастомних серверах, SSRF у rewrites через контрольований hostname — усі три закриваються патчем `>=15.5.21`.
- **high**: `postcss@8.5.15` (через next/next-intl/@tailwindcss-postcss) — довільне читання файлів через `sourceMappingURL` (fix `>=8.5.12`, поточна вже застаріла проти пізніших фіксів `>=8.5.18`/`>=8.5.23`).
- **high**: `sharp` (транзитивна через `next`) — успадковані CVE в libvips (fix `>=0.35.0`).
- **high**: `nanoid` (через next/postcss, 8 шляхів) — нескінченний цикл при негативному/нульовому size.
- **high**: `vite@5.4.21` (через vitest/@vitejs/plugin-react, dev) — обхід `server.fs.deny` на Windows; `form-data` (через jsdom→vitest) — CRLF-ін'єкція.
- **moderate**: `next-intl@3.26.5` — open redirect (fix `>=4.9.1`) та prototype pollution через `precompile` (fix `>=4.9.2`) — прямий production-пакет, потребує мажорного апгрейду 3→4.
- **moderate ×4 + low ×1**: `mermaid@11.15.0` — CSS-ін'єкція, prototype pollution в Architecture diagrams, DoS в XY charts/radar, prototype pollution через конфіг-API — усе закривається мінорним `>=11.16.1`.
- **moderate/low**: `dompurify@3.4.8` (транзитивна через mermaid) — кілька XSS/pollution CVE, потребує новішого mermaid/dompurify.
- **moderate**: `esbuild` (через vite/vitest, dev) — dev-сервер приймає запити з будь-якого сайту.

### 4. Пріоритезовані рекомендації

1. **Терміново**: `vitest` → `>=3.2.6` (закриває critical + тягне свіжий vite/esbuild, знімаючи кілька high/moderate).
2. **Терміново**: `next` → останній патч 15.5.x (`>=15.5.21`) — закриває 3 high + 3 moderate без мажорного ризику; мажор на Next 16 — окремою задачею.
3. **Швидко**: `mermaid` → `>=11.16.1` — закриває 4 moderate + 1 low, мінорний бамп.
4. **Незабаром**: `next-intl` → `>=4.9.2` (мажор 3→4) — закриває moderate open redirect і prototype pollution у прямій production-залежності.
5. **Розглянути**: `lucide-react` сильно відстає (0.469→1.34, 36 MB на диску) — оцінити tree-shaking у новіших версіях.
6. **Технічний борг (не security)**: `zod` 3→4, `recharts` 2→3, `react-markdown` 9→10, `typescript` 5.9→7, `jsdom` 25→30 — плановий апгрейд, перевірка breaking changes.
7. **Вага бандла**: оцінити, чи виправдана вага mermaid (75 MB + важке транзитивне дерево) відносно того, наскільки широко він використовується в UI; розглянути `next/dynamic` lazy-load.

Методологія: read-only аналіз на вже встановленому `node_modules` (без `pnpm install`), `du -sh` для розміру, кількість директорій у `.pnpm/` для кількості пакетів, `pnpm audit`/`pnpm outdated` для вразливостей і застарілості. Аналіз обмежений `client/` — не включає `server/`, `reviewer-core/`, `e2e/`, `mcp-server/`, `evals/`.
