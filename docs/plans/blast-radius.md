# Blast Radius — план реалізації

> Гілка `lab04`. Формат повторює `docs/plans/intent-layer.md` /
> `docs/plans/smart-diff.md`. Складено `planner`-агентом на основі
> дослідження коду (file:line-докази нижче); код не писався. Очікує
> підтвердження користувача на одне відкрите питання — §8, «Graph: ручний
> SVG vs `MermaidDiagram`».

## 1. Контекст

Рев'юер бачить у PR лише змінені рядки. Питання «а що ще це зачепить?»
сьогодні не має відповіді в UI. Blast Radius — панель у табі **Overview**
сторінки PR, яка детерміновано (**без жодного LLM-виклику**) відповідає на
нього трьома зрізами:

1. які символи оголошені у змінених файлах;
2. хто їх імпортує/викликає (`файл:рядок`, клікабельно);
3. які HTTP-ендпоінти і cron/scheduled-джоби можуть залежати від зміненого коду.

Усі факти вже лежать у `repo-intel`-індексі (`symbols`, `references`,
`file_edges`, `file_facts`, `file_rank`). Фіча — це **читання індексу і
представлення**, а не новий аналіз.

## 2. Ключове відкриття під час дослідження

Фіча заскафолджена **нерівномірно**: серверне ядро майже готове, контракт і
UI — ні, а MCP-стаб свідомо чекає саме на цей маршрут.

**Уже є (домонтувати, малий diff):**

- **`RepoIntel.getBlastRadius(repoId, changedFiles)` реалізований** —
  `server/src/modules/repo-intel/service.ts:220-391`, у фасаді
  `types.ts:147`. Два шляхи:
  - `tryPersistentBlast` (`service.ts:315-391`) читає
    `symbols`/`references(resolved)`/`file_rank`/`file_facts` прямо з
    Postgres, без парсингу клону. Символи у змінених файлах; викликачі з
    виключенням файла оголошення, сортуванням за `rank` DESC — там **уже
    зроблені**.
  - ripgrep/degraded fallback (`service.ts:220-304`) — коли
    `REPO_INTEL_ENABLED` вимкнено або індексу немає: `rank: 0`,
    `degraded: true, reason: 'no_data'`.
- **Зворотний індекс для обходу графа готовий**: `file_edges` має
  `file_edges_repo_to_idx` на `(repoId, toFile)`, і доккоментар схеми прямо
  каже, що це «what blast uses to walk "who depends on this file?" in
  O(degree)» (`server/src/db/schema/repo-intel.ts:50-68`). Ніхто досі цим не
  скористався.
- **`BFS_DEPTH = 2`** уже є константою (`repo-intel/constants.ts:49`) —
  рівно два рівні з вимоги «зворотний граф імпортів, 2 рівні».
- **`getFileFacts(repoId, files)`** (`repo-intel/repository.ts:536-551`) уже
  віддає `endpoints` + `crons` для довільного списку файлів.
- **`messages/en/blast.json` уже містить словник саме під ці мокапи** —
  `stat.{symbols,callers,endpoints,crons}`, `view.{tree,graph}`,
  `callerCount`, `noDownstream`, `graph.{empty,ariaLabel}`. Файл написано
  наперед; UI під нього не існує (`grep blast client/src` → 0 збігів поза
  `vendor/`).
- **MCP-стаб чекає саме цього**: `McpService.getBlastRadius`
  (`mcp-server/src/service/index.ts:255-270`) повертає
  `{status:'not_implemented'}` без жодного HTTP-виклику, а
  `mcp-server/docs/architecture.md:102-111` документує це як тимчасовий
  контракт, який «gains an actual `DevDigestApiPort` call» щойно модуль
  з'явиться, з незмінною формою входу `{repo, pr?, file?}`.

**Чого немає (нова логіка):**

- **2-рівневий зворотний обхід графа імпортів не написаний.**
  `impactedEndpoints`/`factsByFile` у `tryPersistentBlast`
  (`service.ts:375-383`) рахуються ТІЛЬКИ з файлів прямих symbol-callers
  (1 хоп: файл, що напряму викликає змінений символ, дивиться у власні
  `file_facts`). Потрібен файловий обхід «хто залежить від цього файла» на
  два рівні, незалежно від наявності прямого symbol-виклику. `getEdges()`
  (`repository.ts:434-439`) тягне **весь** граф репозиторію — для цього
  непридатний, потрібен таргетований запит по `to_file`.
- **Cron/scheduled-джоби ніде не агрегуються нагору.** `factsByFile[…].crons`
  є (`types.ts:84`), але верхньорівневого `impactedCrons` немає — а мокапи
  вимагають окремий лічильник `🕐 1 cron` і окремі помаранчеві бейджі.
