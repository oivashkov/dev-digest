# Intent Layer — план реалізації

> Затверджено користувачем 2026-08-18 (гілка `lab03-intent-layer`).
> Реалізація йде в auto mode: кроки 1-6 нижче виконуються послідовно/
> паралельно (де Owned paths дозволяють) без паузи на підтвердження після
> кожного кроку.

## Контекст

Зараз PR review не знає, **навіщо** зроблено зміни — тільки *що* змінилось (diff).
Це веде до хибних severity-оцінок (наприклад, навмисне спрощення читається як
"пропущена перевірка"). Intent Layer має класифікувати мотивацію PR (title +
description + linked ticket + посилання на план/спеку в описі) окремою
дешевою моделлю, і передати цей intent у промпт основного рев'ю.

**Ключове відкриття під час дослідження (3 паралельні Explore-агенти +
planner-агент, усе з посиланнями file:line):** ця фіча вже **на 80%
заскафолджена і на 0% підключена** — точно той самий патерн, що вже описаний
в кореневому `INSIGHTS.md` (2026-08-12, Skills feature) — таблиця в БД,
Zod-контракт `Intent`, запис `review_intent` у реєстрі `FEATURE_MODELS`,
repository-методи `upsertIntent`/`getIntent` — усе це існує, але жодного
рядка коду, що це реально викликає, немає:

- `pr_intent` таблиця (`server/src/db/schema/reviews.ts:74-81`) — порожня,
  міграція вже згенерована (`0000_init.sql`), ніхто нікого не пише.
- `upsertIntent`/`getIntent` (`pull.repo.ts:49-68`) — 0 викликів у всьому
  `server/src` (grep підтвердив).
- `Intent` Zod-контракт (`brief.ts:9-14`) — `{ intent, in_scope, out_of_scope }`,
  без `confidence`, без посилань на план/спеку.
- `FEATURE_MODELS` реєстр вже містить `review_intent` (`platform.ts:52-58`),
  дефолт — `openai/gpt-4.1` (**не дешева модель**, попри власний doc-comment
  "Derives a PR's intent... before review"). Settings UI (`SettingsModels.tsx`)
  вже generically рендерить picker для будь-якого `FeatureModelId`, включно з
  `review_intent` — **окремого UI для вибору моделі писати не треба**, лише
  змінити дефолт.
- `reviewer-core` explicitly називає "intent" out-of-scope для рушія
  (`review/run.ts:22`), але `INJECTION_GUARD` (`prompt.ts:18,26-28`) вже
  **заздалегідь** згадує "derived intent/scope" як untrusted — текст писався
  в очікуванні цього слоту.
- Клієнт: жодного Intent/BlastRadius UI немає навіть як мокап (Showcase.tsx —
  це просто галерея UI-примітивів). `client/README.md:7` прямо називає
  "Blast/Brief" майбутнім, ще не збудованим модулем курсу.

Тобто це не "збудувати з нуля", а **"домонтувати" вже наявний каркас** —
контракти, БД, реєстр моделей вже узгоджені між собою, лишається: (1) реально
класифікувати, (2) прокинути в промпт рев'ю, (3) показати в UI.

Джерело: 3 Explore-звіти (server-wiring, reviewer-core, client UI) + 1 звіт
`planner`-агента, усі з `file:line`-доказами — деталі нижче взяті з них.
Зовнішні практики через `researcher` **не використовувались свідомо** —
внутрішній прецедент (`docs/agent-prompts/choosing-a-model.md`, дефолт
`deepseek/deepseek-v4-flash` уже використовується для `onboarding`;
детермінований `scoreFromFindings()` замість довіри до self-report моделі)
достатньо сильний і прямо застосовний, зовнішнє дослідження нічого б не
додало.

## Архітектурні рішення (уже прийняті в цьому плані, не переобговорюємо)

