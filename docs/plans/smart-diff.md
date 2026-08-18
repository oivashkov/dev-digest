# SmartDiff — план реалізації

> Затверджено користувачем 2026-08-19 (гілка `lab03-smartdiff`).
> Реалізація йде в auto mode: кроки 1-5 нижче виконуються послідовно/
> паралельно (де Owned paths дозволяють) без паузи на підтвердження після
> кожного кроку.

## Контекст

Рев'ю великого PR зараз показує змінені файли в **оригінальному порядку GitHub**
— lockfile'и, згенерований код і мануали перемішані з бізнес-логікою. Рецензент
змушений сам відсіювати шум. SmartDiff сортує файли за **ризиком для рев'ю**:
`core` (бізнес-логіка) → `wiring` (точки входу/конфіг) → `boilerplate`
(lockfile'и, генерований код, i18n), щоб змістовне було вгорі, а шум —
згорнутим унизу. Класифікація **детермінована, по шляху/імені файлу, без жодного
LLM-виклику** і працює ще до першого рев'ю (одразу після імпорту PR). Коли рев'ю
вже пройшло — на файли додаються бейджі "N findings", підсвітка рядків і
авторозгортання будь-якого файлу зі знахідками (навіть boilerplate — знахідки
ніколи не ховаються).

**Ключове відкриття під час дослідження (file:line-докази нижче):** на відміну
від Intent Layer, який був на 80% заскафолджений і на 0% підключений, SmartDiff
має **готовий і вже експортований Zod-контракт**, але **жодного рядка** сервера,
роута чи UI, що його наповнює. Що вже є:

- `SmartDiff` контракт повністю визначений в **обох** копіях
  (`server/src/vendor/shared/contracts/brief.ts:95-128` **і**
  `client/src/vendor/shared/contracts/brief.ts:96-128` — байт-в-байт однакові,
  перевірено) і експортований з `@devdigest/shared` в обох
  (`server/.../index.ts:19`, `client/.../index.ts:19`). Форма:
  `{ groups: [{ role: 'core'|'wiring'|'boilerplate', files: [{ path,
  pseudocode_summary?, additions, deletions, finding_lines }] }],
  split_suggestion: { too_big, total_lines, proposed_splits: [{ name, files }] } }`.
  **Контракт не чіпаємо — лише вирішуємо, як його наповнити.**
- Джерело файлів вже персистується: `prFiles` (`path`, `additions`,
  `deletions`, `patch`) читається через `reviewRepo.getPrFiles(prId)`
  (`repository.ts:49-51`, `repository/pull.repo.ts:29-34`) — той самий метод,
  яким intent-фіча будує diff-stat fallback (`intent.ts:227-238`). Ніякого
  нового live-виклику VCS не треба.
- Джерело findings вже персистується: `reviewRepo.reviewsForPull(prId)`
  повертає рев'ю **newest-first**, кожне зі своїми findings
  (`repository.ts:73-76`, docstring "newest first"). `Finding` має `file`,
  `start_line`, `end_line`, `severity` (`findings.ts:47-63`).
- `SmartDiff` **НЕ входить** у `PrBrief` (`brief.ts:131-137` — лише
  `intent`/`blast`/`risks`/`history`), і в `server/src/db` немає жодної
  `smart_diff`-таблиці/колонки (є лише `pr_intent` і `pr_brief`,
  `schema/reviews.ts:74-98`). Це підтверджує гіпотезу "рахувати на льоту, без
  міграції" (рішення 3 нижче).
- Клієнт: таб "Files changed" (`DiffTab.tsx:43-64`) сьогодні **завжди**
  рендерить `<DiffViewer files={pr.files} />` в оригінальному порядку.
  `DiffViewer` (`DiffViewer/DiffViewer.tsx:14-32`) — це плоский список
  колапсибельних `FileCard` (`FileCard/FileCard.tsx:33-96`), де кожен `FileCard`
  сам вирішує open/closed за `AUTO_EXPAND_MAX_LINES = 200` (`constants.ts:4`,
  `FileCard.tsx:35-37`) і парсить `patch` через `parsePatch` (`helpers.ts`).
  Барель `diff-viewer/index.ts:3-4` експортує лише `DiffViewer` +
  `DiffCommentApi` — `FileCard`/`CodeLine`/`parsePatch` внутрішні.
- Прецедент "клік по X → скрол+розгортання Y деінде в дереві" вже є —
  `target`/`targetNonce` патерн у `FindingsTab.tsx:59-62` (`setTarget((p) =>
  ({ runId, n: (p?.n ?? 0) + 1 }))`, nonce перезапускає скрол при повторному
  кліку). Scroll-to-finding-line в SmartDiff має йти цим шляхом, не винаходити.
- Прецедент чистої детермінованої класифікації, похідної з даних PR, вже живе
  **в модулі reviews на сервері, а не в reviewer-core**: `tierFor()`
  (`intent.ts:102-107`) — чиста функція без I/O; і `isAllowedPlanRefShape()`
  (`intent.ts:138-143`) — маленький regex-allowlist по формі шляху. SmartDiff-
  класифікатор — прямий аналог обох.

Тобто це не "домонтувати каркас", а **написати наповнювач для вже узгодженого
контракту** + UI поверх наявного `diff-viewer`. Зовнішнє дослідження через
`researcher` не потрібне — весь прецедент (чиста функція + regex-allowlist +
target/nonce скрол + reuse `FileCard`) внутрішній і прямо застосовний.

## Архітектурні рішення (уже прийняті користувачем, не переобговорюємо)

1. **Евристика класифікації — ТІЛЬКИ по імені/шляху файлу, без урахування
   розміру чи вмісту diff.** Файл із "wiring"-іменем лишається `wiring`, хоч би
   яким великим був його diff; ніякого size-override. Це найпростіший і
   найтестованіший варіант, явно обраний користувачем над size-guard-
   альтернативою (яку **відхилено**). Правила (стартовий набір, уточнюється в
   §2 своїм дослідженням, але **не** послаблюється до size-евристики):
   - **`boilerplate`:** lockfile'и (`package-lock.json`, `pnpm-lock.yaml`,
     `yarn.lock`, `Cargo.lock`, `go.sum`, `poetry.lock`, `Gemfile.lock`,
     `composer.lock`), маніфести залежностей (`package.json`, `pyproject.toml`,
     `Cargo.toml`, `go.mod`, `requirements.txt`), генеровані/vendor/build-шляхи
     (`/generated/`, `/vendor/`, `/dist/`, `/build/`, `/.next/`,
     `__generated__`), snapshot/fixture (`*.snap`, `/__snapshots__/`,
     `/fixtures/`, `/testdata/`), мініфіковані/бандловані ассети (`*.min.js`,
     `*.min.css`), авто-міграції БД (`/migrations/*.sql`, `/db/migrations/**`
     — узгоджено з власною конвенцією репо "ніколи не писати міграцію руками",
     `server/AGENTS.md`), i18n-каталоги (`/locales/**`, `/messages/**/*.json`,
     `/i18n/**`).
   - **`wiring`:** по імені файлу, framework-agnostic (репо рев'юить довільні
     імпортовані репозиторії, не лише себе): `index.*`, `main.*`, `server.*`,
     `app.*`, `container.*`, `config.*`, `routes.*`, `router.*`, `*.module.ts`
     (Nest), `urls.py`/`wsgi.py`/`asgi.py` (Django).
   - **`core`:** усе інше — дефолтний/fallback-бакет.
   - Порядок оцінки: `boilerplate` → `wiring` → `core` (перший збіг виграє).