- **Per-symbol cap на викликачах насправді глобальний.**
  `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` (`service.ts:386`) обрізає
  **весь** масив до 20 попри доккоментар константи «Caller fan-out cap **per
  changed symbol**» (`constants.ts:29-30`). PR, що чіпає 10 символів, покаже
  викликачів фактично лише для найвищерангованих. Потрібно 20 **на символ**.
  У degraded-шляху cap не застосовується взагалі. Споживачів
  `getBlastRadius` сьогодні **нуль** (grep по `server/src`,
  `reviewer-core/src`, `client/src`) → семантику можна виправляти вільно.
- **Фасад не розрізняє `full` і `partial`.** `tryPersistentBlast` приймає
  обидва статуси індексу (`service.ts:320`) і в обох випадках повертає
  `degraded: false`. Щоб коректно позначати `partial`/`degraded`, маршрут
  мусить **додатково** викликати `getIndexState(repoId)`.
- **Немає response-контракту, маршруту, UI і MCP-виклику.**

## 3. Архітектурні рішення (вже прийняті — не переобговорюємо)

1. **Розміщення UI:** `BlastRadiusCard` **усередині наявного**
   `OverviewTab.tsx`, поруч з `IntentCard`. Нового табу на сторінці PR не
   додаємо (сторінка лишається Overview / Agent runs / Files changed).
   *(рішення користувача)*
2. **Response-контракт — новий і дедикований**, не перевикористовуємо
   `BlastRadius` з `contracts/brief.ts:31-59`. *(рішення користувача)*
   Обґрунтування: старий контракт має обов'язкове `summary: string`
   (LLM-поле), не має `status`/`degraded`/`reason`, і сьогодні ніде не
   наповнюється — `PrBrief` (`brief.ts:131-137`) не populated жодним модулем
   (`grep PrBrief server/src/modules` → 0).
3. **Новий контракт живе в новому файлі** `contracts/blast.ts`, а не
   розширює `brief.ts` — це буквальна конвенція барелю: «The barrel is
   stable — feature agents EXTEND with new files, they do not edit existing
   ones» (`server/src/vendor/shared/index.ts:14`). Зміна спершу в
   `server/src/vendor/shared/`, потім дзеркально в
   `client/src/vendor/shared/` (обидві копії `brief.ts` сьогодні
   байт-у-байт однакові — перевірено `diff`).
   **Наслідок для іменування:** обидва файли реекспортяться `export *` з
   одного барелю, тож імена `BlastRadius`/`BlastCaller`/`ChangedSymbol`
   **зайняті** — колізія буде помилкою компіляції. Нові імена:
   `PrBlastRadius` / `PrBlastSymbol` / `PrBlastCaller`.
4. **Маршрут живе в `reviews/`, окремого модуля `blast/` не створюємо.**
   Реальна розвилка, аргументи обох сторін:
   - *За окремий модуль:* `server/README.md:10` і
     `server/src/modules/index.ts:23` буквально перелічують «blast» серед
     майбутніх модулів уроків; зворотний обхід графа — репозиторна, а не
     рев'ю-логіка.
   - *За `reviews/` (обрано):* прямий прецедент — обидва інші «PrBrief
     building block»-маршрути, `/pulls/:id/intent` (`reviews/routes.ts:166`)
     і `/pulls/:id/smart-diff` (`routes.ts:148`), живуть саме там і
     звертаються до `container.repoIntel` без власного repository-шару.
     Маршрут не має **власних таблиць** — він читає `pr_files` через
     `ReviewRepository.getPrFiles` (`reviews/repository.ts:49-51`, той самий
     виклик, що в `getSmartDiff` `service.ts:245` і в intent `service.ts:218`)
     і решту через фасад. Новий модуль за `backend-onion-architecture` мусив
     би стартувати з трьох файлів, де `repository.ts` був би порожньою
     обгорткою над чужими таблицями — гірше, ніж один метод у наявному
     сервісі.
   - **Категорично не в `pulls/routes.ts`:** `pulls` — один із чотирьох
     модулів-боргів без `service.ts`/`repository.ts`
     (`backend-onion-architecture`: «Before adding new logic to one of these
     four, extract a service + repository first»).
5. **Уся робота з `file_edges` лишається в `repo-intel`.** Onion:
   `repo-intel/repository.ts` — єдине місце, де можна будувати drizzle-запити
   до цих таблиць. `reviews/` бачить лише фасад.
6. **Без міграцій і без кешу.** Усі потрібні таблиці існують; рахуємо на
   льоту на кожен запит, як SmartDiff (`routes.ts:145-147`: «Recomputed fresh
   on every call — no caching table, no rate limit»).
