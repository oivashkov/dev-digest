# Agents

Підагенти цього репозиторію, що викликаються через `Agent`
(`subagent_type: specreator | researcher | implementation-planner |
implementer | test-writer | architecture-reviewer | plan-verifier |
doc-writer`). Це карта набору — за повним текстом правил дивись сам файл
агента (`<name>.md`), сюди він не дублюється.

Типовий конвеєр починається на вимогах, не на плані: **specreator** аналізує
джерела дизайну (скріншоти, текстовий опис, посилання — лише як нотатка,
існуючий код) і перетворює фічу на специфікацію в `specs/` за фіксованим
EARS-шаблоном, ставлячи всі знайдені прогалини (edge cases, міжмодульні
контракти, UX) користувачу як питання чи пропозицію, а не вирішуючи їх
мовчки → **researcher** знімає окремі невідомості → **implementation-planner**
рецензує наявні вимоги (спершу читає `<module>/specs/`, куди й пише
`specreator`; уточнює, якщо щось незрозуміло, і пропонує власні
рекомендації — але сам специфікацію ніколи не пише), питає, чи потрібен
мультиагентний режим чи один послідовний прохід, і перетворює задачу на
Development Plan із кроками й Owned paths (непересічними — у мультиагентному
режимі) → **implementer** виконує рівно один крок плану (кілька інстансів
паралельно, по одному на крок, якщо Owned paths не перетинаються — у
мультиагентному режимі; або один інстанс послідовно по всіх кроках — у
single-agent режимі). Після реалізації конвеєр розгалужується на чотири
спеціалізовані агенти, які можна викликати незалежно один від одного:
**test-writer** дописує тести для вже готового коду за конвенціями пакета (не
чіпає `src/`); **architecture-reviewer** і **plan-verifier** — це read-only
ворота, які можна запускати одразу після `implementer` паралельно один з
одним: перший шукає порушення шарування з доказом `file:line`, другий звіряє
код проти пунктів плану (traceability matrix, maker-checker — вимагає сам
план, а не звіт `implementer`) і в свою чергу не підмінює архітектурний чи
code review; **doc-writer** перетворює готовий план або реалізовану фічу на
документацію в `docs/`/`specs/` з Mermaid-діаграмами за потреби (специфікації
"що будувати" лишаються за `specreator` — `doc-writer` документує вже
реалізоване). Жоден з восьми не комітить, не пушить і не відкриває PR — це
рішення лишається за користувачем або окремим review-агентом.

## Діаграми

Потік передачі роботи (`researcher → implementation-planner → implementer`) і мапінг
Type кроку → преднавантажені скіли — у [diagrams.md](diagrams.md).

## Каталог

| Агент | Модель | Дозволи (tools) | Відповідальність |
|---|---|---|---|
| [specreator](specreator.md) | opus | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` (Write/Edit — лише `specs/` кореня й модулів + виняток `e2e/docs/`) | Аналізує джерела дизайну (скріншоти, текст, код; посилання лише як нотатка) і пише специфікацію фічі за фіксованим EARS-шаблоном; кожну знайдену прогалину ставить користувачу як питання чи пропозицію, ніколи не вирішує мовчки |
| [researcher](researcher.md) | sonnet | `Read`, `Grep`, `Glob`, `Bash` (тільки read-only), `WebFetch`, `WebSearch` | Відповідає на конкретне питання доказами з коду репозиторію та/або зовнішніх джерел |
| [implementation-planner](implementation-planner.md) | opus | `Read`, `Grep`, `Glob`, `Bash` (тільки read-only) | Перевіряє реквайременти, уточнює неясне, дає рекомендації, питає single-agent vs мультиагентний режим і перетворює запит на Development Plan із кроками, Owned paths і архітектурними обмеженнями — код і специфікації не пише |
| [implementer](implementer.md) | sonnet | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` | Виконує рівно один крок плану в межах його Owned paths: пише код, ганяє тести, самоперевіряє |
| [test-writer](test-writer.md) | sonnet | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` (Write/Edit — лише тестові файли й фікстури) | Дописує/розширює тести для вже готового коду за наявними конвенціями пакета (RTL/jsdom, hermetic vitest, `*.it.test.ts`+testcontainers, `reviewer-core` npm unit, e2e hermetic) — не чіпає production `src/` |
| [architecture-reviewer](architecture-reviewer.md) | sonnet | `Read`, `Grep`, `Glob`, `Bash` (read-only) | Аудитує diff/модуль на порушення архітектурних меж (back-call, skip-call, циклічні залежності, дублювання функціональності) з доказом `file:line`; нічого не пише і не фіксить |
| [plan-verifier](plan-verifier.md) | sonnet | `Read`, `Grep`, `Glob`, `Bash` (read-only) | Звіряє реалізований код проти пунктів Development Plan (maker-checker, requirements-traceability matrix, стани Done/Partial/Missing/Silently-descoped) — не code review і не architecture review |
| [doc-writer](doc-writer.md) | sonnet | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` (Write/Edit — лише `docs/`+`specs/`) | Перетворює реалізовану фічу або завершений план на документацію (`docs/README.md` модуля/кореня, `specs/`) з Mermaid-діаграмами за потреби; рішення й відхилені підходи йдуть у `INSIGHTS.md`, не в `docs/` |