2. **Жодного нового LLM-виклику ніде в цій фічі.** Зокрема
   `pseudocode_summary` (`SmartDiffFile`, `brief.ts:101`) **не** генерується —
   grep підтвердив, що ніщо в репо його не наповнює; поле лишається
   `null`/пропущеним (воно `.nullish()`). Будь-яка майбутня per-file LLM-
   сумаризація — окрема фіча.
3. **Персистенції немає — рахуємо свіжо на кожен `GET /pulls/:id/smart-diff`,
   без нової таблиці, без міграції.** Класифікація — чиста детермінована
   функція над даними, що вже завантажені (`prFiles`) + вже персистованими
   findings. На відміну від Intent (де LLM-виклик кешується, бо має
   cost/latency, `intent.ts:244-279`), тут **нема чого амортизувати** — обчислення
   безкоштовне й миттєве. Додавати таблицю/колонку означало б міграцію заради
   кешу, який дешевше перерахувати. `SmartDiff` у `PrBrief` **не** додаємо —
   фіксуємо як знахідку, дзеркально до того, як intent-план сам зафіксував цю
   прогалину (`docs/plans/intent-layer.md:120-121`).
4. **Роут — у модулі `reviews`, не `pulls`.** SmartDiff потребує і файлів PR
   (`reviewRepo.getPrFiles`), і findings останнього рев'ю
   (`reviewRepo.reviewsForPull`) — обидва вже живуть у `ReviewRepository`
   (`repository.ts:49,73`). Точно та сама причина, чому `GET /pulls/:id/intent`
   та `GET /pulls/:id/reviews` лежать у `reviews/routes.ts:138-159`, а не в
   `pulls`. Onion-шар: **жодного `container.db` в `routes.ts`**
   (`backend-onion-architecture`, `server/AGENTS.md`) — роут кличе
   `service.getSmartDiff(...)`, сервіс кличе repository + чисту
   `buildSmartDiff`.
