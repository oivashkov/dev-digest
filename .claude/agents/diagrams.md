# Agent diagrams

Візуальний супровід до [README.md](README.md) — сам текст правил тут не
дублюється, лише три діаграми, на які README посилається: основний конвеєр
(`specreator → researcher → implementation-planner → implementer`),
пост-імплементаційні ворота й автори документації (чотири нові агенти), і
Type→Skills.

## Потік передачі роботи

Вісім агентів утворюють один конвеєр, але однією діаграмою його показувати
незручно — вийшло б занадто багато вузлів для "аркуша A4". Тому конвеєр
розбито на дві діаграми: основний цикл специфікації/дослідження/планування/
реалізації, і те, що відбувається з результатом `implementer`-а після того,
як крок завершено.

### Основний конвеєр

```mermaid
flowchart LR
  S["specreator<br/>(write: лише specs/, opus)"]
  R["researcher<br/>(read-only + web)"]
  P["implementation-planner<br/>(read-only, opus)"]
  I1["implementer #1<br/>Owned paths A"]
  I2["implementer #2<br/>Owned paths B"]

  S -- "specs/NN-feature.md<br/>(EARS acceptance criteria)" --> P
  S -. "Open questions<br/>(зовнішнє джерело дизайну)" .-> R
  R -- "звіт: findings /<br/>evidence / could not find" --> P
  P -- "Development Plan:<br/>steps + Owned paths" --> I1
  P -- "Development Plan:<br/>steps + Owned paths" --> I2
  P -. "Open questions<br/>(зовнішня невідомість)" .-> R
```

`specreator` та `researcher` не мають преднавантажених скілів у Type-таблиці
сенсі (`specreator` преднавантажує лише `engineering-insights`/
`mermaid-diagram`/`security` напряму через frontmatter `skills:`, не через
Type); `researcher` читає `specs/`/`docs/`/`INSIGHTS.md` напряму і має
`WebFetch`/`WebSearch`, яких немає в жодного іншого агента з восьми.

### Пост-імплементаційні ворота та автори документації

Коли `implementer` завершує крок, результат може піти в чотири боки —
писати тести, пройти два незалежні read-only аудити (архітектура і
відповідність плану), і/або лягти в документацію. Це другий, окремий
Mermaid-блок саме тому, що додавання цих чотирьох вузлів до діаграми вище
зробило б її нечитабельною.

`plan-verifier` тут з'являється **двічі** — не як два різні агенти, а як
один і той самий read-only аудит, викликаний у двох різних точках:

- **Ґейт 1**, одразу після `implementer`, до `test-writer`/`architecture-reviewer` —
  найдешевша перевірка в конвеєрі ловить `Missing`/`Partial` пункти плану
  (включно з порушенням Owned paths) до того, як дорожчі кроки
  (`test-writer` пише тести, `architecture-reviewer` читає весь diff)
  витратяться на код, що ще не готовий. Пункти типу "Tests to run/add" на
  цьому етапі очікувано можуть лишитись `Missing` — це нормально, якщо крок
  `implementer`-а навмисно залишив тести `test-writer`-у (`implementer.md`
  §6).
- **Ґейт 2**, фінальний, після `test-writer`/`architecture-reviewer` —
  підтверджує, що ті самі "Tests to run/add" пункти тепер закриті новими
  тестами і що жодна правка не зламала traceability.

```mermaid
flowchart LR
  ID["implementer<br/>(крок завершено)"]
  PL["implementation-planner<br/>Development Plan"]
  PV1["plan-verifier<br/>ґейт 1 (read-only)"]
  TW["test-writer<br/>(write: лише тести)"]
  AR["architecture-reviewer<br/>(read-only)"]
  PV2["plan-verifier<br/>ґейт 2, фінальний (read-only)"]
  DW["doc-writer<br/>(write: лише docs/specs)"]

  ID -- "реалізований код" --> PV1
  PL -- "Development Plan" --> PV1
  PV1 -. "Done/Partial → продовжити" .-> TW
  PV1 -. "Done/Partial → продовжити" .-> AR
  ID -- "готовий код / diff" --> TW
  ID -- "diff / Owned paths кроку<br/>(не весь модуль)" --> AR
  TW -- "нові тести" --> PV2
  AR -- "фікси (за потреби)" --> PV2
  PL -- "Development Plan" --> PV2
  ID -- "фіча" --> DW
  PL -- "план" --> DW
```