7. **`file:line` відкривається у VCS, не скролиться в diff.** Механізм уже є:
   `vcsBlobUrl()` (`client/src/lib/vcs-urls.ts`) + `MonoLink href=`, рівно як
   у `FindingCard.tsx:50-53`. Внутрішньосторінковий `target`/`targetNonce`
   патерн (`FindingsTab.tsx:59-62`, `SmartDiffViewer.tsx:60-85`) тут **не
   підходить**: файли-викликачі здебільшого не входять у diff PR, отже в
   `DiffViewer` їх просто немає.

## 4. Поза скоупом

- Композиція `PrBrief` і наповнення старого `BlastRadius` з `brief.ts` —
  не чіпаємо, не видаляємо, не populated (як і зафіксовано в
  `docs/plans/intent-layer.md:120-121` щодо SmartDiff).
- Будь-яке LLM-резюме blast-радіуса (модель для цієї фічі не потрібна).
- Зміни індексатора: `file_edges`/`file_facts`/`file_rank` пишуться як є;
  нових полів у пайплайні не додаємо.
- Нова таблиця/кеш/міграція.
- e2e-флоу (`e2e/` — гермет., окремий пакет; додати можна пізніше).
- Серверний query-параметр `?file=` (MCP звужує на своєму боці — Крок 5).
- Локалізації, крім `en` (єдина локаль, `client/src/i18n/request.ts:15`).

## 5. Джерела даних (усе вже персистується)

| Дані | Звідки | Файл:рядок |
|---|---|---|
| Змінені файли PR | `ReviewRepository.getPrFiles(prId)` | `reviews/repository.ts:49-51` |
| Символи у змінених файлах | `getSymbolRows` → `tryPersistentBlast` | `repo-intel/service.ts:326-341` |
| Резолвлені викликачі + rank | `getResolvedCallers` (join `file_rank`) | `repo-intel/repository.ts:504-530` |
| Зворотний граф імпортів | `file_edges` + `file_edges_repo_to_idx` | `db/schema/repo-intel.ts:50-68` |
| Endpoints / crons на файл | `getFileFacts` | `repo-intel/repository.ts:536-551` |
| Статус індексу | `tryGetIndexState` / `getIndexState` | `repo-intel/repository.ts:207`, `types.ts:144` |

## 6. Кроки реалізації

Кроки 1 і 2 не залежать один від одного (фасад віддає власні TS-типи з
`repo-intel/types.ts`, а не Zod) → їх можна віддати двом паралельним
`implementer`-агентам. Крок 4 залежить лише від типів Кроку 1.

---

### Крок 1 — Контракт `@devdigest/shared` *(нова логіка, малий diff)*

- **Type:** cross-cutting (контракт)
- **Модуль:** `server/src/vendor/shared` + дзеркало в `client/` (pnpm)
- **Owned paths:**
  - new: `server/src/vendor/shared/contracts/blast.ts`,
    `client/src/vendor/shared/contracts/blast.ts`,
    `server/test/blast-contract.test.ts`
  - modified: `server/src/vendor/shared/index.ts` (+1 рядок export після
    `:19`), `client/src/vendor/shared/index.ts` (той самий +1 рядок)
- **Що змінюється:** новий Zod-контракт, близький до фасадної
  `BlastResult`-форми, але згрупований по символу (як вимагає Tree-мокап) і з
  явним станом:
  - `BlastStatus = enum(['full','partial','degraded'])`
  - `BlastReason = enum([...DegradedReason, 'truncated'])` — перші п'ять
    значень дзеркалять `repo-intel/types.ts:27-33`
    (`flag_off`/`index_failed`/`index_partial`/`repo_too_large`/`no_data`),
    `truncated` — нове (обрізали fan-out).
  - `PrBlastCaller` — `{ file, symbol, line, rank }`
  - `PrBlastSymbol` — `{ name, file, kind, callers[], endpoints[], crons[],
    callers_truncated }`
  - `PrBlastRadius` — `{ pr_id, repo_id, symbols[], impacted_endpoints[],
    impacted_crons[], counts: { symbols, callers, endpoints, crons },
    status, reason (nullish) }`
  - `counts` **не є похідним** від масивів (callers обрізані до 20 на символ,
    graph-режим ріже ще сильніше) — тому тримаємо його в контракті, а не
    рахуємо на клієнті.
  - `impacted_crons` — симетрична пара до `impacted_endpoints`, якої в
    фасаді сьогодні немає нагорі (див. §2).
  - Іменування — `Pr*`-префікс, інакше колізія з `brief.ts` у барелі (§3.3).