5. **UI — тумблер "Smart order / Original order" всередині наявного табу "Files
   changed" (`DiffTab`), не новий nav-таб.** Дефолт — Smart order (з graceful
   fallback на Original поки SmartDiff вантажиться / при помилці). `split_
   suggestion` в UI **не** рендериться (див. Поза скоупом).

## Поза скоупом (свідомо не робимо)

- **`pseudocode_summary`** (будь-яка майбутня per-file LLM-сумаризація) — поле
  лишається `null`/пропущеним.
- **Виправлення відсутності `SmartDiff` у `PrBrief`** (`brief.ts:131-137`) —
  лише фіксуємо як знахідку, не чіпаємо (дзеркально intent-плану).
- **Рендер `split_suggestion` в UI** — власна специфікація `SmartDiffViewer` від
  користувача згадує лише групи, згорнутий boilerplate, findings-бейдж і
  scroll-to-line; split suggestion в UI не згадана. Роут **все одно повертає**
  контракт-валідний `split_suggestion` (див. §3), але його візуалізація — майбутнє.
- **Будь-яка зміна prompt/engine у `reviewer-core`** — SmartDiff не торкається
  збірки промпту рев'ю (на відміну від Intent, який годував промпт). Це
  read/derive-фіча поверх уже персистованих даних. `reviewer-core` не змінюється
  жодним рядком.
- **Розумніша евристика (size-override, reclassification по diff)** — явно
  відхилена користувачем на користь чистого path-matching.
- **Blast Radius / Risks / PR History** — інші частини `PrBrief`, окремі лекції.

---

## 1. Джерела даних

| Сигнал | Де вже береться | Що нове |
|---|---|---|
| Змінені файли (`path`, `additions`, `deletions`) | `reviewRepo.getPrFiles(prId)` (`repository.ts:49-51`, `pull.repo.ts:29-34`) — персистований `prFiles` | передати список у `buildSmartDiff`; `path` → класифікатор, `additions/deletions` → per-file stat + `total_lines` |
| `patch` (текст diff) | той самий `prFiles.patch` / вже є на клієнті в `pr.files` (`PrDetailView` → `DiffTab files={pr.files}`) | **не** потрібен серверу (класифікація по шляху); на клієнті `SmartDiffViewer` бере `patch` з `pr.files` за `path` для рендеру рядків через наявний `parsePatch` |
| Findings останнього рев'ю (`file`, `start_line`, `end_line`) | `reviewRepo.reviewsForPull(prId)` — newest-first (`repository.ts:73-76`), `Finding` (`findings.ts:47-63`) | взяти **останнє** рев'ю (перший елемент), виключити dismissed (`dismissedAt != null`), згрупувати за `file` → `finding_lines` |
| Кількість findings на файл (для бейджа) | ті самі findings, вже фетчаться на клієнті через `usePrReviews` (`PrDetailView.tsx:47,80`) | клієнт рахує N на файл із наявних findings; сервер додатково віддає `finding_lines` для підсвітки/авторозгортання |

## 2. Класифікатор (чиста функція)

