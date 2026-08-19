# Agents

Підагенти цього репозиторію, що викликаються через `Agent`
(`subagent_type: researcher | planner | implementer | test-writer |
architecture-reviewer | plan-verifier | doc-writer`). Це карта набору — за
повним текстом правил дивись сам файл агента (`<name>.md`), сюди він не
дублюється.

Типовий конвеєр: **researcher** знімає невідомості → **planner** перетворює
задачу на Development Plan із кроками й непересічними Owned paths →
**implementer** виконує рівно один крок плану (кілька інстансів паралельно,
по одному на крок, якщо Owned paths не перетинаються). Після реалізації
конвеєр розгалужується на чотири спеціалізовані агенти, які можна викликати
незалежно один від одного: **test-writer** дописує тести для вже готового
коду за конвенціями пакета (не чіпає `src/`); **architecture-reviewer** і
**plan-verifier** — це read-only ворота, які можна запускати одразу після
`implementer` паралельно один з одним: перший шукає порушення шарування з
доказом `file:line`, другий звіряє код проти пунктів плану (traceability
matrix, maker-checker — вимагає сам план, а не звіт `implementer`) і в свою
чергу не підмінює архітектурний чи code review; **doc-writer** перетворює
готовий план або реалізовану фічу на документацію в `docs/`/`specs/` з
Mermaid-діаграмами за потреби. Жоден з семи не комітить, не пушить і не
відкриває PR — це рішення лишається за користувачем або окремим
review-агентом.

## Діаграми

Потік передачі роботи (`researcher → planner → implementer`) і мапінг
Type кроку → преднавантажені скіли — у [diagrams.md](diagrams.md).

## Каталог

| Агент | Модель | Дозволи (tools) | Відповідальність |
|---|---|---|---|
| [researcher](researcher.md) | sonnet | `Read`, `Grep`, `Glob`, `Bash` (тільки read-only), `WebFetch`, `WebSearch` | Відповідає на конкретне питання доказами з коду репозиторію та/або зовнішніх джерел |
| [planner](planner.md) | opus | `Read`, `Grep`, `Glob`, `Bash` (тільки read-only) | Перетворює запит на Development Plan із кроками, Owned paths і архітектурними обмеженнями — код не пише |
| [implementer](implementer.md) | sonnet | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` | Виконує рівно один крок плану в межах його Owned paths: пише код, ганяє тести, самоперевіряє |
| [test-writer](test-writer.md) | sonnet | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` (Write/Edit — лише тестові файли й фікстури) | Дописує/розширює тести для вже готового коду за наявними конвенціями пакета (RTL/jsdom, hermetic vitest, `*.it.test.ts`+testcontainers, `reviewer-core` npm unit, e2e hermetic) — не чіпає production `src/` |
| [architecture-reviewer](architecture-reviewer.md) | sonnet | `Read`, `Grep`, `Glob`, `Bash` (read-only) | Аудитує diff/модуль на порушення архітектурних меж (back-call, skip-call, циклічні залежності, дублювання функціональності) з доказом `file:line`; нічого не пише і не фіксить |
| [plan-verifier](plan-verifier.md) | sonnet | `Read`, `Grep`, `Glob`, `Bash` (read-only) | Звіряє реалізований код проти пунктів Development Plan (maker-checker, requirements-traceability matrix, стани Done/Partial/Missing/Silently-descoped) — не code review і не architecture review |
| [doc-writer](doc-writer.md) | sonnet | `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` (Write/Edit — лише `docs/`+`specs/`) | Перетворює реалізовану фічу або завершений план на документацію (`docs/README.md` модуля/кореня, `specs/`) з Mermaid-діаграмами за потреби; рішення й відхилені підходи йдуть у `INSIGHTS.md`, не в `docs/` |