Жоден із восьми не має `Agent` (не породжує інших субагентів). `researcher`,
`implementation-planner`, `architecture-reviewer` і `plan-verifier` не мають
`Write`/`Edit` — нічого не змінюють у файловій системі (`architecture-reviewer`
і `plan-verifier` read-only навіть без `Skill` — цитують скіли за назвою, як і
`implementation-planner`). `specreator`, `test-writer` і `doc-writer` мають
`Write`/`Edit`, але їхній обсяг запису обмежено лише промптом (у Claude Code
немає механізму видати `Write` лише на глоб шляху): `specreator` — тільки
`specs/` (кореневі й модульні) плюс виняток `e2e/docs/` (бо `e2e/specs/`
зайнятий виконуваними `*.flow.json`), `test-writer` — тільки тестові файли й
фікстури (`*.test.ts`, `*.test.tsx`, `*.it.test.ts`, `e2e/specs/*.flow.json`),
`doc-writer` — тільки `docs/` і `specs/` (кореневі й модульні), ніколи
`src/`. Усі три мають спільний виняток поза власним обсягом:
`<module>/INSIGHTS.md` через скіл `engineering-insights`, як і решта агентів,
що його преднавантажують. `implementer`, `specreator`, `test-writer` і
`doc-writer` не мають `WebFetch`/`WebSearch` — зовнішні невідомості (включно з
Figma-посиланнями в `specreator`) мідтаск звітують як заблоковане відхилення
чи "Open questions", а не досліджують самі.

## specreator

- **Відповідальність:** аналізує джерела дизайну (скріншоти, вставлені в
  розмову, текстовий опис, посилання — лише як нотатка без фактичного
  відкриття, наявний код/репо як базова лінія) і перетворює фічу на
  специфікацію для Spec-Driven Development у `specs/` за фіксованим
  EARS-шаблоном (`Spec ID`/`Status`/`Supersedes`, Problem & user, Goals/
  Non-goals, User stories, Acceptance criteria (EARS, білінгвальні тригери
  `WHEN (КОЛИ)` + `shall (shall)`), Edge cases, Non-functional requirements,
  Inputs and provenance, Untrusted inputs, Open questions). Кожну знайдену
  прогалину (пропущений стан, непокритий edge case, неясний міжмодульний
  контракт, UX-шорсткість) ставить користувачу як уточнювальне питання чи
  пропозицію — ніколи не вирішує мовчки. Ніколи не пише Development Plan і не
  вирішує режим виконання — це `implementation-planner`.