**Розташування — `server/src/modules/reviews/smart-diff.ts` (новий), НЕ
`reviewer-core`.** Обґрунтування проти purity-межі `reviewer-core`:
`reviewer-core/README.md:3-4` визначає його як "Pure review logic: diff → prompt
→ LLM → grounded findings. No database, GitHub, or filesystem; the only side
effect is an LLM call". SmartDiff-класифікація **не** частина цього конвеєра —
вона не годує промпт, не робить LLM-виклику і не продукує findings; це
presentation-concern (порядок файлів для UI рецензента). Класти її в
`reviewer-core` розширило б скоуп рушія за його ж декларовану межу. Прямий
прецедент — `tierFor()` (`intent.ts:102-107`): чиста детермінована класифікація,
похідна з даних PR, живе **саме в `reviews`-модулі сервера**, а не в
`reviewer-core`, попри те, що не має I/O. SmartDiff слідує тому самому вибору.

Файл містить дві чисті функції (жодного I/O, жодного імпорту `fastify`/`db`):

- `classifyFile(path: string): SmartDiffRole` — regex-allowlist по формі шляху,
  оцінка `boilerplate → wiring → core` (перший збіг виграє). Патерни за
  зразком `isAllowedPlanRefShape` (`intent.ts:138-143`): набір іменованих
  `RegExp`-констант + basename-anchoring для `index.*`/`config.*` тощо. Точний
  список — з §"Архітектурні рішення" 1; при реалізації розширити/уточнити,
  **не** послаблюючи до size-евристики.