- **Skills:** `zod` (`schema-use-enums`, `type-export-schemas-and-types`),
  `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none
- **Tests:** новий `server/test/blast-contract.test.ts` — round-trip
  `PrBlastRadius.parse()` на full / partial / degraded фікстурах (прецедент:
  `server/test/contracts.test.ts:68-80`; **не редагувати** `contracts.test.ts`
  — він поза Owned paths). Плюс `cd client && pnpm typecheck` як доказ, що
  дзеркало не розійшлось.
- **Done:** обидві копії парсять однакову фікстуру; `pnpm typecheck` у
  `server/` і `client/` зелений.

---

### Крок 2 — repo-intel: зворотний 2-рівневий обхід + per-symbol cap *(нова логіка)*

- **Type:** backend
- **Модуль:** `server/` (pnpm)
- **Owned paths:**
  - modified: `server/src/modules/repo-intel/repository.ts`,
    `.../service.ts`, `.../types.ts`, `.../constants.ts`, `.../README.md`
  - new: `server/test/repo-intel-blast-downstream.test.ts`
- **Що змінюється:**
  1. **`RepoIntelRepository.getImporters(repoId, files)`** — новий метод:
     `SELECT from_file, to_file` з `file_edges` за `repo_id` + `to_file IN
     (...)`, LEFT JOIN `file_rank` на `from_file`, `ORDER BY rank DESC`.
     Використовує наявний `file_edges_repo_to_idx`. **Не** `getEdges()`
     (`repository.ts:434-439`) — той читає весь граф репозиторію.
  2. **`walkDownstreamFiles(repoId, changedFiles)`** — приватний метод
     сервісу: BFS рівно на `BFS_DEPTH = 2` рівні (`constants.ts:49`), seed =
     змінені файли; на кожному рівні `getImporters` → дедуп через глобальний
     `visited` (змінені файли виключені з результату) → сортування за `rank`
     DESC → обрізання до нової константи `MAX_REVERSE_FANOUT_PER_LEVEL`
     (пропозиція 200) з підняттям прапорця `truncated`. Патерн роботи з
     `file_edges` + `getRankedPaths` брати з `getCriticalPaths`
     (`service.ts:659-702`) як **приклад стилю**, логіку не копіювати —
     там форвардний greedy top-1 для іншого use case.
  3. **Агрегація фактів:** `getFileFacts(repoId, [...усі файли обох рівнів])`
     → об'єднати `endpoints` І `crons`. `impactedEndpoints` тепер = 1-хопові
     caller-файли ∪ 2-рівневий reverse-import (сьогодні лише перше,
     `service.ts:375-383`).
  4. **`BlastResult` (`types.ts:74-87`)** розширити:
     `downstreamFiles: { file, depth, rank }[]`, `impactedCrons: string[]`,
     `truncated?: boolean`. Поля опційні/масиви → існуючі споживачі не ламає
     (їх нуль).
  5. **Виправити per-symbol cap:** замість глобального
     `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` (`service.ts:386`) —
     групувати за `viaSymbol` і різати 20 у кожній групі; той самий cap
     застосувати і в degraded-шляху (`service.ts:284-300`), де його зараз
     немає взагалі.
  6. **Degraded-шлях чесний:** `file_edges` там порожні → `downstreamFiles:
     []`, `impactedCrons: []`, `degraded: true, reason: 'no_data'`. Порожній
     масив не видається за «нічого не зачеплено» — прапорець несе правду
     (`types.ts:16-20`, DEGRADED CONTRACT).
  7. `README.md` рядок 41 (`getBlastRadius(...) → impacted symbols / callers`)
     дописати про downstream-обхід.
- **Обережно** (`server/INSIGHTS.md:388-395`): repo-intel-запити
  використовують явні `.select({...})` — нові колонки треба додавати і туди,
  компілятор про це не попередить.
- **Skills:** `backend-onion-architecture` (нічого з `file_edges` не витікає
  за межі `repo-intel/repository.ts`), `drizzle-orm-patterns`,
  `postgresql-table-design` (обхід має лягати на `(repo_id, to_file)`),
  `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none (паралельно з Кроком 1)