Два принципово різні рівні довіри тут, а не один: `architecture-reviewer` і
`plan-verifier` — **аудитори**, без `Write`/`Edit`/`Skill`/`Agent`, вони
лише повертають звіт (Architecture Review / Plan Verification), ніколи не
змінюють файли. `test-writer` і `doc-writer` — **автори**, з `Write`/`Edit`,
але їхній обсяг запису обмежений не інструментом (Claude Code видає
`Write` за назвою, не за шляхом), а промптом: `test-writer` пише лише
`*.test.ts`/`*.test.tsx`/`*.it.test.ts`/`e2e/specs/*.flow.json`, `doc-writer`
— лише `docs/`+`specs/`. Жоден із чотирьох не має `Agent` — вони не
породжують інших агентів, як і всі інші три. `plan-verifier` в обох ґейтах
приймає план від `implementation-planner`, а не лише код від `implementer` —
це maker-checker: він звіряє з самим планом, а не з переказом того, що
зробив `implementer`.

## Скіли за Type кроку

`implementation-planner` і `implementer` преднавантажують один і той самий
набір із 12 проєктних скілів; яку частину **застосовувати** для конкретного
кроку каже його `Type` (implementation-planner лише цитує їх у плані, implementer — реально накладає
під час правок). Чотири нові агенти (`test-writer`, `architecture-reviewer`,
`plan-verifier`, `doc-writer`) працюють на кроках плану типу
**`agent-definition`** — новий, план-локальний Type, що описує роботу над
самими файлами `.claude/agents/*.md`, а не над кодом `server/`/`client`/
`reviewer-core`/`e2e`:

```mermaid
flowchart LR
  backend["Type: backend"] --> onion[backend-onion-architecture]
  backend --> fastify[fastify-best-practices]
  backend --> drizzle[drizzle-orm-patterns]
  backend --> pgsql[postgresql-table-design]
  backend --> zod[zod]
  backend --> sec[security]

  ui["Type: ui"] --> fe[frontend-architecture]
  ui --> next[next-best-practices]
  ui --> react[react-best-practices]
  ui --> rtl[react-testing-library]
  ui --> sec

  core["Type: core (reviewer-core)"] --> zod
  core --> ts[typescript-expert]
  core --> sec

  agentDef["Type: agent-definition"] --> insights
  agentDef -- "лише doc-writer.md<br/>і diagrams.md" --> mermaid[mermaid-diagram]

  always["every step (always)"] --> ts
  always --> sec
  always --> insights[engineering-insights]
```

Вузли `security`, `zod` і `typescript-expert` навмисно спільні між гілками —
це та сама конвергенція, що й у Type→Skills таблиці `implementation-planner.md`/
`implementer.md` (§5/§3): `security` застосовується для будь-якого Type,
`zod` — для `backend` і `core`, `typescript-expert` — для `core` і `always`.
`agent-definition` — виняток із цієї конвергенції: він не перетинається з
`security`/`zod`/`typescript-expert` (ці кроки не торкаються продуктового
коду), а сходиться лише в `engineering-insights` (завжди) і додатково тягне
`mermaid-diagram`, але тільки для двох конкретних файлів — `doc-writer.md` (бо
цей агент сам авторить діаграми) і цей `diagrams.md` (Крок 6 плану
`docs/plans/new-subagents.md`, який ці два нові Mermaid-блоки й додав). Кроки
поза цією таблицею (наприклад docs-only) обидва агенти мапують окремо
через `.claude/skills/pr-self-review/references/skill-scope-map.md`.