- `buildSmartDiff(files, findings): SmartDiff` — приймає
  `{ path, additions, deletions }[]` + `{ file, start_line, end_line }[]`
  (структурні, не залежить від Drizzle-рядків, щоб тестуватись без БД):
  - групує файли за `classifyFile(path)` у три групи в порядку
    `core → wiring → boilerplate`; усередині групи зберігає оригінальний
    порядок PR (стабільно);
  - `finding_lines` на файл = відсортований унікальний набір `start_line`
    кожного findings на цьому файлі (anchor-рядки — того самого штибу, що
    findings deep-link'ають у file:line; тримає масив обмеженим). `pseudocode_
    summary` не ставиться (лишається пропущеним);
  - `split_suggestion`: `total_lines` = сума `additions + deletions` по всіх
    файлах (безкоштовно, рахуємо по-справжньому); `too_big` = провізорний
    поріг (напр. `total_lines > 500`, **явно позначити як provisional** у
    коментарі); `proposed_splits` = по одному `ProposedSplit` на верхній
    сегмент шляху (перший path-сегмент) з >1 файлом, `name` = сегмент
    (провізорна евристика, не рендериться в UI — §Поза скоупом).

**Безпека:** вхід — рядки-шляхи з уже персистованих `prFiles`, використовуються
**лише для string-matching**, ніколи не для доступу до ФС (на відміну від
intent-`readFile`, `intent.ts:113-158`). Path-traversal-поверхні нема; функція
чиста, детермінована, без I/O.

## 3. Наповнення відповіді (route → service → buildSmartDiff)

- Роут `GET /pulls/:id/smart-diff` (§5) кличе `service.getSmartDiff(workspaceId,
  prId)`.
- `ReviewService.getSmartDiff` (новий метод у `service.ts`, за зразком
  `reviewsForPull` `service.ts:161-175` і `getOrComputeIntent`
  `service.ts:196-211`):
  1. `repo.getPull(workspaceId, prId)` — 404 `NotFoundError` якщо нема (той
     самий workspace-scoped lookup, `repository.ts:41-43`).
  2. `repo.getPrFiles(prId)` — змінені файли.
  3. `repo.reviewsForPull(prId)` → взяти **перший** (найновіше рев'ю); з нього
     findings, виключивши `dismissedAt != null`. Якщо рев'ю ще нема — findings
     порожні (сортування працює й без них, per джерело 2).
  4. `buildSmartDiff(files, findings)` → `SmartDiff`. Повертає завжди 200 з
     `groups` (порожні лише якщо PR не має файлів). **Немає** compute-if-missing/
     404-семантики intent'а — SmartDiff завжди обчислюваний.
- **Onion:** `service.ts` не імпортує `fastify`; уся класифікація — в чистій
  `buildSmartDiff` (`smart-diff.ts`); `routes.ts` не торкається `container.db`.

## 4. Контракти та персистенція

- **Контракти — БЕЗ ЗМІН.** `SmartDiff`/`SmartDiffFile`/`SmartDiffGroup`/
  `SmartDiffRole`/`ProposedSplit` уже визначені й експортовані в обох копіях
  (`brief.ts:95-128` server + client). На відміну від intent-плану (де Крок 1
  розширював контракт), тут two-copy-редагування `@devdigest/shared` **не
  потрібне** — нічого не додаємо. (Якщо при typecheck виявиться дрейф між
  копіями — вирівняти вручну обидві, `INSIGHTS.md` 2026-08-04; наразі вони
  ідентичні, перевірено.)
- **Персистенція — БЕЗ ЗМІН.** Жодної нової таблиці/колонки, жодного
  `pnpm db:generate`/`db:migrate`. Рішення 3 вище.

## 5. API

- **`GET /pulls/:id/smart-diff`** у `server/src/modules/reviews/routes.ts`
  (поряд із `/pulls/:id/intent` та `/pulls/:id/reviews`, `routes.ts:138-159`):
  - `schema: { params: IdParams, response: { 200: SmartDiff } }` через
    `fastify-type-provider-zod` (`SmartDiff` з `@devdigest/shared`) — той самий
    патерн, що `PrIntentRecord`-роути (`routes.ts:152-159`).
  - `const { workspaceId } = await getContext(container, req)` →
    `return service.getSmartDiff(workspaceId, req.params.id)`.
  - **Без rate-limit** (чистий детермінований read, не LLM-виклик — на відміну
    від `POST /pulls/:id/intent/refresh` `routes.ts:164-174`). Реєстрація —
    у наявному `reviews`-плагіні, нового модуля не треба.

## 6. UI

- **Розширення наявних diff-viewer примітивів (адитивно, backward-compatible).**
  `FileCard` (`FileCard/FileCard.tsx`) отримує **опційні** пропси, щоб
  `SmartDiffViewer` міг перевикористати його, а не переписувати:
  `defaultOpen?: boolean` (override дефолту `AUTO_EXPAND_MAX_LINES`,
  `FileCard.tsx:35-37`), `highlightLines?: number[]` (підсвітка finding-рядків
  — прокидається в `CodeLine`), `findingCount?: number` (бейдж "N findings"
  поруч із наявним comment-бейджем `FileCard.tsx:67-74`), і target/nonce для
  scroll-to-line (`scrollToLine?: number`, `scrollNonce?: number` — `useEffect`
  скролить у view при зміні nonce, за зразком `FindingsTab.tsx:59-62`). Барель
  `diff-viewer/index.ts` розширюється, щоб `SmartDiffViewer` міг імпортувати
  `FileCard`/`parsePatch`/`CodeLine`/`styles` (наразі експортується лише
  `DiffViewer`, `index.ts:3-4`). Оригінальний шлях (`DiffViewer` → `FileCard`
  без нових пропсів) поводиться ідентично.
- **Новий `SmartDiffViewer`** під
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/`
  (стандартна структура: `SmartDiffViewer.tsx`, `SmartDiffViewer.test.tsx`,
  `styles.ts`, `index.ts` — `frontend-architecture`):
  - Пропси: `prId`, `files: PrFile[]` (для `patch` за `path`), опційно
    `commenting` (щоб inline-коментарі працювали і в smart-порядку).
  - Дані **лише через хуки** (`client/AGENTS.md`): `useSmartDiff(prId)` (групи
    + `finding_lines`) та `usePrReviews(prId)` (наявний,
    `hooks/reviews.ts:52-58`) для підрахунку findings на файл (бейдж) і
    scroll-target.
  - Рендер трьох груп у порядку `core → wiring → boilerplate` із заголовком
    групи. Для кожного файлу в групі — `FileCard` із `patch` з `files` за
    `path`; `defaultOpen`: `true` для `core`/`wiring` (у межах наявного
    авто-expand-ліміту) та для будь-якого файлу з `finding_lines.length > 0`
    (авторозгортання навіть boilerplate — знахідки не ховаються);
    `boilerplate` без findings — згорнутий за замовчуванням.
    `highlightLines = finding_lines`, `findingCount` = N findings на файл.
  - Scroll-to-line: клік по findings-бейджу файлу → `setTarget({ path, line,
    n: nonce+1 })` (line = min `finding_lines`), прокидається у відповідний
    `FileCard` як `scrollToLine`/`scrollNonce` — той самий target/nonce патерн,
    що `FindingsTab.tsx:59-62`.
  - `EmptyState`, поки `useSmartDiff` вантажиться / на помилці — fallback на
    оригінальний `DiffViewer` (graceful, per рішення 5).
- **Новий хук `useSmartDiff(prId)`** у `client/src/lib/hooks/reviews.ts` →
  `getSmartDiff` у `src/lib/api.ts` → `GET /pulls/:id/smart-diff`. TanStack
  Query, за зразком `usePrReviews`/`usePrIntent` (`hooks/reviews.ts:52-58,
  96-105`); тип `SmartDiff` з `@devdigest/shared`.
- **`DiffTab` тумблер** (`DiffTab/DiffTab.tsx:43-64`): додати "Smart order /
  Original order" перемикач у `SectionLabel right=` (поряд із наявним
  show/hide-comments), стан локальний (`useState`, дефолт `smart`). При `smart`
  рендерити `<SmartDiffViewer ... />`, при `original` — наявний
  `<DiffViewer files={files} commenting={commenting} />` без змін.