1. **Confidence обчислюється детерміновано на сервері, не як self-report
   моделі.** Це той самий принцип, що й `scoreFromFindings()` — рахунок ніколи
   не довіряється моделі, перераховується з ґрунтованих findings
   (`reviewer-core/INSIGHTS.md`, "Mechanical grounding gate", 2026-07-31).
   Тир визначається тим, **які сигнали реально були доступні**:
   - **High (~0.85–0.95):** знайдено й успішно прочитано посилання на
     план/спеку АБО є linked ticket із змістовним body.
   - **Medium (~0.55–0.7):** є PR description (>~40 символів змісту), але без
     плану/спеки/тікета.
   - **Low (~0.2–0.35):** опису немає — intent виведено лише з diff
     (список змінених файлів / diff-stat). Це прямо покриває вимогу
     "якщо опису немає — з непрямих даних і нижча впевненість".
   Промпт класифікатора **не просить модель саму оцінювати confidence** —
   лише сервер призначає тир.
2. **Тригер (уточнено користувачем):** **lazy при першому відкритті PR +
   ручний refresh через UI**, рев'ю лише перевикористовує вже обчислений
   intent. Конкретно:
   - Перший `GET /pulls/:id` detail-view (тобто коли користувач відкриває
     PR) → хук `usePrIntent` викликає `GET /pulls/:id/intent`. Якщо рядка в
     `pr_intent` ще нема — сервіс обчислює **інлайн** (compute-if-missing),
     персистує, повертає. Якщо вже є — просто повертає кеш, без
     перерахунку. Це і є "при відкритті PR": у цьому застосунку немає
     push-подій/webhook'ів (`pulls/service.ts`: "local-first... review is
     manual"), синк PR — pull-based, тож "відкриття" з точки зору сервера —
     це перший detail-запит.
   - Кнопка **"Refresh"** в `IntentCard` → `POST /pulls/:id/intent/refresh`
     — форсує перерахунок незалежно від кешу (напр. після того, як автор
     доповнив опис).
   - `run-executor.ts` перед збіркою промпту **не рахує заново** — читає
     персистований `getIntent(prId)`; якщо його справді ще нема (рев'ю
     запущено без попереднього відкриття PR, напр. через API), рахує
     inline той самий раз, аналогічно GET-шляху, через ту саму спільну
     функцію.
   - Усі три точки виклику йдуть через один спільний
     `getOrComputeIntent(container, workspaceId, repo, pull, { force })` у
     `server/src/modules/reviews/intent.ts` — щоб логіка тіру/сигналів/
     path-guard існувала в одному місці. При будь-якій помилці — лог і
     `undefined` (рев'ю продовжується без секції intent, GET повертає
     останній кеш або 404).
3. **UI:** нова картка `IntentCard` в існуючому Overview-табі
   (`OverviewTab.tsx`), без нового табу — Blast Radius/Risks/History
   залишаються поза скоупом.
4. **`linked_issue` (тікет) сьогодні НЕ персистується в БД** — це live-поле,
   яке `PullsService.getDetail` отримує прямим викликом VCS-адаптера
   (`server/src/modules/pulls/service.ts:120-164`), а `PullRow`
   (`db/rows.js`, те, що бачить `run-executor.ts`) його не містить —
   підтверджено (`grep linked_issue server/src/db` — 0 збігів). Отже,
   `computeIntent` **повинен сам** зробити live-виклик
   `container.vcsFor(repo).getPullRequest(...)` за потреби тікета, а не
   очікувати його в `PullRow`.

## Поза скоупом (свідомо не робимо)

- Blast Radius, Risks, PR History, Smart Diff (інші частини `PrBrief`) —
  окремі майбутні лекції курсу.
- Інтеграція з зовнішніми трекерами (Jira/Linear) — тільки вже наявний
  GitHub/GitLab `linked_issue`.
- Eager-обчислення для ВСІХ PR під час `listForRepo`/`poll` (list-sync не
  тягне body/linked_issue) — обрано lazy-per-PR-detail замість цього
  (див. рішення 2 вище).