- **Tests:** новий герметичний `repo-intel-blast-downstream.test.ts` зі
  стабом репозиторію (прецедент: `test/repo-intel-facade-degraded.test.ts`):
  два рівні обходу і зупинка на третьому; виключення змінених файлів із
  результату; обрізання fan-out виставляє `truncated`; 20 викликачів **на
  кожен** символ, а не сумарно. Наявний
  `repo-intel-facade-degraded.test.ts:54-64` має лишитись зеленим.
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`.
- **Done:** для зміненого файла, від якого залежить файл-роутер через один
  проміжний модуль, `getBlastRadius` повертає його endpoints, навіть коли
  прямого symbol-виклику немає.

---

### Крок 3 — `GET /pulls/:id/blast` *(домонтувати + мапер)*

- **Type:** backend
- **Модуль:** `server/` (pnpm)
- **Owned paths:**
  - new: `server/src/modules/reviews/blast.ts`,
    `server/test/reviews-blast-routes.it.test.ts`
  - modified: `server/src/modules/reviews/routes.ts`,
    `server/src/modules/reviews/service.ts`
- **Що змінюється:**
  1. **Маршрут** поруч зі SmartDiff (`routes.ts:146-153`):
     `schema: { params: IdParams, response: { 200: PrBlastRadius } }`,
     `getContext(container, req)` для tenancy, **без** per-route
     `rateLimit` (нема LLM-виклику — та сама аргументація, що в коментарі до
     smart-diff). Дописати рядок у doc-блок маршрутів `routes.ts:11-19`.
     Роут не містить логіки — лише виклик сервісу.
  2. **`ReviewService.getBlastRadius(workspaceId, prId)`**: `getPull(workspaceId,
     prId)` → 404 `NotFoundError` → `getPrFiles(prId)`. Це рівно той шлях,
     яким уже ходять `getSmartDiff` (`service.ts:242-245`) і intent
     (`service.ts:218`) — нового способу дістати changed files **не пишемо**.
     Далі паралельно: `container.repoIntel.getBlastRadius(pull.repoId,
     paths)` і `container.repoIntel.getIndexState(pull.repoId)`.
  3. **Чистий мапер `blast.ts`** (без I/O, без `fastify`/`db` —
     прецедент і формулювання доккоментаря брати зі `smart-diff.ts:1-19`):
     `BlastResult` + `IndexState` → `PrBlastRadius`. Групує `callers` за
     `viaSymbol` у `symbols[]`, приліплює до кожного символу його
     `endpoints`/`crons` з `factsByFile`, рахує `counts`, обчислює `status`:
     - `degraded` ← `BlastResult.degraded === true`, `reason` з фасаду;
     - `partial` ← `IndexState.status === 'partial'` **або** `truncated`
       **або** будь-який `callers_truncated` → `reason` `index_partial` /
       `truncated`;
     - `full` ← інакше.
     Другий виклик (`getIndexState`) обов'язковий саме тому, що
     `tryPersistentBlast` приймає і `full`, і `partial` (`service.ts:320`) і
     повертає `degraded: false` в обох випадках.
- **Skills:** `backend-onion-architecture` (routes → service → фасад; жодного
  `container.db` у роуті), `fastify-best-practices`, `zod`,
  `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Крок 1 (контракт), Крок 2 (`downstreamFiles`/`impactedCrons`)
- **Tests:**
  - герметичний юніт на мапер (`blast.ts`) — три гілки `status` + групування
    по символу, у стилі `server/test/smart-diff.test.ts`;
  - `reviews-blast-routes.it.test.ts` (testcontainers, прецедент і шапка —
    `test/reviews-smart-diff-routes.it.test.ts:1-40`): 200 для PR із
    змінами, 404 для чужого/неіснуючого PR, `status:'degraded'` при
    невідіндексованому репо.
- **Done:** `curl localhost:3001/pulls/<id>/blast` віддає валідний
  `PrBlastRadius`, а на неіндексованому репо — `status:'degraded'` з
  `reason`, а не порожні масиви без пояснення.

---

### Крок 4 — Клієнт: `BlastRadiusCard` у Overview *(нова логіка, найбільший крок)*