- **i18n:** усі нові рядки ("Smart order", "Original order", "N findings",
  заголовки груп core/wiring/boilerplate) — у `client/messages/<locale>/*.json`
  через `next-intl`, без inline-літералів (`client/AGENTS.md`).

## 7. reviewer-core

Не змінюється жодним рядком. SmartDiff — read/derive поверх персистованих даних,
поза конвеєром `diff → prompt → LLM → findings` (`reviewer-core/README.md:3-4`).
Фіксуємо явно, щоб `implementer` не спокусився покласти класифікатор туди (див.
§2 обґрунтування).

## Ризики

- **Прив'язка евристики до конкретного репо:** патерни `wiring`/`boilerplate`
  мають лишатися framework-agnostic — репо рев'юить довільні імпортовані
  репозиторії, не лише себе (рішення 1). Юніт-фікстури мусять покривати не-JS
  стек (Python `wsgi.py`, Go `go.sum`, Rust `Cargo.lock`).
- **Семантика "N findings":** бейдж рахує findings на файл із **останнього**
  рев'ю (dismissed виключені); `finding_lines` (підсвітка/авто-expand) — з тих
  самих findings, тож бейдж і підсвітка не розходяться. Задокументувати, що це
  "останнє рев'ю", не агрегат по всіх.
- **Security:** поверхня мінімальна — вхід використовується лише для
  string-matching, без доступу до ФС (контраст із intent-`readFile`). Окремий
  security-review не обов'язковий; `pr-self-review` покриває.
- **Зворотна сумісність:** контракт і схема БД не змінюються → нульовий ризик
  міграції/дрейфу; оригінальний Original-order шлях лишається піксель-в-піксель.
- Дрібна знахідка поза скоупом (флагуємо, не чіпаємо): `SmartDiff` відсутній у
  `PrBrief` (`brief.ts:131-137`).

---

## Кроки реалізації (Owned paths — для паралельних `implementer`-інстансів)

| # | Крок | Type | Owned paths | Залежить від |
|---|---|---|---|---|
| 1 | Чистий класифікатор `classifyFile` + `buildSmartDiff` | backend (pure) | `server/src/modules/reviews/smart-diff.ts` (new) | — (перший) |
| 2 | Роут `GET /pulls/:id/smart-diff` + `service.getSmartDiff` | backend | `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/service.ts` | 1 |
| 3 | Хук `useSmartDiff` + `getSmartDiff` API-клієнт | ui | `client/src/lib/hooks/reviews.ts`, `client/src/lib/api.ts` | — (контракт існує; паралельно з 1/2) |
| 4 | Адитивні пропси `diff-viewer` (`defaultOpen`/`highlightLines`/`findingCount`/scroll target) + розширений барель | ui | `client/src/components/diff-viewer/{FileCard/FileCard.tsx,CodeLine/CodeLine.tsx,styles.ts,constants.ts,index.ts}` | — (паралельно з 1/2/3) |
| 5 | `SmartDiffViewer` + тумблер у `DiffTab` + i18n | ui | `client/.../pulls/[number]/_components/SmartDiffViewer/*` (new), `client/.../_components/DiffTab/DiffTab.tsx`, `client/messages/<locale>/*.json` | 3, 4 |