- **Дозволи:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash` (read-only),
  `Skill`. `Write`/`Edit` обмежено промптом до `specs/` (кореня й модулів
  `server`/`client`/`reviewer-core`/`mcp-server`) плюс виняток `e2e/docs/`
  (бо `e2e/specs/` тримає лише виконувані `*.flow.json` — власний
  `e2e/specs/README.md` це явно каже) — і стандартний виняток
  `<module>/INSIGHTS.md` через `engineering-insights`. Без
  `WebFetch`/`WebSearch` — Figma чи інше зовнішнє посилання йде в "Open
  questions", а не відкривається. Без `Agent`.
- **Модель:** opus.
- **Вхід:** конкретна фіча + яких пакетів стосується + джерела дизайну, якщо
  є (скріншот у розмові, текст, посилання, наявний код). Неоднозначність
  (single- чи multi-module, відсутні джерела для UI-фічі) — спершу 1-3
  уточнювальні запитання одним раундом.
- **Вихід:** новий/оновлений файл(и) у `specs/` (або `e2e/docs/`) + Specreator
  Report (markdown-текст фінальної відповіді, за фіксованим форматом §10 у
  `specreator.md`) — Scope, Context reviewed, Design sources reviewed, Gaps
  found and how resolved, Files written or updated, Diagrams added,
  Self-verification, Open questions carried into the spec, Insights
  recorded, Explicitly NOT performed. Перед звітом — обов'язковий крок
  самоперевірки (§9): перечитує щойно записані файли, звіряє кожен AC-рядок
  проти `ears-requirements`, звіряє `Spec ID` з іменем файлу, звіряє, що
  жодна секція шаблону не лишилась порожньою — і фіксить, а не лише
  репортить. Файл пишеться одразу зі `Status: draft` (проміжного
  show-draft-in-chat кроку немає — сам файл і є чернетка, дороблюється через
  `Edit`).
- **Джерела правил** (звідки взяті обмеження й формат):
  - `AGENTS.md` (корінь) — порядок пошуку контексту (`specs/` → `docs/` →
    `INSIGHTS.md` → source), do-not-touch список.
  - Корінний `specs/README.md` та кожен `<module>/specs/README.md` — джерело
    самого EARS-шаблону й правила іменування `NN-feature-name.md` /
    `Spec ID: SPEC-NN-feature-name`.
  - `e2e/specs/README.md` і `e2e/docs/README.md` — джерело винятку
    "написані specs для `e2e/` йдуть у `docs/`, не в `specs/`".
  - `ears-requirements` скіл — джерело п'яти EARS-патернів, білінгвального
    `WHEN (КОЛИ)`/`shall (shall)` формату й правила "один буліт — одна
    незалежно перевірювана вимога", яке §9 самоперевіряє перед звітом.
  - `security` скіл — джерело для секцій Inputs and provenance / Untrusted
    inputs; `reviewer-core`'s `wrapUntrusted()`/`INJECTION_GUARD` — конкретний
    приклад, вартий цитування, коли релевантний. `zod` скіл — точні
    формулювання при посиланні на наявну чи нову `@devdigest/shared`-схему.
  - `engineering-insights` скіл — той самий read-first/record-last процес,
    що й у решти агентів.

## researcher

- **Відповідальність:** дослідницький, read-only агент. Два режими — repository
  research (код, `specs/`, `docs/`, `INSIGHTS.md`) і external research (web),
  за потреби обидва в одній відповіді.
- **Дозволи:** `Read`, `Grep`, `Glob`, `Bash` (read-only git/fs-інспекція),
  `WebFetch`, `WebSearch`. Ніколи не викликає `/deep-research`.
- **Модель:** sonnet.
- **Вхід:** конкретне, відповідне питання (репо і/або зовнішнє). Якщо запит —
  голий топік без питання, спершу ставить 1–3 уточнювальні запитання.
- **Вихід:** структурований звіт-текст (не файл) — `## Repository research` та/
  або `## External research` з розділами Findings / Evidence / References /
  Could not find.

## implementation-planner

- **Відповідальність:** планування без коду і без специфікацій. Перевіряє
  наявні реквайременти (запит + що знайдено в `<module>/specs/`), уточнює,
  якщо щось незрозуміло, і дає власні рекомендації, якщо бачить кращий
  підхід. Завжди питає користувача, чи потрібен мультиагентний режим
  (непересічні Owned paths для паралельних `implementer`-інстансів), чи
  single-agent (один інстанс, послідовно, усі кроки). Далі мапить запит на
  модулі й пакети, формулює архітектурні обмеження, ділить роботу на кроки з
  Owned paths і зазначеним skill-акцентом відповідно до обраного режиму.
  Ніколи не пише й не редагує саму специфікацію/вимоги — тільки рецензує їх.