- Зміна резолву `agents.provider`/`agents.model` (інший, непов'язаний шлях).
- Виправлення того, що `SmartDiff` визначений, але не входить у `PrBrief`
  (`brief.ts:105-122`) — лише фіксуємо як знахідку, не чіпаємо.
- Виправлення розсинхрону дефолтів `conventions` (server: `deepseek-v4-flash`
  vs client: `gpt-5.4`) — лише фіксуємо, не чіпаємо.

---

## 1. Джерела даних

| Сигнал | Де вже береться | Що нове |
|---|---|---|
| PR title | `pull.title` → `taskLine(pull)` (`run-executor.ts:196`) | передати в `classifyIntent` |
| PR body/description | `pull.body`, вже йде в review-промпт (`run-executor.ts:219`) | передати в `classifyIntent`; джерело для regex-пошуку посилань на план/спеку |
| Linked ticket (title+body) | `IssueMeta` (`platform.ts:217-223`), fetch у GitHub/GitLab адаптерах (`octokit.ts:70,91,118`, `gitbeaker.ts:117,125,162`) — **живий виклик, не персистується** | новий live-виклик `container.vcsFor(repo).getPullRequest(...)` всередині `computeIntent` (best-effort) |
| Посилання на план/спеку | не витягується ніде | новий regex по PR body + ticket body: `**/specs/*.md`, `**/docs/**/*.md`, `docs/plans/**` (той самий "doc-root" патерн, що й у кореневому `AGENTS.md`); читання файлу — `container.vcsFor(repo).readFile(repo, path)` (**вже існує**, `simple-git.ts:135-136`, **без захисту від traversal** — треба додати guard) |
| Diff/changed-files fallback | diff вже завантажений раз на батч (`run-executor.ts:96-105`) | компактний diff-stat/список шляхів як low-confidence сигнал |

## 2. Послідовність викликів

Центральна точка — `getOrComputeIntent(container, workspaceId, repo, pull,
{ force }, log)` у новому `server/src/modules/reviews/intent.ts`. Три
виклики цієї ж функції, різні тригери:

**A. Lazy при відкритті PR** (`GET /pulls/:id/intent`):
1. Читає `repository.getIntent(prId)`. Якщо є і `!force` → повертає кеш,
   кінець (без LLM-виклику).
2. Якщо нема (перше відкриття) — рахує (кроки нижче), персистує, повертає.

**B. Ручний refresh** (`POST /pulls/:id/intent/refresh`): те саме, але
`force: true` — завжди рахує заново, навіть якщо кеш є.

**C. Запуск рев'ю** (`run-executor.ts`, один раз на батч, до циклу по
агентах): читає `repository.getIntent(prId)`. Якщо є — просто перевикористовує
(без LLM-виклику). Якщо нема (рев'ю запущено без попереднього відкриття
detail-сторінки) — рахує inline тим самим шляхом.

**Обчислення (спільне для A/B/C), обгорнуте в `runLog.step('Classifying PR
intent', ...)` коли викликається з run-executor:**
- Збирає сигнали: title, body, ticket (live `container.vcsFor(repo)
  .getPullRequest(...)`, бо `linked_issue` не персистується — див. рішення
  4), plan/spec excerpt (regex → path-guard → `readFile` → truncate ~20KB),
  diff-stat fallback.
- `resolveFeatureModel(container, workspaceId, 'review_intent')` →
  `container.llm(provider)`.
- Викликає `classifyIntent({ model, llm, title, description?, ticket?,
  planExcerpts?, diffStat?, sessionId })` з `reviewer-core` → повертає
  `{ intent, in_scope, out_of_scope }` (без confidence).
- **Детермінований тір confidence** (чиста функція `tierFor(signals)`):
  high/medium/low за правилами вище → додає `confidence`, `source`,
  `plan_refs`.
- Персистує через `repository.upsertIntent(pull.id, fullIntent)`.
- Повертає `Intent | undefined` (undefined при будь-якій помилці — GET тоді
  віддає попередній кеш або 404, run продовжується без intent).