Кроки 1, 3, 4 не мають взаємних залежностей і мають диз'юнктні Owned paths —
їх можна віддати трьом окремим `implementer`-інстансам одночасно. Крок 2 —
після 1; крок 5 — після 3 і 4.

**Субагенти:**
- `implementer` — виконує кроки 1-5 (1/3/4 паралельно; у 5 — свій інстанс).
  Кожен персистує цей план у `server/specs/smart-diff-plan.md` (ідемпотентно)
  як перший крок-precondition.
- `test-writer` — юніт-тести: `classifyFile` з конкретними фікстурами
  (`package-lock.json`→boilerplate, `pnpm-lock.yaml`→boilerplate,
  `src/index.ts`→wiring, `config.ts`→wiring, `urls.py`→wiring,
  `go.sum`→boilerplate, `messages/en/app.json`→boilerplate,
  `db/migrations/0001_x.sql`→boilerplate, `src/modules/foo/service.ts`→core);
  `buildSmartDiff` (порядок груп, `finding_lines` per file, `total_lines`,
  провізорний `split_suggestion`); route через `app.inject` (`*.it.test.ts`,
  seeded PR); `SmartDiffViewer.test.tsx` (групи, згорнутий boilerplate,
  авто-expand файлу з findings, бейдж, тумблер, scroll-to-line).
- `architecture-reviewer` — гейт перед мерджем: onion-межі нового роуту (без
  `container.db` в `routes.ts`); чистота `smart-diff.ts` (жодного I/O, жодного
  імпорту `fastify`/`db`/`reviewer-core`); що `diff-viewer`-пропси адитивні й
  не ламають Original-order.
- `doc-writer` — після реалізації: `INSIGHTS.md` записи (server: чистий
  path-класифікатор у reviews-модулі + свідоме рішення "без міграції, рахуємо
  на льоту"; client: тумблер Smart/Original поверх reuse `FileCard` через
  адитивні пропси). Перевірити на дублі перед записом.
- Перед PR — `pr-self-review` skill (блокує на CRITICAL). Окремий security-
  review **не** обов'язковий (немає untrusted-filesystem-поверхні, лише
  string-matching).

## Перевірка (end-to-end)

1. `cd server && pnpm typecheck && cd ../client && pnpm typecheck` — контракт
   `SmartDiff` компілюється з обох боків (без жодних правок контракту).
2. **Міграції немає** — переконатися, що `server/src/db` не змінювався і
   `pnpm db:generate` НЕ породжує нову міграцію (рішення 3). Якщо породжує —
   хтось випадково торкнув схему, відкотити.
3. `cd reviewer-core && npm run typecheck` — підтвердити, що `reviewer-core`
   не зачеплено (має лишитись без змін, §7).
4. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — hermetic
   unit: `classifyFile` фікстури (мульти-стек, §test-writer вище),
   `buildSmartDiff` (групування/finding_lines/split_suggestion). Далі
   `pnpm exec vitest run .it.test` (testcontainers) — `GET /pulls/:id/smart-diff`
   через `app.inject` на seeded PR повертає валідний `SmartDiff`.
5. `cd client && pnpm test && pnpm typecheck` — `SmartDiffViewer` рендерить
   групи, тримає boilerplate згорнутим, авто-розгортає файл із findings, показує
   бейдж; `DiffTab` тумблер перемикає Smart↔Original.
6. Ручна перевірка через `./scripts/dev.sh` проти seeded `acme/payments-api`
   PR #482 (той самий PR зі скріншота-референсу):
   a. Відкрити таб **"Files changed"** → дефолт **Smart order**: `core`-файли
      вгорі, `wiring` посередині, `boilerplate` (напр. `package-lock.json`)
      згорнутий унизу. Переконатись, що сортування працює **до** будь-якого
      рев'ю (одразу після імпорту).
   b. Запустити "Run Review" на цьому PR, повернутись у "Files changed" →
      переконатись, що на файлах зі знахідками з'явився бейдж "N findings",
      finding-рядки підсвічені, і файл авто-розгорнувся (навіть якщо він
      boilerplate/wiring).
   c. Клік по findings-бейджу файлу → diff скролиться до потрібного рядка
      (target/nonce), повторний клік по тому самому бейджу знову скролить.
   d. Перемкнути тумблер на **Original order** → відновлюється оригінальний
      порядок PR через наявний `DiffViewer`, inline-коментарі й далі працюють.