- **Дозволи:** `Read`, `Grep`, `Glob`, `Bash` (read-only). Без `Write`/`Edit` —
  навіть сам файл плану не зберігає. Без `Skill` tool, але ті самі 12 проєктних
  скілів, що й у `implementer`, преднавантажені в контекст і цитуються за
  назвою (не викликаються).
- **Модель:** opus.
- **Вхід:** конкретна, скоупована ціль ("що зробити") + підтверджений режим
  виконання. Якщо ціль розмита, реквайременти неоднозначні, або режим
  (single-agent/мультиагентний) не названо в запиті — спершу уточнювальні
  запитання (одним раундом, не по черзі).
- **Вихід:** Development Plan (markdown-текст фінальної відповіді, за
  фіксованим форматом §7 у `implementation-planner.md`) — Summary,
  Requirements reviewed, Context reviewed, Modules affected, Architectural
  constraints, Execution mode, Steps (Type, Owned paths, Depends on, Tests to
  run/add), Cross-cutting concerns, Recommendations, Out of scope, Open
  questions, Suggested review path. Ніякого "suggested spec path" — план не є
  специфікацією і не позиціонується як кандидат на `specs/`; персистить його
  (за потреби) `implementer` (як §0 своєї процедури) або користувач, незалежно
  від цього агента.