**Далі, у рев'ю (крок C):**
3. Для кожного агента `runOneAgent` викликає
   `reviewPullRequest({ ..., ...(intent ? { intent } : {}) })` — той самий
   omit-when-empty контракт, що й `callers`/`repoMap`.
4. `reviewPullRequest` кладе `intent` у `promptParts`; `assemblePrompt`
   рендерить секцію `## PR intent` (через `wrapUntrusted`) → один LLM-виклик
   рев'ю → grounding gate → детермінований score (без змін).

**Graceful degradation:** помилка fetch тікета, читання плану/спеки,
LLM-виклику `classifyIntent`, чи персистування — ловиться, логується як
info/warn, виклик-джерело (GET/refresh/run) продовжується без нового intent.
Ніколи не валить run і не 500-ить GET.

**Захист від thundering herd:** якщо `GET .../intent` викликано вдруге поки
перше обчислення ще в польоті (напр. подвійний рендер на клієнті) —
`getOrComputeIntent` дедуплікує по `prId` через in-memory `Map<string,
Promise<...>>` в межах процесу (best-effort, не потрібен розподілений lock).

## 3. Зміни схеми

**БД** — `server/src/db/schema/reviews.ts`, таблиця `prIntent` (адитивно,
копіюємо ідіоми сусідньої `reviews`-таблиці, які вже імпортовані у файлі:
`doublePrecision`, `text`, `jsonb`, `now`):
- `confidence: doublePrecision('confidence')` — nullable.
- `source: text('source')` — `'spec' | 'ticket' | 'description' | 'inferred'`.
- `planRefs: jsonb('plan_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`)`.
- `createdAt: now()`, `updatedAt: timestamp(..., { withTimezone: true })`.
- `cd server && pnpm db:generate` → нова міграція → `pnpm db:migrate`.
  **Ніколи не редагувати SQL-міграцію руками.**

**Контракти** — обидві копії (`server/src/vendor/shared/contracts/brief.ts`
**і** `client/src/vendor/shared/contracts/brief.ts` — нагадування: це дві
незалежні копії без symlink, `INSIGHTS.md` 2026-08-04, редагувати руками
обидві):
- Нове `IntentExtraction = z.object({ intent, in_scope, out_of_scope })` —
  саме та форма, яку повертає модель (сьогоднішній `Intent`).
- `Intent = IntentExtraction.extend({ confidence: z.number().min(0).max(1),
  source: z.enum([...]).nullish(), plan_refs: z.array(z.string()).default([]) })`
  — той самий ідіом `confidence`, що вже є в `Finding.confidence`,
  `MemoryItem.confidence` (`findings.ts:57`, `knowledge.ts:110`).
- `PrIntentRecord = Intent.extend({ pr_id })` (`review-api.ts:60`)
  успадковує нові поля автоматично — перевірити typecheck.

## 4. API

- **`GET /pulls/:id/intent`** у `server/src/modules/reviews/routes.ts` →
  `service.getOrComputeIntent(prId, { force: false })`. **Compute-if-missing**
  (не просто читання!) — якщо кешу нема, рахує inline й повертає щойно
  обчислений результат. Порожній результат (обчислення теж не вдалось —
  напр. VCS недоступний) → **404**.
- **`POST /pulls/:id/intent/refresh`** — форсований перерахунок
  (`force: true`), та сама відповідь `PrIntentRecord`. Rate-limit за зразком
  `POST /pulls/:id/review` (`routes.ts` вже має `config: { rateLimit: { max:
  10, timeWindow: '1 minute' } }` — той самий ліміт тут, це теж LLM-виклик
  "по кнопці").
- Відповідь обох: `PrIntentRecord`, Zod response schema через
  `fastify-type-provider-zod`. Обидва в модулі `reviews` (не `pulls`) —
  `pr_intent` вже там; жодного `container.db` в routes.ts (onion-шар).

## 5. Зміни у prompt builder (`reviewer-core`)

- `prompt.ts`: новий слот `intent?: string` у `PromptParts` (untrusted,
  author-derived). У `assemblePrompt`, одразу після `## PR description`
  (`prompt.ts:106-108`) — `## PR intent` через
  `wrapUntrusted('pr-intent', intent)`, якщо непорожньо; запис у
  `assembly`-трейс (`?? null`, той самий патерн, що й інші слоти,
  `prompt.ts:129-138`). Порядок секцій: task → PR description → **PR
  intent** → Skills → memory → repo skeleton → project context → callers →
  diff. `INJECTION_GUARD` вже згадує "derived intent/scope"
  (`prompt.ts:18,26-28`) — текст guard-а міняти не треба.