Жоден із семи не має `Agent` (не породжує інших субагентів). `researcher`,
`planner`, `architecture-reviewer` і `plan-verifier` не мають `Write`/`Edit` —
нічого не змінюють у файловій системі (`architecture-reviewer` і
`plan-verifier` read-only навіть без `Skill` — цитують скіли за назвою, як і
`planner`). `test-writer` і `doc-writer` мають `Write`/`Edit`, але їхній
обсяг запису обмежено лише промптом (у Claude Code немає механізму видати
`Write` лише на глоб шляху): `test-writer` — тільки тестові файли й фікстури
(`*.test.ts`, `*.test.tsx`, `*.it.test.ts`, `e2e/specs/*.flow.json`),
`doc-writer` — тільки `docs/` і `specs/` (кореневі й модульні), ніколи
`src/`. `implementer`, `test-writer` і `doc-writer` не мають
`WebFetch`/`WebSearch` — зовнішні невідомості мідтаск звітують як заблоковане
відхилення, а не досліджують самі.

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

## planner

- **Відповідальність:** планування без коду. Мапить запит на модулі й
  пакети, формулює архітектурні обмеження, ділить роботу на кроки з
  непересічними Owned paths і зазначеним skill-акцентом, щоб кілька
  `implementer`-інстансів могли пізніше виконувати кроки паралельно, не
  суперечачи одне одному.
- **Дозволи:** `Read`, `Grep`, `Glob`, `Bash` (read-only). Без `Write`/`Edit` —
  навіть сам файл плану не зберігає. Без `Skill` tool, але ті самі 12 проєктних
  скілів, що й у `implementer`, преднавантажені в контекст і цитуються за
  назвою (не викликаються).
- **Модель:** opus.
- **Вхід:** конкретна, скоупована ціль ("що зробити"). Якщо ціль розмита —
  спершу 1–3 уточнювальні запитання.
- **Вихід:** Development Plan (markdown-текст фінальної відповіді, за
  фіксованим форматом §6 у `planner.md`) — Summary, Context reviewed, Modules
  affected, Architectural constraints, Steps (Type, Owned paths, Depends on,
  Tests to run/add), Open questions, Suggested spec path. Файл не створює —
  персистить його `implementer` (як §0 своєї процедури) або користувач.
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
    `security`, `engineering-insights`) — джерело §4 Type→Skills таблиці та
    архітектурних обмежень §4 плану.
  - `.claude/skills/pr-self-review/references/skill-scope-map.md` — резервний
    file→skill lookup для кроків поза Type-таблицею (наприклад, docs-only).

## implementer

- **Відповідальність:** виконання рівно одного кроку Development Plan (від
  `planner` або заданого напряму) у межах його Owned paths — пише/редагує
  код, ганяє наявні тести й typecheck, самоперевіряє результат наскрізно.
  Безпечно запускати кількома паралельними інстансами, по одному на крок,
  якщо Owned paths не перетинаються.
- **Дозволи:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill`. Ті самі
  12 скілів, що й у `planner`, преднавантажені — `Skill` викликається лише для
  того, чого немає в преднавантаженому наборі (наприклад `verify`,
  `mermaid-diagram`). `Bash` — тести, typecheck, read-only git; ніколи
  `git commit` / `git push` / `gh pr create` / встановлення залежностей.
  Ніколи не викликає `pr-self-review`, `code-review`, `security-review` —
  це окремі review-агенти. Без `WebFetch`/`WebSearch`, без `Agent`.
- **Модель:** sonnet.
- **Вхід:** Development Plan + номер конкретного кроку (файл або текст від
  `planner`), або конкретний однокроковий скоуп, заданий напряму. Без плану й
  без скоупу — просить його, а не вигадує вимоги.
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
    конвенції, що читає `planner` (§4 `implementer.md`: DI-контейнер,
    `container.vcsFor(repo)`, `LocalSecretsProvider`, `db:generate` замість
    ручних міграцій у `server/`; hooks + TanStack Query + `next-intl` у
    `client/`; ін'єктований `LLMProvider` + `groundFindings()` у
    `reviewer-core/`).
  - Той самий набір 12 преднавантажених скілів і Type→Skills таблиця, що й у
    `planner.md` (§3 `implementer.md`) — навмисно тримаються синхронізованими
    в обох файлах, щоб план і виконання не розходились.
  - `TESTING.md` — команди тестів/typecheck по пакету (§6 `implementer.md`).
  - `.claude/skills/pr-self-review/references/skill-scope-map.md` — той самий
    резервний lookup, що й у `planner`, для кроків поза Type-таблицею.
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
  цитує за назвою (як `planner`), інших агентів не породжує. Без
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