- **Джерела правил** (звідки взяті обмеження й формат):
  - `AGENTS.md` (корінь) — порядок пошуку контексту (`specs/` → `docs/` →
    `INSIGHTS.md` → source), карта модулів/пакетних менеджерів, do-not-touch
    список.
  - `<module>/AGENTS.md` кожного зачепленого пакета — per-module конвенції
    (onion-шари в `server/`, hooks-only data access у `client/`, `LLMProvider`/
    `groundFindings()` у `reviewer-core/`).
  - 12 преднавантажених проєктних скілів (`backend-onion-architecture`,
    `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
    `zod`, `frontend-architecture`, `next-best-practices`,
    `react-best-practices`, `react-testing-library`, `typescript-expert`,
    `security`, `engineering-insights`) — джерело §5 Type→Skills таблиці та
    архітектурних обмежень §4 плану.
  - `.claude/skills/pr-self-review/references/skill-scope-map.md` — резервний
    file→skill lookup для кроків поза Type-таблицею (наприклад, docs-only).

## implementer

- **Відповідальність:** виконання рівно одного кроку Development Plan (від
  `implementation-planner` або заданого напряму) у межах його Owned paths —
  пише/редагує код, ганяє наявні тести й typecheck, самоперевіряє результат
  наскрізно. Безпечно запускати кількома паралельними інстансами, по одному
  на крок, якщо Owned paths не перетинаються (мультиагентний режим); або
  одним інстансом послідовно по всіх кроках (single-agent режим).
- **Дозволи:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill`. Ті самі
  12 скілів, що й у `implementation-planner`, преднавантажені — `Skill`
  викликається лише для того, чого немає в преднавантаженому наборі
  (наприклад `verify`, `mermaid-diagram`). `Bash` — тести, typecheck,
  read-only git; ніколи `git commit` / `git push` / `gh pr create` /
  встановлення залежностей. Ніколи не викликає `pr-self-review`,
  `code-review`, `security-review` — це окремі review-агенти. Без
  `WebFetch`/`WebSearch`, без `Agent`.
- **Модель:** sonnet.
- **Вхід:** Development Plan + номер конкретного кроку (файл або текст від
  `implementation-planner`), або конкретний однокроковий скоуп, заданий
  напряму. Без плану й без скоупу — просить його, а не вигадує вимоги.
- **Вихід:** зміни у файлах у межах Owned paths кроку (код + за потреби
  запис плану в `<module>/specs/`) + Implementation Report (markdown-текст
  фінальної відповіді, за фіксованим форматом §10 у `implementer.md`) —
  Plan reference, Insights read, Changes, Tests run, Self-verification,
  Deviations, Insights recorded, Explicitly NOT performed, Follow-ups. Також
  дописує запис в `INSIGHTS.md` відповідного модуля, якщо є що нетривіальне
  зафіксувати.
- **Джерела правил** (звідки взяті обмеження й процедура):
  - `AGENTS.md` (корінь) — do-not-touch список, порядок `INSIGHTS.md` →
    `AGENTS.md` перед редагуванням.
  - `<module>/AGENTS.md` кожного зачепленого пакета — ті самі per-module
    конвенції, що читає `implementation-planner` (§4 `implementer.md`:
    DI-контейнер, `container.vcsFor(repo)`, `LocalSecretsProvider`,
    `db:generate` замість ручних міграцій у `server/`; hooks + TanStack Query
    + `next-intl` у `client/`; ін'єктований `LLMProvider` +
    `groundFindings()` у `reviewer-core/`).
  - Той самий набір 12 преднавантажених скілів і Type→Skills таблиця, що й у
    `implementation-planner.md` (§5 `implementer.md` §3) — навмисно
    тримаються синхронізованими в обох файлах, щоб план і виконання не
    розходились.
  - `TESTING.md` — команди тестів/typecheck по пакету (§6 `implementer.md`).
  - `.claude/skills/pr-self-review/references/skill-scope-map.md` — той самий
    резервний lookup, що й у `implementation-planner`, для кроків поза
    Type-таблицею.
  - `engineering-insights` скіл — формат і duplicate-check для запису в
    `INSIGHTS.md` наприкінці кроку.

## test-writer

- **Відповідальність:** дописує або розширює тести для коду, який уже існує,
  за наявними конвенціями пакета (RTL+jsdom у `client/`, hermetic vitest у
  `server/`, `*.it.test.ts`+testcontainers Postgres для DB/schema/dialect-
  логіки, npm unit у `reviewer-core/`, hermetic batch-JSON flow у `e2e/`).
  Ніколи не змінює production-код під тестом і не винаходить нову тестову
  конвенцію для пакета — якщо тест виявляє реальний баг, звітує про нього
  замість того, щоб фіксити.
- **Дозволи:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill`.
  `Write`/`Edit` обмежено лише тестовими файлами й фікстурами (`*.test.ts`,
  `*.test.tsx`, `*.it.test.ts`, `e2e/specs/*.flow.json`, вміст
  `test/`/`tests/`/`__fixtures__/`) — ніколи production `src/`. `Bash` — лише
  запуск тестових/typecheck-команд пакета; ніколи `pnpm install`,
  `db:migrate`, `db:seed` чи інша мутація стану. Без `WebFetch`/`WebSearch`,
  без `Agent`.
- **Модель:** sonnet.
- **Вхід:** конкретний код/зміна, що потребує покриття (файл, роут,
  компонент, недавній diff). Якщо ціль або цільовий suite неоднозначні —
  спершу 1–3 уточнювальні запитання.
- **Вихід:** нові/розширені тестові файли в межах §1-обсягу + Test
  Implementation Report (markdown-текст фінальної відповіді, за фіксованим
  форматом §9 у `test-writer.md`) — Scope, Insights read, Files
  added/changed, Suite(s) run (команда + pass/fail), Use-case coverage
  rationale, Mocking boundaries, Anti-patterns avoided, Deviations/defects
  found, Insights recorded, Explicitly NOT performed, Follow-ups.
- **Джерела правил** (звідки взяті обмеження й процедура):
  - `TESTING.md` (корінь) — вибір suite по пакету (§3 `test-writer.md`),
    команди запуску (§6).
  - `AGENTS.md` (корінь) — do-not-touch список, порядок `INSIGHTS.md` →
    `AGENTS.md`.
  - `server/src/adapters/mocks.ts` — `MockLLMProvider`/`MockGitClient`/
    `MockGitHubClient`/`MockGitLabClient` як межа мокання зовнішнього світу
    в `server/`.
  - Преднавантажені скіли `react-testing-library`, `typescript-expert`,
    `security`, `engineering-insights` — джерело §4 (test-quality bar: без
    тавтологічних asserts, дзеркальної логіки, over-mocking SUT,
    happy-path-only; RTL `getByRole` > `getByTestId`, `userEvent` >
    `fireEvent`).

## architecture-reviewer

- **Відповідальність:** read-only аудитор архітектурних меж. Читає diff/
  модуль (ніколи не редагує) і звітує порушення шарування — back-call,
  skip-call, циклічна залежність, дублювання функціональності — які
  перетинають межу, визначену наявними конвенціями репозиторію (onion-шари
  `server/`, hooks-only data access `client/`, `LLMProvider`-ін'єкція
  `reviewer-core/`). Кожне знахідка обов'язково з доказом `file:line` і
  реальним імпортом/call-chain — ніколи узагальнена порада.
- **Дозволи:** `Read`, `Grep`, `Glob`, `Bash` (тільки read-only git/fs-
  інспекція: `git diff`, `git log`, `git blame`, `git show`, `ls`, `find`).
  Без `Write`, `Edit`, `Skill`, `Agent` — ніколи не фіксить знайдене, скіли
  цитує за назвою (як `implementation-planner`), інших агентів не породжує. Без
  `WebFetch`/`WebSearch` — зовнішню невідомість фіксує як "could not
  confirm" для `researcher`, не гадає.
- **Модель:** sonnet.
- **Вхід:** конкретна ціль аудиту (diff, PR, модуль, набір файлів, "усе
  змінене з <ref>"). Без конкретної цілі — питає, а не сканує весь
  репозиторій за замовчуванням.
- **Вихід:** Architecture Review (markdown-текст фінальної відповіді, за
  фіксованим форматом §6 у `architecture-reviewer.md`) — Scope, Boundary
  rules applied, Findings (Critical/Warning/Suggestion, кожна з typology,
  доказом і confidence), Explicitly not flagged, Could not confirm, Insights
  recorded.
- **Джерела правил** (звідки взяті обмеження й правила меж):
  - `.claude/skills/backend-onion-architecture` — напрямок залежностей
    `routes.ts → service.ts → repository.ts`/`adapters/*`, заборона прямого
    `container.db`/`drizzle-orm` у роутах, правило `container.vcsFor(repo)`
    замість прямого `container.github()`/`container.gitlab()`, перелік
    Accepted Deviations, які не варто пере-репортити.
  - `.claude/skills/frontend-architecture` — hooks-only data access у
    `client/` (`src/lib/hooks/*` → `src/lib/api.ts`), заборона прямого
    `fetch` поза `api.ts`.
  - `reviewer-core/` конвенції (з `AGENTS.md`) — ін'єктований `LLMProvider`,
    обов'язковий `groundFindings()`-гейт на кожен масив findings.
  - `server/INSIGHTS.md` та "Accepted Deviations" у
    `.claude/skills/backend-onion-architecture/SKILL.md` — джерело §5 "what
    NOT to report" (відомий борг `settings`/`polling`/`pulls`/`workspace`,
    Zod-контракти як domain model).

## plan-verifier

- **Відповідальність:** read-only звірка реалізованого коду проти пунктів
  Development Plan чи іншого документа вимог — maker-checker: працює з
  самим планом, а не зі звітом `implementer` про виконане. Будує
  requirements-traceability matrix (пункт плану → конкретний артефакт
  `file:test:line`) і класифікує кожен пункт як Done / Partial / Missing /
  Silently-descoped-with-reason, плюс окремо відмічає gold-plating. Не є
  code review чи architecture review і не сперечається з рішеннями
  реалізації, якщо acceptance criteria вже виконані.
- **Дозволи:** `Read`, `Grep`, `Glob`, `Bash` (тільки read-only:
  `git log`/`git diff`/`git show`/`git blame`, `ls`, `find`, тестові/lint-
  команди без побічних ефектів). Без `Write`, `Edit`, `Skill`, `Agent` —
  ніколи не змінює файл (навіть власний звіт), не встановлює залежностей і
  не мігрує БД. Без `WebFetch`/`WebSearch` — зовнішню невідомість фіксує як
  відкритий пробіл для `researcher`.
- **Модель:** sonnet.
- **Вхід:** сам план/документ вимог (не переказ від `implementer`) + код/
  артефакти для звірки (diff, гілка, набір файлів). Якщо дано лише
  Implementation Report без базового плану, або ціль звірки не названа —
  спершу питає, а не гадає.
- **Вихід:** Plan Verification (markdown-текст фінальної відповіді, за
  фіксованим форматом §7 у `plan-verifier.md`) — Plan reference, Insights
  read, Traceability matrix, Gold-plating, Overall verdict (coverage
  D/P/M/S із загальної кількості), Notes for other reviewers (non-binding),
  Insights recorded, Explicitly NOT performed, Follow-ups.
- **Джерела правил** (звідки взяті обмеження й метод):
  - Сам `Development Plan`/специфікація, яку перевіряє — джерело пунктів
    traceability matrix; жоден пункт не закривається без названого
    артефакту (заборона "silent LGTM").
  - `engineering-insights` скіл — модульна таблиця resolution для читання
    `INSIGHTS.md` перед звіркою (пояснює свідомі відхилення від плану) і
    формат/duplicate-check для запису після.
  - Явне розмежування з `code-review`/`architecture-reviewer` — знахідки не
    у своїй смузі йдуть лише в non-binding "Notes for other reviewers", ніколи
    не змінюють вердикт Done/Partial/Missing.

## doc-writer

- **Відповідальність:** перетворює реалізовану фічу, завершений план чи
  наявний механізм на документацію під `docs/`/`specs/`, додаючи Mermaid-
  діаграми там, де вони прояснюють потік. Маршрутизує кожен вид контенту на
  правильну ціль за Diataxis-подібною таблицею (модульний
  `docs/README.md`, кореневий `docs/README.md`, `INSIGHTS.md` через
  `engineering-insights` для рішень, `specs/` для планів) і посилається на
  канонічний план/специфікацію замість дублювання. Ніколи не пише й не
  редагує `src/` чи будь-який код, не вигадує поведінку, яку не перевірив у
  коді чи джерелі.
- **Дозволи:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill`.
  `Write`/`Edit` обмежено лише `docs/` (корінь і модулі) та `specs/` (корінь
  і модулі) — ніколи `src/` чи інший код. `Bash` — лише read-only
  інспекція (`git log`/`git diff`/`git show`, `ls`, `find`, doc-lint за
  наявності); ніколи `git commit`/`git push`/`gh pr create`/встановлення
  залежностей. Без `WebFetch`/`WebSearch`, без `Agent`.
- **Модель:** sonnet.
- **Вхід:** конкретна ціль документування (фіча/модуль/потік/план) +
  аудиторія (модульна vs кросс-пакетна vs `specs/`) + джерело істини для
  звірки. Якщо ціль або аудиторія неоднозначні — спершу 1–3 уточнювальні
  запитання.
- **Вихід:** нові/оновлені файли в `docs/`/`specs/` в межах §1-обсягу +
  Documentation Report (markdown-текст фінальної відповіді, за фіксованим
  форматом §5 у `doc-writer.md`) — Scope, Files written or updated (з
  Diataxis-типом і обґрунтуванням цілі), Diagrams added, Canonical links
  referenced, Deviations/follow-ups, Insights recorded, Explicitly NOT
  performed.
- **Джерела правил** (звідки взяті обмеження й правила маршрутизації):
  - Diataxis (reference/how-to/tutorial/explanation) — основа §2
    content-routing table, змаплена на реальну структуру репозиторію
    (`<module>/docs/README.md` vs кореневий `docs/README.md` vs `specs/`).
  - `engineering-insights` скіл — рішення й відхилені підходи йдуть у
    `INSIGHTS.md`, ніколи в `docs/`; той самий read-first/record-last
    процес, що й у решти агентів.
  - `.claude/skills/mermaid-diagram` — авторство Mermaid-блоків
    (diagrams-as-code), евристика "влазить в аркуш A4" — інакше розбити на
    кілька діаграм або лишити прозу.
  - Правило do-not-duplicate (docs-as-code) — посилатись на канонічний
    `specs/`/план замість копіювання його вмісту.
