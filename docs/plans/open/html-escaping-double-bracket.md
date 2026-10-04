# Plan: Safe-by-default HTML escaping in template literal views

Target release: **2.0** (see `docs/todo.md` #2)
Status: **Breaking change — intended and acceptable for 2.0.**

## Problem

citizen's default view engine renders each view as a raw JavaScript template
literal. In [`lib/server.js`](../../lib/server.js) (`renderView`):

```js
let html = new Function(
  'config, cookie, form, local, payload, route, session, url, include',
  'return `' + fileContents + '`'
)(config, cookie, form, local, payload, route, session, url, include || {})
```

Every `${…}` interpolation is coerced to a string with **no escaping**. Any
attacker-influenced value placed in `local` by a controller — or reflected
directly from the always-attacker-controlled scopes (`url`, `form`, `payload`,
`cookie`) — is emitted verbatim, producing stored/reflected XSS.

## Goal

Make the default interpolation syntax **safe by default**: `${ expr }` escapes
its result, and a new explicit marker `${{ expr }}` opts out (raw). This is a
breaking change, which is acceptable for 2.0.

## Semantics

| Syntax        | Meaning                    | Output                          |
| ------------- | -------------------------- | ------------------------------- |
| `${ expr }`   | **Escaped** (safe default) | HTML-entity-escaped result      |
| `${{ expr }}` | **Raw** (explicit opt-out) | result emitted verbatim         |

Additional behavior:

- **`null` / `undefined` are preserved**, not coerced to empty string. `${x}`
  where `x` is `undefined` renders `undefined`, and `null` renders `null`, exactly
  as a raw template literal does today. Empty output must be the developer's
  explicit choice, not an assumption by the escaper.
- **Framework-trusted HTML passes through unescaped** via a `SafeString` brand
  (see below). citizen wraps include output as `SafeString`, so `${include._head}`
  stays raw with **no migration required for includes**.
- **No URL-context filtering.** `${{ }}` and `${ }` do HTML-entity escaping only.
  `href`/`src` scheme validation (`javascript:` etc.) is explicitly out of scope.

## Why a source transform (not a runtime tag function)

A runtime tag (`return $html\`…\``) can only see the *result* of each top-level
`${…}`. It cannot reach interpolations inside nested template literals — the
ubiquitous loop pattern — and would over-escape the developer's own markup:

```
${ local.items.map(x => `<li>${x}</li>`).join('') }
```

A source transform, by contrast, rewrites the view text before compilation and
can descend recursively into nested template literals, escaping the *leaf*
interpolation (`${x}`) while leaving the surrounding `<li>` markup intact. This
is validated — see the working prototype at
[`transform-prototype.mjs`](transform-prototype.mjs) (all cases below pass).

### The key semantic developers must understand

`${ expr }` escapes **the entire result of the expression**. So an expression
that *produces HTML* (a `.map(...).join('')` that builds markup, a ternary
returning tags, a helper that returns HTML) must use `${{ … }}`, or its markup
will be escaped into visible text. Value interpolations *nested inside* that raw
expression are still auto-escaped:

```
${{ local.items.map(x => `<li>${x}</li>`) }}
  outer markup: raw   ·   inner ${x}: auto-escaped
```

Mental model: **`${ }` = "output this value", `${{ }}` = "output this markup".**

## Implementation

### 1. The compiler (`compileTemplate`)

Two mutually recursive passes over the view source (prototype validated in
`scratchpad/transform-test.mjs`):

- **`transformBody(s)`** — walks template-literal text. On `${`, decides raw
  (`${{`) vs escaped (`${`), finds the matching close, recurses into the inner
  expression via `transformExpr`, then emits `${ inner }` (raw) or
  `${ $ctznEscape( inner ) }` (escaped).
- **`transformExpr(e)`** — walks JS expression text, finds nested template
  literals (backtick-delimited) and re-runs `transformBody` on their contents so
  their interpolations are transformed by the same rules.

Both must **skip string and template literals while brace-counting** so braces
inside strings don't corrupt the scan:

- `skipString` — jumps over `'…'` / `"…"`, honoring `\` escapes.
- `skipTemplate` — jumps over `` `…` ``, honoring `\` escapes and recursively
  skipping nested `${…}` (which may themselves contain strings/templates).

This scanner is the **critical, risky piece**. A naive regex or plain brace
counter is insufficient. It must be correct or it will either mangle valid views
or silently under-escape. Port the validated prototype and cover it with the
transform unit tests below.

Validated behavior (from the prototype):

```
${local.title}                                 -> ${$ctznEscape(local.title)}
${{local.html}}                                -> ${local.html}
${include._head}                               -> ${$ctznEscape(include._head)}      (raw at runtime via SafeString)
${url.page}                                    -> ${$ctznEscape(url.page)}
${{ items.map(x => `<li>${x}</li>`) }}         -> ${ items.map(x => `<li>${$ctznEscape(x)}</li>`) }
${ local.title + `}` }                         -> ${$ctznEscape( local.title + `}` )}   (brace-in-string handled)
```

### 2. The escape helper (`$ctznEscape`)

```js
const $ctznEscape = (v) => {
  if (v === null || v === undefined) return v   // preserve "null"/"undefined" coercion
  if (v instanceof SafeString) return v         // framework-trusted HTML, emit raw
  return String(v)
    .replace(/&/g, '&amp;')   // must be first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
```

- Covers text context and both single- and double-quoted attribute contexts.
- `null`/`undefined` pass through so the outer template literal coerces them to
  `"null"`/`"undefined"` (matches today's behavior; no empty-string assumption).
- Compiler-generated name (`$ctznEscape`) is deliberately collision-proof;
  developers never type it.

### 3. `SafeString` and include wiring

```js
class SafeString { constructor(v) { this.value = v } toString() { return this.value } }
```

Wrap include output as `SafeString` where it enters the view `include` scope —
primary choke point [`lib/server.js:1207`](../../lib/server.js#L1207)
(`context.include[item] = …output`). Audit sibling paths that assemble include
or error output (e.g. the error-view assignments around
[`lib/server.js:312`](../../lib/server.js#L312) /
[`:336`](../../lib/server.js#L336)) and cached include output (`cache.getRoute`)
so all trusted HTML entering a view scope is branded. Because only `include`-scope
values are wrapped, the final page string returned by `renderView` stays a plain
string (the HTTP writer is unaffected).

Optionally **export `SafeString` (or a `raw()` helper)** so models/helpers can
return trusted HTML that survives single-brace `${ }` interpolation, for cases
where the trust decision lives in JS rather than in the view.

### 4. Wire into `renderView`

In the `templateLiterals` branch of [`lib/server.js`](../../lib/server.js):

```js
new Function(
  '$ctznEscape, config, cookie, form, local, payload, route, session, url, include',
  'return `' + compileTemplate(fileContents) + '`'
)($ctznEscape, config, cookie, form, local, payload, route, session, url, include || {})
```

### 5. Compile once, cache the function

Today the view file is re-read and re-compiled on every render. The transform
adds cost, so cache the compiled `Function` keyed by view path, invalidated on
the same signal HMR already uses when a view changes. A performance win
independent of this feature; land it together.

## Migration (this is a breaking change)

Failure mode is **safe and visible**: an expression that produced HTML and is not
switched to `${{ }}` renders escaped tags as visible text — obvious in
development, not a vulnerability. What developers must change:

- **Expressions that emit markup** (loops building HTML, ternaries returning
  tags, helpers returning HTML): wrap in `${{ … }}`. Nested value interpolations
  inside then auto-escape.
- **Trusted HTML strings in `local`** (e.g. a CMS article body): switch to
  `${{ local.body }}`.
- **Includes**: no change — `SafeString` keeps `${include._x}` raw.
- **Plain value interpolations** (`${local.title}`, `${url.page}`,
  `${cookie.username}`): no change; they were the vulnerable case and are now
  escaped automatically.

There is no reliable way to auto-detect which `${…}` produce HTML, so migration
is manual; the visible failure mode makes it self-diagnosing. Provide a clear
migration section in the changelog/docs. Residual risk flips direction: the
danger is now a developer wrongly marking *untrusted* data as `${{ }}` raw —
call this out in the docs.

## Edge cases to document

- `${{a:1}}` (no spaces) is treated as the raw marker, not object interpolation.
  For an object literal use `${ {a:1} }` with spaces (renders `[object Object]`).
- Source transform shifts column offsets, so a syntax error inside a view is
  reported against the transformed source. Acceptable; note it.
- Unterminated/malformed interpolation: decide between throwing a clear compile
  error (preferred) vs. leaving the text untouched. Prototype throws.

## Testing

- **Transform unit tests** (the risky part): escaped `${x}`; raw `${{x}}`;
  nested loop `${{ items.map(x => \`<li>${x}</li>\`) }}` escapes the leaf; braces
  inside strings `${ x + '}' }`; nested template literal in the expression;
  multiple interpolations per line; `${include._x}` compiles to escaped call but
  renders raw via `SafeString`; malformed marker behavior.
- **Render/security tests**: XSS payloads in `local`, `url`, `form`, `cookie`
  are escaped via `${ }` and raw via `${{ }}`; includes render unescaped;
  `null`/`undefined` render as `null`/`undefined` (not empty).
- **Regression**: existing view render tests migrated to the new semantics; add
  cases proving trusted-markup expressions require `${{ }}`.

## Documentation updates (README)

- Views section: lead with the safe-by-default model — `${ }` escapes,
  `${{ }}` is raw; the "value vs markup" mental model; the loop example.
- Security subsection: what escaping does/doesn't cover; the URL non-goal;
  the reverse risk of over-using `${{ }}`.
- Update every example that renders data, and any example emitting markup from an
  expression, to the new syntax; note includes are unchanged.
- CHANGELOG: 2.0 entry flagged **BREAKING**, with the migration guide.

## Files touched

- `lib/server.js` — `compileTemplate` (+ `transformBody`/`transformExpr`/
  `skipString`/`skipTemplate`), `$ctznEscape`, `SafeString`, include-output
  wrapping, `renderView` wiring, compiled-function cache.
- `README.md` — views + security docs, example migration.
- `CHANGELOG.md` — 2.0 breaking entry + migration guide.
- Tests — transform + render/security coverage.
- `docs/todo.md` — check off #2 when done.

## Reference

Working prototype of the transform + escaper:
[`transform-prototype.mjs`](transform-prototype.mjs) (all seven validation cases
pass; run with `node docs/plans/transform-prototype.mjs`).