- `review/run.ts`: `intent?: string` на `ReviewInput` (`:44-93`), прокинути
  в `promptParts` (`:130-139`). Grounding/scoring — без змін.
- Новий `reviewer-core/src/review/intent.ts` — `classifyIntent(input)`:
  будує власні messages (system просить **лише** `{ intent, in_scope,
  out_of_scope }`, явно без поля confidence), кожен untrusted сигнал
  (description, ticket body, plan/spec excerpt, diff-stat) через
  `wrapUntrusted()`, один виклик
  `input.llm.completeStructured<IntentExtraction>({ model: input.model,
  schema: IntentExtraction, ... })` — той самий injected provider, окрема
  дешева `model`. Той самий шаблон виклику, що й `run.ts:174-181`.
- `index.ts`: новий export-блок `classifyIntent` за зразком
  `reviewPullRequest`-блоку (`index.ts:37-47`).

## 6. Налаштування (Settings)

**Лише зміна дефолту в реєстрі**, нового UI не треба — `SettingsModels.tsx`
вже generically рендерить picker для будь-якого `FeatureModelId`,
персистує в `settings.feature_models`, читає моделі з
`useProviderModels("openrouter")`. Змінити `review_intent` дефолт з
`openai/gpt-4.1` на `openrouter` / **`deepseek/deepseek-v4-flash`**
(узгоджено з `onboarding`/`conventions`, "nearly free" за
`docs/agent-prompts/choosing-a-model.md`) у **трьох** місцях:
`server/.../platform.ts`, `client/.../platform.ts`,
`client/src/lib/feature-models.ts` (дзеркало).

## 7. UI

- Нова `IntentCard` під
  `client/src/app/repos/[repoId]/pulls/[number]/_components/.../IntentCard/`
  (стандартна структура: `IntentCard.tsx`, `.test.tsx`, `styles.ts`,
  `index.ts`). Перевикористовує вже наявні вендоровані примітиви (бачив у
  `Showcase.tsx`): `Card`, `Chip` (in/out-of-scope), `Badge` (source-тір),
  `ConfidenceNum`, `Markdown`, `EmptyState` (ще не обчислено).
- Новий хук `usePrIntent(prId)` у `client/src/lib/hooks/reviews.ts` →
  `getPrIntent` у `src/lib/api.ts` → `GET /pulls/:id/intent` (fetch-on-mount,
  бо ендпоінт тепер compute-if-missing — саме тут "оживає" lazy-тригер при
  відкритті PR). TanStack Query; 404 → `EmptyState`. Дотримується правила
  "дані тільки через хуки" (`client/AGENTS.md`).
- Другий хук `useRefreshPrIntent(prId)` — мутація на
  `POST /pulls/:id/intent/refresh`, інвалідує `usePrIntent`'s query key при
  успіху.
- `IntentCard` отримує кнопку **"Refresh"** (іконка refresh, disabled під
  час мутації) поруч із заголовком картки — викликає
  `useRefreshPrIntent`. Loading/error стан кнопки — окремий від
  loading-стану самої картки (перший показ vs. форс-рефреш).
- Рендер `<IntentCard>` в `OverviewTab.tsx`, біля існуючого блоку
  "Description".
- i18n-рядки в `client/messages/<locale>/*.json` — без inline-літералів.

## 8. Логування

