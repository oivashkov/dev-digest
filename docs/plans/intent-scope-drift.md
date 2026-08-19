# Intent Layer — confidence-tier fix + scope-drift advisory

> Реалізовано 2026-08-19 (гілка `lab03-intent-scope-drift`, від `lab03` —
> та сама база, куди змерджено `docs/plans/intent-layer.md` та
> `docs/plans/smart-diff.md`).
>
> Це не нова фіча "з нуля" — це двоє покращень до вже змердженого Intent
> Layer, знайдені під час ретроспективного рев'ю (внутрішнє дослідження
> коду + зовнішнє дослідження через `researcher`-агента: як CodeRabbit,
> Sourcery, PR-Agent/Qodo, Greptile та академічна робота ARCTIC
> (arXiv:2607.29516) підходять до PR-intent і drift-детекції).

## Контекст

Ретроспективний рев'ю Intent Layer (`docs/plans/intent-layer.md`) виявив дві
речі, які варто виправити без переписування самої фічі:

1. **`ConfidenceNum`-пороги не збігаються з тірами `tierFor()`.**
   `client/src/vendor/ui/primitives/ConfidenceNum.tsx` фарбує крапку green
   ≥85%, amber ≥65%, інакше — сірий muted. `tierFor()`
   (`server/src/modules/reviews/intent.ts:102-107`) видавав medium-тір як
   `0.6` (60%) — нижче amber-порогу, тож medium ("є опис PR") і low ("лише
   diff-stat fallback") рендерились **однаковим сірим кольором**, хоча
   семантично це різні рівні довіри.
2. **`out_of_scope` нічого не робить деterministично.** Модель повертає
   список фраз "чого PR НЕ торкається", але ніщо не звіряє це твердження з
   реально зміненими файлами. Академічна робота ARCTIC (backtranslation
   diff → NL-опис, порівняння з intent, ординальний drift-скор 0-100)
   підтвердила, що сам факт **показу** drift-сигналу автору статистично
   значуще зменшує drift у наступних PR (p=0.026) — навіть без впливу на
   severity findings. Водночас її ж дані показують, що точність різко падає
   саме в неоднозначних "moderate drift" випадках (F1 0.341 проти 0.889 на
   очевидних) — застереження проти over-engineering цього сигналу.

Джерело: внутрішнє прочитання `intent.ts`/`IntentCard.tsx`/
`ConfidenceNum.tsx`/схеми `pull_requests` + один `researcher`-звіт
(зовнішні джерела нижче в §2).

## Архітектурні рішення

1. **Поріг medium-тіру: `0.6` → `0.7`.** Лишається в межах уже
   задокументованого діапазону "~0.55–0.7" (`docs/plans/intent-layer.md`,
   "Архітектурні рішення" п.1) — не новий число з повітря, а верхня межа
   того самого банду, обрана конкретно щоб перетнути `ConfidenceNum`-поріг
   ≥65%. **Компонент не чіпаємо** — `client/src/vendor/ui/**` вендорований
   (`AGENTS.md`, "Do not touch"), тож фікс — на боці даних, не UI.
   `server/src/modules/reviews/intent.ts:102-107` (+ коментар із
   обґрунтуванням).
2. **Scope-drift — детермінований, без нового LLM-виклику, лише advisory.**
   На відміну від ARCTIC (яка робить окремий LLM-виклик для backtranslation),
   тут — чисте лексичне зіставлення токенів шляху файлу проти токенів фрази
   `out_of_scope` (той самий "без LLM, детерміновано, тестовано" принцип, що
   й `SmartDiff`'s `classifyFile`, `docs/plans/smart-diff.md` §2). Свідомо
   грубо: жодного semantic understanding, жодного stemming — false negatives
   безпечніші за false positives для сигналу без grounding-гейту позаду
   (на відміну від `Finding`, яку перевіряє `groundFindings()`). **Ніколи не
   підвищує severity finding** — той самий принцип, що й `INJECTION_GUARD`
   ("stated intent може впливати на rationale, ніколи не занулює finding") —
   тут дзеркально: drift не підвищує severity findings автоматично.
3. **`scope_drift` НЕ персистується на `pr_intent`.** Рахується наново на
   кожен `GET /pulls/:id/intent`, з поточного списку змінених файлів PR
   (`ReviewRepository.getPrFiles`) проти вже закешованого `out_of_scope`.
   Це дає побічний, безкоштовний бонус: `scope_drift` лишається актуальним,
   навіть коли сам закешований `intent`/`out_of_scope` устарів (автор
   відредагував опис PR, але ніхто не натиснув Refresh — відома, свідомо
   прийнята межа Intent Layer, `docs/plans/intent-layer.md` рішення 2).
   Жодної нової міграції/колонки — контракт розширює лише **транспортний**
   `PrIntentRecord` (`review-api.ts`), не персистований `Intent`
   (`brief.ts`), тому `pull.repo.ts`'s hand-built `Intent`-літерал
   (`upsertIntent`/`getIntent`) залишається незмінним — уникає повторення
   гочки з `INSIGHTS.md` 2026-08-18 ("розширення required output type ламає
   hand-built literals").

## Поза скоупом (свідомо не робимо)

- **Семантичний/LLM-based drift-скор** (як в ARCTIC) — окрема майбутня
  фіча, якщо взагалі. Поточна версія — навмисно найпростіший, найдешевший
  прохід.
- **Авто-ескалація severity findings на основі scope_drift** — ARCTIC-дані
  показують слабку точність саме в неоднозначних випадках; auto-escalation
  на неточному сигналі — гірше, ніж просто показати його.
- **Consistency-sampling для confidence** (запускати класифікатор 2-3 рази
  й дивитись на розбіжність) — жоден production-тул цього не робить
  публічно; academic-джерела натякають, що це могло б перевершити verbalized
  confidence, але це окремий, більший експеримент.
- **Хеш-based авто-інвалідація кешу intent** при зміні title/body PR —
  окрема ідея з того самого ретроспективного рев'ю, не входить у цей план.

## 1. Confidence-tier fix

`tierFor()` — один рядок + коментар (`intent.ts:105`). Оновлено 3 тестові
асерції на точне значення (`server/test/reviews-intent.test.ts`), які й так
уже документували діапазон, а не конкретне число як контракт.

## 2. Scope-drift — джерела

| Джерело | Зовнішнє дослідження |
|---|---|
| Немає production-вендора з публічно задокументованою over-delivery/scope-creep детекцією (PR-Agent/CodeRabbit роблять under-delivery ticket-compliance — протилежний напрямок) | CodeRabbit, Sourcery, PR-Agent docs |
| ARCTIC (arXiv:2607.29516) — найближчий прямий прецедент: backtranslation + ординальний drift-скор, QWK 0.907 проти людей загалом, F1 0.341 у "moderate drift" | arXiv 2607.29516 |
| Жоден вендор/папір не описує "класифікатор галюцинує scope, якого нема в diff" як окремий, виміряний failure mode | загальний висновок `researcher`-звіту |

## 3. Реалізація

- **`computeScopeDrift(files, outOfScope): ScopeDriftHit[]`**
  (`server/src/modules/reviews/intent.ts`, поруч із `tierFor`) — чиста
  функція, без I/O. Токенізація: camelCase-split + non-alnum-split +
  lowercase; фільтр токенів `< 4` символів і структурних сегментів
  (`index`, `utils`, `test`, ...); перший збіг фрази виграє на файл; кап
  15 хітів.
- **Контракт** (`server/.../review-api.ts` + дзеркало
  `client/.../review-api.ts`): новий `ScopeDriftHit = { file, matched_phrase
  }`; `PrIntentRecord` розширено `scope_drift: ScopeDriftHit[]` (default
  `[]`). `Intent`/`brief.ts` **не** чіпали.
- **Wiring**: `ReviewService.getOrComputeIntent` (`service.ts`) — після
  отримання закешованого/свіжого `Intent`, викликає
  `this.repo.getPrFiles(prId)` + `computeScopeDrift`, домішує в
  `PrIntentRecord`. `POST /pulls/:id/intent/refresh` отримує те саме
  безкоштовно (той самий метод).
- **UI**: `IntentCard.tsx` — новий advisory-блок (warn-тон, `var(--warn-bg)`,
  той самий токен, що вже використовує `SkillCard`/`RunHistory`) під
  `plan_refs`, рендериться лише коли `scope_drift.length > 0`. Заголовок +
  hint-текст, що explicit каже "не blocker". i18n: `brief.intent.scopeDrift.*`
  (`client/messages/en/brief.json`).

## Ризики

- **False positives/negatives неминучі** — це прямо задокументовано в
  контракті (`ScopeDriftHit`'s doc-comment) і в UI-тексті ("a lightweight
  path/phrase match, not a finding"). Жоден reviewer не повинен сприймати
  порожній `scope_drift` як "drift відсутній", лише як "евристика нічого не
  знайшла".
- **Зворотна сумісність:** `PrIntentRecord` розширення — адитивне
  (`.default([])`), існуючі відповіді без змін крім нового поля;
  `Intent`/`pr_intent` не чіпали → нуль ризику міграції.

## Перевірка

1. `cd server && pnpm typecheck && cd ../client && pnpm typecheck` — обидва
   чисті.
2. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — 191/191
   (13 нових тестів `computeScopeDrift`, 3 оновлені асерції `tierFor`).
3. `cd server && pnpm exec vitest run .it.test` — 71/71, включно з новим
   `"scope_drift is computed fresh..."` — підтверджує, що `scope_drift`
   оновлюється між двома `GET`-запитами без нового LLM-виклику, коли між
   ними додався файл.
4. `cd client && pnpm test` — 93/93, включно з новим `IntentCard`-тестом
   (advisory-блок рендериться лише коли є хіти).
5. `pr-self-review` перед пушем.