- **Type:** ui
- **Модуль:** `client/` (pnpm)
- **Owned paths:**
  - new: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/`
    — `BlastRadiusCard.tsx`, `BlastRadiusCard.test.tsx`, `constants.ts`,
    `helpers.ts`, `styles.ts`, `index.ts`, а також
    `_components/BlastRadiusTree/**` і `_components/BlastRadiusGraph/**`
    (та сама структура рекурсивно — `frontend-architecture`, «Component
    Decomposition», прецедент `IntentCard/`)
  - modified: `client/src/lib/hooks/reviews.ts`,
    `client/messages/en/blast.json`,
    `.../_components/OverviewTab/{OverviewTab.tsx,styles.ts}`,
    `.../_components/PrDetailView/PrDetailView.tsx`
- **Skills:** `frontend-architecture`, `next-best-practices`,
  `react-best-practices`, `react-testing-library`, `security`,
  `typescript-expert`, `engineering-insights`
- **Depends on:** Крок 1 (типи). Паралельно-безпечний із Кроками 2-3 — тести
  мокають хук (`vi.mock("@/lib/hooks/reviews")`, прецедент
  `IntentCard.test.tsx:9-18`).

**4a. Хук.** `useBlastRadius(prId)` у `lib/hooks/reviews.ts` поруч із
`useSmartDiff` (`:128-136`): `queryKey: ["blast", prId]`,
`api.get<PrBlastRadius>('/pulls/${prId}/blast')`, `enabled: !!prId`. Барель
`lib/hooks/index.ts` уже реекспортує `./reviews` — правити не треба.
Компоненти `fetch` не викликають ніколи.

**4b. Прокидання VCS-контексту.** `PrDetailView.tsx:149` сьогодні передає
в `OverviewTab` лише `prId`/`prBody`, тоді як `FindingsTab`/`DiffTab` уже
отримують `repoFullName`/`repoProvider`/`repoHost`/`headSha`
(`:160-163`, значення обчислені на `:89-91`). Прокинути ті самі чотири
пропси в `OverviewTab` → далі в `BlastRadiusCard` (потрібні для `vcsBlobUrl`).

**4c. Оболонка `BlastRadiusCard`.** `SectionLabel` + summary-шапка зі
статистикою `<> N symbols · ↳ N callers · 🌐 N endpoints · 🕐 N crons` з
`counts` (іконки `Code`, `CornerDownRight`, `Globe`, `Clock` — усі вже є в
`vendor/ui/icons.tsx`). Стани через early-return: loading (`Skeleton`),
error (`ErrorState`), empty (`EmptyState` + `blast.noDownstream`),
**degraded/partial** (`Badge` + текстове пояснення з `reason` — порожній
масив без пояснення заборонений).

**4d. Перемикач Tree | Graph.** Сегментований контрол у **правому верхньому
куті картки** — у слот `SectionLabel right=`, тобто рівно там, де
`IntentCard` тримає Refresh (`IntentCard.tsx:41-53`). Реалізувати локально
в `BlastRadiusCard` (дві `Button kind="ghost"` з активним станом);
`vendor/ui/kit/Tabs.tsx` **не підходить** — це повноширинні таби з
`borderBottom`, а не сегмент у куті, і `vendor/ui` правити не можна
(AGENTS.md «Do not touch»). Режим — локальний `useState<'tree'|'graph'>` з
дефолтом `'tree'`; **окремого запиту режим не робить** (обидва види
рендеряться з однієї відповіді — `react-best-practices`, «Derive, Don't
Store»).

**4e. `BlastRadiusTree` (дефолт).** Вкладений розгортний список: на кожен
змінений символ — рядок-заголовок (іконка символу, `rateLimit()`, «N
callers» праворуч, шеврон `ChevronRight`/`ChevronDown`), який незалежно
розгортається у:
- список викликачів `↳ file/path.ts:42` — `MonoLink href={vcsBlobUrl(...)}`,
  той самий механізм, що `FindingCard.tsx:50-53`;
- під ними ряд бейджів: сині `🌐 GET /api/public/items` (endpoints,
  `Globe`), помаранчеві `🕐 reset-rate-buckets (hourly)` (crons, `Clock`).

Стан розгортання — `Set<string>` імен символів у локальному стані картки
(кілька символів можуть бути розгорнуті одночасно; другий символ у мокапі
згорнутий). Кольори — токени з `vendor/ui/primitives/tokens.ts`, не літерали.

**4f. `BlastRadiusGraph` — ручний inline-SVG, без graph-бібліотеки.**
Три колонки: змінені символи ліворуч (вузли з accent-обвідкою) → викликачі в
центрі (без обвідки) → ендпоінти праворуч (accent-обвідка); ребра —
polyline/квадратичні криві; легенда під SVG («● changed symbol · ● callers ·
● endpoints affected»); підпис «hierarchical node-link» угорі праворуч;
`role="img"` + `aria-label` з `blast.graph.ariaLabel`; порожній стан —
`blast.graph.empty`.
- *Чому вручну:* граф строго 3-рівневий і обрізаний (пропозиція: топ-8
  викликачів, топ-6 ендпоінтів у graph-режимі, за `rank`), тож загальної
  задачі layout немає — `x` = номер колонки, `y` = рівномірний розподіл.
  Прямий внутрішній прецедент: `vendor/ui/charts/Sparkline.tsx:1` —
  «lightweight inline-SVG …; no Recharts; trivial + perf». Жодної
  graph-бібліотеки в `client/package.json` немає (нема d3/reactflow/dagre/elk).
- *Розглянуто й відхилено:* перевикористати
  `client/src/components/mermaid-diagram/MermaidDiagram.tsx` (`graph LR` +
  `classDef`). Компонент існує, має **нуль споживачів**, `mermaid` уже в
  залежностях (`package.json:15`) і вантажиться лениво. Відхилено, бо:
  1. `mermaid.initialize({ theme: "dark" })` захардкоджено
     (`MermaidDiagram.tsx:37`) — діаграма не піде за темою застосунку;
  2. рендер через `ref.current.innerHTML = svg` (`:47`) з мітками,
     зібраними зі шляхів файлів і імен символів **чужого** репозиторію —
     `securityLevel: "strict"` це пом'якшує, але не робить довільний текст
     безпечним для розмітки mermaid (`security`, A05);
  3. вузли не можна зробити нашими клікабельними `MonoLink`;
  4. лінивий динамічний import погано тестується в jsdom.

  Це єдине рішення в плані, яке варте явного підтвердження користувача —
  див. §8.

**4g. i18n.** `messages/en/blast.json` **уже** містить
`stat.{symbols,callers,endpoints,crons}`, `view.{tree,graph}`,
`callerCount`, `noDownstream`, `graph.{empty,ariaLabel}` — словник цих
мокапів написано наперед. Додати лише те, чого бракує: пояснення
degraded/partial, підпис легенди, «hierarchical node-link». Заголовок
картки брати з наявного `brief.block.blast` (`messages/en/brief.json:4`) —
симетрично до `IntentCard`, який робить `t("block.intent")`. Інлайн-літералів
не лишати.

- **Tests:** `BlastRadiusCard.test.tsx` (2-3 тести на повні флоу, не по
  одному asserta):
  1. дані завантажились → видно статистику й символи → клік по шеврону
     розгортає викликачів → `file:line` є посиланням із правильним `href` →
     клік по «Graph» показує діаграму (`getByRole('img')`) і ховає дерево;
  2. `status: 'degraded'` → видно пояснення, а не порожній список;
  3. empty → `blast.noDownstream`.
  `cd client && pnpm test && pnpm typecheck`.
- **Done:** на сторінці PR у табі Overview під Intent видно панель Blast
  radius; перемикач Tree|Graph працює без нового запиту; клік по `file:line`
  відкриває потрібний рядок у GitHub/GitLab.

---

### Крок 5 — `devdigest-mcp`: замінити стаб на реальний виклик *(домонтувати)*

- **Type:** cross-cutting
- **Модуль:** `mcp-server/` (**npm**, не pnpm)
- **Owned paths:** `mcp-server/src/http/{types.ts,client.ts}`,
  `mcp-server/src/service/{index.ts,results.ts,index.test.ts}`,
  `mcp-server/src/tools/{get-blast-radius.ts,get-blast-radius.test.ts}`,
  `mcp-server/docs/architecture.md`, `mcp-server/README.md`
- **Що змінюється:**
  1. `DevDigestApiPort.getBlastRadius(pullId): Promise<PrBlastRadius>`
     (`src/http/types.ts:35-57`) + реалізація в `DevDigestApiClient` з
     `safeParse` через новий Zod-контракт — прямо задокументований патерн
     цього класу (`src/http/client.ts:20-24`). `@devdigest/shared` резолвиться
     в `mcp-server` через tsconfig-alias на `../server/src/vendor/shared`
     (`tsconfig.json:22`), тож новий контракт доступний автоматично.
  2. `McpService.getBlastRadius(repo, pr?, file?)`: `resolveRepo` →
     `resolvePull` (`src/service/resolve.ts`) → `client.getBlastRadius(pull.id)`.
     **Форма входу тула не змінюється** (`docs/architecture.md:102-111`).
  3. `pr` не передано → типізований `fail(...)` з next-step-повідомленням
     («pass pr=<number>…»), а не `not_implemented` — вимога стилю
     повідомлень пакета (`architecture.md`, «error-leads-forward»). `file` →
     чистий фільтр по `symbols[].file` на боці MCP (сервер уже все
     порахував; серверного `?file=` не додаємо).
  4. `GetBlastRadiusData` (`src/service/results.ts:200-203`) з
     `{status:'not_implemented', message}` → реальна форма; гілку
     `not_implemented` прибрати; оновити `description` тула
     (`src/tools/get-blast-radius.ts:22-23`, зараз каже «Currently returns a
     provisional not-implemented contract»).
  5. `docs/architecture.md` §«Provisional `get_blast_radius` contract» —
     переписати; він сам описує цю заміну як заплановану.
- **Skills:** `typescript-expert`, `zod` (`parse-use-safeparse`,
  `parse-never-trust-json`), `security`, `engineering-insights`
- **Depends on:** Крок 1 (контракт), Крок 3 (маршрут)
- **Tests:** переписати `src/service/index.test.ts:231+` і
  `src/tools/get-blast-radius.test.ts` з «not_implemented» на реальну
  поведінку: успіх, відсутній `pr` → типізована невдача з підказкою,
  недоступний API → `guardApiCall`-невдача, `file` звужує результат.
  `cd mcp-server && npm test && npm run typecheck`.
- **Done:** `get_blast_radius` з MCP-клієнта повертає справжні дані для
  `repo=owner/name pr=123`.

## 7. Наскрізні питання

- **Порядок:** контракт (Крок 1) → споживачі. Крок 2 незалежний і йде
  паралельно з 1; 3 після 1+2; 4 після 1; 5 після 1+3.
- **Міграцій немає** — усі таблиці (`symbols`, `references`, `file_edges`,
  `file_facts`, `file_rank`, `repo_index_state`) вже існують і заповнюються
  індексатором.
- **Feature-flag не додаємо.** Фактичним рантайм-перемикачем є
  `REPO_INTEL_ENABLED` (`service.ts:222`): вимкнений → `status:'degraded'`
  замість помилки. UI мусить це показувати, а не ховати.
- **Пакетні менеджери:** `server/`+`client/` — pnpm, `mcp-server/` — npm.
  Ніколи не змішувати в межах пакета.
- **Не чіпати:** `server/clones/**`, `**/node_modules/**`, лок-файли;
  `**/src/vendor/**` — виняток лише `vendor/shared` у Кроці 1 як свідома
  зміна контракту.

## 8. Ризики та відкриті питання

- **Graph: ручний SVG vs `MermaidDiagram`.** Рекомендація — ручний SVG
  (аргументи в 4f). Це єдине рішення в плані, яке варте явного «ок» від
  користувача, бо `MermaidDiagram` існує саме як спільний примітив і має
  нуль споживачів — можливо, його й планували під цей кейс.
- **Чи індексатор реально наповнює `file_facts.crons`** — **не перевірено**
  (потребує запуску індексації на реальному репо). Якщо колонка практично
  завжди порожня, лічильник `🕐 N cron` показуватиме 0 і панель виглядатиме
  недобудованою. Перевірити перед Кроком 4 запитом до `file_facts` на
  dev-базі; якщо порожньо — це вже питання до індексатора, а не до цього
  плану.
- **`MAX_REVERSE_FANOUT_PER_LEVEL = 200` — евристика без вимірювань.**
  Для «популярного» файла (`types.ts`, `index.ts`) 2-й рівень може дати
  сотні файлів. Треба заміряти на реальному імпортованому репо і скоригувати;
  доти `truncated`-прапорець чесно позначає обрізання.
- **Graph-режим при кількох змінених символах.** Мокап показує один символ
  ліворуч, а стат-бар — `2 symbols`. У плані прийнято «усі символи в лівій
  колонці, з обрізанням». Альтернатива — селектор символу над графом.
  Потребує підтвердження користувача.
- **`counts.callers` — до чи після обрізання.** Прийнято «до» (реальна
  кількість), щоб «14 callers» у шапці не суперечило показаним 20-макс на
  символ. Якщо треба інакше — це одна зміна в мапері Кроку 3.
- **Зовнішнього дослідження не потрібно** — усе, на чому стоїть план,
  внутрішнє. Для `researcher` завдань немає.

## 9. Рекомендований шлях рев'ю (тут не виконувався)

- Перед PR — скіл `pr-self-review` (AGENTS.md); він сам змапить diff на
  `backend-onion-architecture` / `frontend-architecture` / `zod`.
- Окремий security-погляд потрібен лише якщо Кроки 4f/5 підуть шляхом
  mermaid/`innerHTML` або якщо на маршруті з'явиться query-параметр із
  користувацьким шляхом.
- Архітектурний sign-off варто взяти на рішення §3.4 (`reviews/` замість
  окремого модуля `blast/`) — воно суперечить буквальному тексту
  `server/README.md:10`.

## 10. Ключові файли (абсолютні шляхи)

- `server/src/modules/repo-intel/service.ts`
- `server/src/modules/repo-intel/repository.ts`
- `server/src/modules/repo-intel/types.ts`
- `server/src/modules/repo-intel/constants.ts`
- `server/src/db/schema/repo-intel.ts`
- `server/src/modules/reviews/routes.ts`
- `server/src/modules/reviews/service.ts`
- `server/src/modules/reviews/smart-diff.ts`
- `server/src/vendor/shared/contracts/brief.ts`
- `server/src/vendor/shared/index.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`
- `client/src/lib/hooks/reviews.ts`
- `client/src/lib/vcs-urls.ts`
- `client/src/components/mermaid-diagram/MermaidDiagram.tsx`
- `client/messages/en/blast.json`
- `mcp-server/src/service/index.ts`
- `mcp-server/src/service/results.ts`
- `mcp-server/docs/architecture.md`