Дві точки логування залежно від тригера:
- **Тригер C (запуск рев'ю)** — через наявний `RunLogger`/`runBus` (той самий
  механізм, що вже логує `buildCallersDigest` та інші best-effort кроки,
  `run-executor.ts:304-306`), потрапляє в run-трейс.
- **Тригери A/B (GET / refresh поза рев'ю)** — звичайний `req.log`
  (pino, Fastify) в межах `routes.ts`/`service.ts`, той самий рівень, що й
  інші мутуючі роути; в run-трейс не потрапляє, бо активного run немає.

Обидва шляхи логують ті самі події:
- **Start:** `runLog.step('Classifying PR intent', ...)` (C) або
  `log.info('computing PR intent', { prId, trigger })` (A/B).
- **Модель:** info з `{ provider, model }` від `resolveFeatureModel`.
- **Сигнали:** info — чи був linked ticket, скільки посилань на план/спеку
  знайдено vs успішно прочитано (і чому пропущено — розмір/traversal).
- **Success:** результат — обраний **тір + source**, latency, token/cost
  від `classifyIntent`.
- **Failure/fallback:** `warn`/`info` (ніколи `error`, що валить run) —
  "intent classification failed — proceeding without intent section".
- Нічого чутливого в логи не пишеться; PR/ticket текст — лише коротким
  summary, не дослівно.

## 9. Ризики

- **Prompt injection (високий):** PR body, ticket body, вміст
  плану/спеки — все контролюється автором PR. Усе йде в промпт **тільки**
  через `wrapUntrusted()`. `INJECTION_GUARD` явно каже: stated intent може
  впливати на rationale, але ніколи не занулює реальний finding
  (`prompt.ts:26-28`).
- **Path traversal (високий):** `GitClient.readFile` робить
  `join(clonePathFor(repo), path)` **без жодної перевірки**
  (`simple-git.ts:135-136`) — шлях береться з untrusted PR-тексту. Резолвер
  посилань на план/спеку **зобов'язаний**: відкидати абсолютні шляхи й `..`,
  `path.resolve` + перевірка, що результат лишається в межах clone root,
  обмежити до `**/specs/*.md` / `**/docs/**/*.md` / `docs/plans/**`,
  ліміт ~20KB, мовчки пропускати порушення. Юніт-тест з traversal-пейлоадами
  (`../../../../etc/passwd`) — обов'язковий.
- **Cost/latency:** максимум 1 LLM-виклик на перше відкриття PR (кешується
  назавжди, поки не натиснуть Refresh) + 1 на кожен Refresh-клік + 0 при
  запуску рев'ю, якщо кеш уже є. Обмежено дешевим дефолтом (~$0.0015/виклик)
  і rate-limit-ом на `POST /pulls/:id/intent/refresh` (10/хв, той самий
  ліміт, що й `POST /pulls/:id/review`) — захищає від спаму кнопкою. Усе
  best-effort, не блокує.
- **Зворотна сумісність:** `pr_intent` порожня й невикористовувана сьогодні
  → адитивна міграція безпечна.
- Дрібні знахідки поза скоупом (флагуємо, не чіпаємо): `SmartDiff` відсутній
  у `PrBrief`; розсинхрон дефолтів `conventions` між server/client.

---

## Кроки реалізації (Owned paths — для паралельних `implementer`-інстансів)

| # | Крок | Type | Owned paths | Залежить від |
|---|---|---|---|---|
| 1 | Контракти + дешевий дефолт | core/zod | `server/.../contracts/{brief,review-api,platform}.ts`, `client/.../contracts/{brief,review-api,platform}.ts`, `client/src/lib/feature-models.ts` | — (перший) |
| 2 | `pr_intent` колонки + міграція + repo-мапінг | backend | `server/src/db/schema/reviews.ts`, `server/src/modules/reviews/repository/pull.repo.ts`, `server/src/modules/reviews/repository.ts`, нова міграція | 1 |
| 3 | `classifyIntent` + `## PR intent` слот | core | `reviewer-core/src/review/intent.ts` (new), `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/index.ts` | 1 |
| 4 | `getOrComputeIntent` (сигнали + tier + кеш/force) + wiring в run-executor (тригер C) | backend | `server/src/modules/reviews/intent.ts` (new — спільна функція для A/B/C), `server/src/modules/reviews/run-executor.ts` | 1, 2, 3 |
| 5 | `GET /pulls/:id/intent` + `POST /pulls/:id/intent/refresh` (тригери A/B) | backend | `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/service.ts` | 4 (використовує `getOrComputeIntent`) |
| 6 | `IntentCard` + Refresh-кнопка + hooks + інтеграція | ui | `client/.../pulls/[number]/_components/.../IntentCard/*`, `client/src/lib/hooks/reviews.ts`, `client/src/lib/hooks/index.ts`, `client/src/lib/api.ts`, `OverviewTab.tsx`, i18n | 1, 5 |

**Субагенти:**
- `implementer` — виконує кроки 1-6 (кроки 4 і 5 можна паралельно, у 6 — свій
  інстанс). Кожен персистує план у `server/specs/intent-layer-plan.md`
  (ідемпотентно) як перший крок.
- `test-writer` — юніт-тести з таблиці вище: contract round-trip, `tierFor`
  тіри, path-guard traversal-кейси, route `app.inject`, `IntentCard.test.tsx`.
- `architecture-reviewer` — гейт перед мерджем: onion-межі нового route
  (без `container.db` в routes.ts), purity `reviewer-core` (жодного I/O в
  `classifyIntent`).
- `doc-writer` — після реалізації: `INSIGHTS.md` записи (reviewer-core:
  purity boundary для `classifyIntent`; server: intent pre-step + path-guard;
  корінь: two-copy contract edit), опційно короткий
  `reviewer-core/docs/` запис про новий prompt-слот.
- Перед PR — `pr-self-review` skill (блокує на CRITICAL), і окремий
  **security review** обов'язковий через untrusted-input + filesystem-read
  поверхню.

## Перевірка (end-to-end)

1. `cd server && pnpm typecheck && cd ../client && pnpm typecheck` — контракти
   компілюються з обох боків.
2. `cd server && pnpm db:migrate` — нова міграція застосовується без помилок
   на чистій БД.
3. `cd reviewer-core && npm test && npm run typecheck` — `classifyIntent` +
   `## PR intent` рендериться/пропускається коректно, wrapUntrusted працює.
4. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — hermetic
   unit (tierFor, path-guard, degrade-on-failure) + `pnpm exec vitest run
   -t '.it.test'` (testcontainers) — upsert/getIntent round-trip, route
   `GET /pulls/:id/intent`.
5. `cd client && pnpm test && pnpm typecheck` — `IntentCard` рендерить
   loaded/empty/error стани.
6. Ручна перевірка через `./scripts/dev.sh`:
   a. Відкрити (вперше) PR з description, що містить посилання на
      `docs/plans/*.md` → **без натискання Run Review** переконатись, що
      `IntentCard` вже показує quote + scope + confidence (lazy-тригер при
      відкритті, GET сам порахував і закешував — перевірити мережевий
      виклик стається рівно один раз, повторне відкриття не рахує заново).
   b. Натиснути **Refresh** в картці → переконатись, що йде новий
      LLM-виклик (лог/трейс), картка оновлюється.
   c. Запустити "Run Review" на тому ж PR → переконатись, що (i) НЕ було
      повторного LLM-виклику класифікації (кеш перевикористано), (ii) у
      run-трейсі є секція `## PR intent` в промпті рев'ю з тим самим
      intent, що в картці.
   d. Повторити (a) з PR **без** опису — переконатись, що `confidence`
      низький і `source='inferred'`, і що "Run Review" на ньому (без
      попереднього відкриття detail-сторінки) все одно рахує intent inline
      (fallback-компute у тригері C) перед збіркою промпту.
