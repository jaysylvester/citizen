# Plan: Default HTML escaping in template literal views

Target release: **2.0** (see [todo #2](../todo.md)).
Status: **Implemented and validated — 2026-10-07.**
The default-escaping breaking change remains intended and acceptable for 2.0.
The maintainer selected parser-backed compilation and final-result-once
escaping, then reduced the integration scope before implementation (see
[Scope reduction before implementation](#scope-reduction-before-implementation)).
The existing scanner is illustrative only; it must not be ported as a
production compiler.

Shipping dependency: this feature must land before todo #8's query parsing
ships. See the [query plan's prerequisites](url-query-params.md#shipping-prerequisites).

## Problem and scope

The default renderer in [lib/server.js](../../../lib/server.js) evaluates views
as raw JavaScript template literals. Interpolated request/application values
are emitted without HTML escaping. The new default must protect HTML text and
quoted ordinary attribute values while retaining explicit markup composition.

This feature applies to `templateLiterals` HTML output. Templates remain trusted
application JavaScript. It does not sandbox view code, sanitize raw HTML, filter
URL schemes, or provide JavaScript/CSS escaping. Unquoted attributes,
JavaScript-bearing attributes, and `<script>`/`<style>` content are outside the
protection contract; examples must use supported contexts. Third-party engines
retain their own semantics.

## Selected semantics

| Syntax | HTML output |
| --- | --- |
| `${expr}` | Evaluate the expression normally, then HTML-escape its final result once |
| `${{expr}}` | Explicit raw output; untagged markup templates inside it escape their value interpolations |
| `${include.name}` at the top level | Emit the rendered include without escaping |

- Preserve native template string coercion, including `null` and `undefined`
  becoming `null` and `undefined`, and existing type errors where applicable.
  Evaluate each expression and coerce its result only once.
- Escape `&`, `<`, `>`, `"`, and `'`, with ampersand first. Do not decode or
  sanitize application strings before escaping.
- Ordinary `${expr}` supplies the final escaping boundary. Nested JavaScript
  templates, JSON building, and other intermediate values inside that expression
  retain their native value semantics; do not escape them a second time.
- In `${{expr}}` markup builders, transform untagged nested templates so their
  ordinary interpolations escape their final values. A nested ordinary
  interpolation again owns its final boundary; nested raw markers are explicit
  bypasses. Normalize custom marker syntax inside ordinary expressions without
  adding extra escaping boundaries.
- Tagged templates are opaque: do not transform their strings or substitution
  expressions. An enclosing ordinary interpolation escapes the tag's result; an
  enclosing raw interpolation makes a trust choice. A raw marker inside a tagged
  template is a compile error.
- A top-level interpolation whose entire expression is a direct include
  reference (`include.name` or `include['name']`) compiles to raw output. Top
  level means directly in the view's own template, where `include` can only be
  the include scope; in HTML responses that scope holds framework-rendered
  include output. Include values stay plain strings. Any other include use,
  including a direct reference inside a nested template or a conditional,
  follows the ordinary rules and needs `${{…}}` to output markup.
- The raw marker requires an adjacent opening `${{` and adjacent closing `}}`.
  `${ {a: 1} }` is ordinary object interpolation. `${{a: 1}}` is interpreted as
  raw syntax and rejected if the enclosed expression is invalid.
- Malformed, empty, or unterminated interpolations fail compilation. Never
  render the original source raw or serve a previous compiled function instead.
- `text/plain` keeps native value output without HTML entities. Normalize the
  custom raw syntax for shared templates, but do not escape. JSON/JSONP
  serialization and third-party engines are unchanged.

Examples:

```js
${local.title}                          // one final HTML escaping operation
${ `${local.title}` }                   // also one final escaping operation
${ JSON.stringify({title: `${local.title}`}) } // intermediate data stays intact
${{local.trustedHtml}}                  // explicit trust decision
${include._head}                        // top-level include: raw
${{ local.showNav ? include._nav : '' }} // include elsewhere: explicit raw
${{ local.items.map(x => `<li>${x}</li>`).join('') }}
```

In the final example, list markup passes through and each `x` is escaped. Use
`.join('')`; arrays otherwise retain native comma-separated coercion. An
existing entity string such as `&lt;` becomes `&amp;lt;` when escaped once; the
compiler prevents extra boundaries, not the escaping of a literal ampersand.

## Implementation

### 1. Build the compiler and its grammar tests first

Add an independently testable internal module, proposed as `lib/template.js`.
Use Acorn as an explicit runtime dependency, pinned to an exact version in
`package.json` `dependencies`; do not rely on ESLint's transitive installation.
The repository does not commit `package-lock.json`, and applications never see
a library's lockfile, so the manifest is the only pin. Add a small parser
extension for raw interpolation markers, recording marker metadata and source
ranges while delegating JavaScript lexical and expression grammar to Acorn. A
regex or the current hand-written scanner must not be used to recognize
expression boundaries.

Parse in a function context matching the existing `new Function` renderer,
including its scope parameters. Preserve source text, escape sequences,
comments, regular expressions, and tagged templates. Resolve raw markers
through the parser; do not replace apparent markers inside strings or comments.
Emit source-range edits.

Transform according to the selected semantics:

- Ordinary interpolation: pass the entire parenthesized expression to the
  escape helper, conceptually `escape((expr))`. This preserves comma
  expressions, evaluation order, and side effects.
- Top-level direct include reference: leave as native interpolation.
- Raw interpolation: emit native interpolation, recursing into untagged markup
  templates within it.
- Inside an ordinary value expression: normalize raw markers only.

Pass the escape helper as an extra function parameter with a generated
`$ctzn`-prefixed name that differs from every identifier name in the parsed
view. Compare Acorn's decoded names rather than searching the source text:
`\u0024ctzn0` declares `$ctzn0` without containing that spelling. The
prototype's fixed `$ctznEscape` name is not collision-proof. `eval()` and
`with` within a view are outside the protection contract, just as explicit raw
output is; they resolve names at runtime, which compile-time name selection
cannot control.

Reject malformed raw closing markers instead of skipping the following byte.
Compile errors name the view path and include Acorn's line and column when
Acorn reports the error. Do not execute expressions during compilation.

Acorn's parser extension depends on its internal methods. Keep the extension
isolated and run the compiler grammar suite before changing the pinned
version. The official
[parser interface](https://github.com/acornjs/acorn/blob/master/acorn/README.md)
and [plugin documentation](https://github.com/acornjs/acorn#plugin-developments)
are the implementation references. A disposable adapter verified raw-marker
parsing feasibility; it is not the production compiler.

### 2. Keep the HTML escaper internal

Implement the five-character escaper in `lib/template.js` and export it from
that module for the error fallbacks in `lib/server.js`. Do not re-export it
from `index.js`; it is not part of citizen's public API. Coerce with native
template-literal conversion rather than `String()`, which accepts symbols that
interpolation rejects; `null` and `undefined` keep their text. The escaper
returns ordinary strings.

### 3. Integrate the renderer and memoize compiled views

In the `templateLiterals` branch of `renderView()`, resolve the view path with
the existing root-view and controller-view rules and read the file as today.
Select HTML or plain-text mode from `response.contentType`. Preserve the
existing view scopes (`config`, `cookie`, `form`, `local`, `payload`, `route`,
`session`, `url`, `include`) and development debug insertion. Final output
stays a plain string for encoding and response writing. Leave the third-party
engine branch, its arguments, and its `cache` flag unchanged.

Keep one memo slot per resolved view path and mode, holding the source text and
its compiled function. Reuse the function when the file's current text matches
the slot; otherwise compile, and store the result only on success. A changed
view can never reuse stale code, so the memo needs no invalidation, cache-clear
integration, or mode gating, and production keeps picking up view changes
without a restart, as it does today. Store only compiled functions, never
request values or rendered output.

### 4. Escape error fallback text

The error handler builds fallback markup directly from error stacks when an
error view is missing or rendering in the error chain fails. That output can
reach a layout through `route.chain.error.output`. When the response is
`text/html`, escape the stack text with the same escaper before concatenating
it into those wrappers; static markup stays raw. Other formats are unchanged.

## Migration and documentation

Update README views, includes, controller chaining/layouts, and error handling
documentation, plus `MIGRATION.md` and the 2.0 changelog:

- Ordinary data `${…}` remains the value syntax and now escapes HTML by default.
  Null/undefined output is unchanged; intermediate values are not pre-escaped.
- Markup-producing expressions and trusted HTML strings require `${{…}}`.
  A CMS/body string must already be trusted/sanitized by the application before
  choosing raw output; escaping is not HTML sanitization.
- Top-level `${include.name}` needs no change. Includes used anywhere else
  (conditionals, nested templates, concatenations) and chained output
  (`route.chain.*.output`, including the layout loop) need `${{…}}`.
- Values that reach a `${{…}}` result without passing through a template
  interpolation are emitted raw: ternary branches, `.join()` separators, and
  helper or model return values. Do not mechanically wrap untrusted string
  concatenations in the raw marker. The README's cookie greeting becomes
  ``${{ cookie.username ? `<p>Welcome, ${cookie.username}</p>` : '<a href="/login">Login</a>' }}``.
- Inside `${{…}}`, untagged templates are treated as markup, so a template used
  as a lookup key or comparison value there is escaped. Build such values
  outside the raw builder.
- `<script>` and `<style>` content is not entity-decoded: escaped output
  corrupts JSON and JavaScript strings there, and raw output is unsafe for
  untrusted data. Pass data through an attribute with ordinary escaping
  (`data-state="${JSON.stringify(local.state)}"`), or serialize it as JSON in
  the controller with `JSON.stringify(state).replaceAll('<', '\\u003c')`
  and output only that value with `${{…}}`. The replacement is safe only for
  serialized JSON, where `<` can occur only inside strings; it keeps
  `</script>` and `<!--` from ending or altering the script element.
- Use `.join('')` in array-based markup examples. Note that `${{a: 1}}` is now
  raw syntax; write `${ {a: 1} }` for an object.
- Audit scaffolded normal and error views and existing HTTP fixtures. Keep
  ordinary data escaping and make only deliberate trusted markup raw.

## Validation and completion criteria

Add focused `node:test` coverage in `test/template.test.js` before renderer
integration. Assert outputs and failures, not just printed generated source:

- HTML text and single/double-quoted ordinary attributes escape all five
  characters; explicit raw strings retain markup. Preserve null/undefined and
  coercion errors; check evaluation order and single evaluation/coercion with
  side-effect markers.
- Ordinary nested templates and JSON building escape only the final result.
  Raw loops and multiple nesting levels preserve markup with escaped values.
  Cover nested raw markers, ordinary/raw mixtures, and `.join('')`.
- A top-level direct include reference is raw; the same reference inside a
  nested template or conditional is escaped; include values remain strings.
- Comments, regexes versus division, escaped quotes/backslashes/backticks,
  literal escaped interpolation, object expressions, malformed/empty/unterminated
  raw markers, tagged templates, comma expressions, and helper-name collisions,
  including an escaped spelling such as `\u0024ctzn0`, behave according to
  the compiler contract. Malformed input fails with the view path and cannot
  emit raw output.
- The documented script-data pattern round-trips a `</script><script>` payload
  through `JSON.parse` without ending the script element early.
- Plain-text mode normalizes raw markers without escaping.
- The memo reuses a function for unchanged source, recompiles changed source,
  and never stores a failed compile or falls back to a previous function.

Extend the child-process scaffold in `test/cache-http.test.js`:

- Fresh and action-cached includes render raw at the top level; a layout with
  explicit raw chained output renders correctly; warm an action with a cold
  request cache.
- Missing and failing error views produce escaped fallback stack text in HTML;
  plain-text errors are unchanged.
- JSON/JSONP output is unchanged.
- In production, editing a view on an uncached route changes the next response
  without a restart.

Run the focused suites and `npm test`, including under Node.js 22, the minimum
supported version.

The query-string HTTP regression is a later cross-feature gate: once todo #8
is implemented, encoded query markup reaches the controller decoded but renders
as text through `${url.name}`, on initial and cached responses. Todo #2 can
land without query parsing; todo #8 cannot ship without this combined check.

## Files touched during implementation

- `lib/template.js` (new) — parser extension, compiler, escaper, and
  compiled-function memo.
- `lib/server.js` — renderer integration and escaped error fallback text.
- `package.json` — exact-version Acorn dependency.
- `test/template.test.js`, `test/cache-http.test.js` — compiler and HTTP
  coverage; preserve existing cache/config regressions.
- `test/config.test.js` — declare temporary config projects as ES modules so
  their existing checks also run on the minimum Node.js 22.0.0 runtime.
- `README.md`, `MIGRATION.md`, `CHANGELOG.md`, `util/templates/` — behavior,
  migration, and scaffold audits.
- `docs/plans/todo.md` — mark #2 complete only when acceptance checks pass.

## Readiness review evidence — 2026-10-06

The original plan was not ready to port. Disposable Node probes loaded the
prototype compiler without changing it and reproduced the following:

| Finding | Observed result | Selected correction |
| --- | --- | --- |
| Escaped interpolation `\${local.title}` | Literal text changed to mention the helper | Parser preserves escaped template text |
| Regex/comment braces or a comment backtick | Valid expressions fail compilation | Parser handles JavaScript grammar |
| `${{local.title}X` | Drops `X` and emits unescaped HTML | Reject malformed raw delimiters |
| Ordinary nested template / JSON data template | Double-escaped intermediate values | Escape ordinary final results once |
| `${ 1, local.title }` | Renders `1` instead of the final expression value | Parenthesize the complete helper argument |
| A callback binding named `$ctznEscape` | Nested escaped output becomes raw through an identity function | Generate a helper name absent from the view's decoded identifiers |
| Copy/extend of `SafeString` | Brand lost; view emits `[object Object]` | No runtime wrapper; top-level include references compile to raw output |

The seven existing demo examples execute but have no assertions. Run them with
`node docs/plans/open/transform-prototype.mjs`; their success does not validate
production parsing. A disposable Acorn extension parsed the previously failing
regex/comment, escaped-marker, object, sequence, and nested-loop forms while
rejecting invalid raw closing markers. It demonstrated feasibility without
implementing the production compiler or changing dependencies.

Repository review also found missing contracts for the shared HTML/plain-text
branch, layout `route.chain.*.output`, and direct error fallback markup; those
are included above. Compiled-function caching is now a source-keyed memo (see
the decision log). The [prototype](transform-prototype.mjs) remains historical
demonstration code. At this review stage, the implementation plan was ready;
the prototype and runtime feature had not passed production acceptance or
been implemented. See [Implementation completion](#implementation-completion)
for the subsequent implementation and validation.

## Decision log

### Query parsing shipping dependency

Date: **2026-10-06**. During todo #8 review, the maintainer agreed that default
HTML escaping must land before query parsing ships, because decoded query
values can contain literal markup. Added the dependency note and cross-feature
HTTP regression above. The escaping syntax and renderer implementation scope
are unchanged. The rationale and acceptance requirements are recorded in the
[query plan's decision log](url-query-params-history.md#html-escaping-selected-as-a-shipping-prerequisite).

Reference maintenance on **2026-10-06**: corrected relative server-code links
for this plan's current `open/` directory depth. The renderer scope and earlier
decisions are unchanged.

### Implementation readiness review and selected compiler policy

Date: **2026-10-06**. The maintainer requested a readiness review. Probes
reproduced malformed raw input accepted as HTML, grammar/escape failures,
double escaping, incorrect sequence results, helper-binding shadowing, and lost
trust brands. The original seven demos contain no assertions; claims that they
validate a production compiler were removed. Runtime and prototype code remain
unchanged.

The maintainer selected **a runtime parser dependency** and **one final escaping
operation for ordinary interpolation**, with recursive value escaping limited
to explicit raw markup builders. The revised plan uses an isolated Acorn
adapter and source-range edits; the temporary parsing probe established that
this direction handles the observed grammar cases. Pin the tested parser and
require compiler acceptance tests before renderer integration. Tagged-template
semantics, native coercion, sequence expressions, and generated-binding hygiene
are explicit correctness requirements.

The review placed include branding at the final HTML render boundary because
copy/extend erase class brands, while cached/stored output must remain ordinary
strings/data. It specified HTML/plain-text and third-party-engine separation,
safe direct error fallback construction, private compiled-function caching with
full/route invalidation, and migration of chained layout output and unsafe
markup concatenations. A public raw-value API is deferred. These requirements
close integration gaps without broad class-copying, watcher, or route-key work.

The plan was reconciled around those contracts, obsolete prototype/todo paths
were corrected, and meaningful compiler/render/cache coverage and file ownership
were added. The original default/raw syntax, null/undefined behavior, and todo
#8 shipping dependency remain selected. #2 can land independently; #8's later
combined query regression remains required before #8 ships. The status now
means the implementation plan is ready, not that the old scanner or runtime
feature has passed production acceptance.

### Scope reduction before implementation

Date: **2026-10-06**. A pre-implementation review found that the runtime
include wrapper would change `include.*` from strings to objects in view code
(`.length` undefined, string methods throwing), and that invalidating compiled
views on route clears would also flush them on every route-cache expiry,
because expiry timers call the same `clear({ route, contentType })` path. The
maintainer judged the integration scope to be growing faster than the feature
and accepted a reduced design:

- Direct top-level include references compile to raw output. This replaces the
  private trust wrapper and render-local include map; include values stay
  strings. Includes used elsewhere need `${{…}}`.
- Compiled functions are memoized per view path and mode by source text. This
  replaces cache-clear invalidation, the invalidation generation, watcher
  checks, and the production cache lifecycle. Files are still read on every
  render, as before.
- Acorn is pinned by exact version in `package.json`, because
  `package-lock.json` is intentionally not committed.
- Removed: rejecting `with`, runtime config-change cache tests, and source
  locations beyond those Acorn reports. Not added: a public escape function or
  error-fallback changes beyond escaping HTML responses.
- Added to the migration documentation: `<script>`/`<style>` content and
  raw-builder caveats.

The selected syntax, final-result-once escaping, raw-builder recursion,
tagged-template handling, fail-closed compilation, plain-text behavior,
error-fallback escaping, and the todo #8 dependency are unchanged. This entry
supersedes the include-branding and compiled-cache parts of the readiness
review entry.

### Deferred-work tracking

Date: **2026-10-07**. The possible public trusted-HTML/raw-value API from the
readiness review is now visible under Consider #17 in
[the todo list](../todo.md). It remains a separate proposal. The selected #2
design keeps include values as strings and uses `${{…}}` for explicit raw
output; no brand, public helper, or removed cache-invalidation design is added
back to this implementation plan.

### Implementation review corrections

Date: **2026-10-07**. A coding-agent review, checked with disposable Node and
Acorn probes, found three plan defects; the selected semantics and reduced
scope are unchanged:

- The script-data guidance had lost its backslash during an edit and read as
  replacing `<` with `<`. It now gives
  `JSON.stringify(state).replaceAll('<', '\\u003c')`, limited to
  serialized JSON, with a `</script>` round-trip regression.
- Choosing the helper name by literal source search missed escaped identifier
  spellings; a probe binding `\u0024ctzn0` to an identity function produced
  unescaped output. Selection now compares decoded identifier names, and `with`
  joins `eval()` outside the protection contract.
- The escaper was described as unexported although the error fallbacks need it.
  It is now an internal `lib/template.js` export, not public API.

### Implementation completion

Date: **2026-10-07**. Implemented the selected scope in `lib/template.js` and
`lib/server.js`, with Acorn **8.11.3** pinned as a direct runtime dependency.
The isolated parser adapter records raw delimiters while Acorn parses all
expressions. Source edits enforce final-result-once escaping, raw-builder
recursion, tagged-template opacity, direct top-level include output, decoded
identifier hygiene, and native coercion. The internal escaper is shared by all
HTML error fallback paths without adding a public API.

Compiled functions are memoized per path/mode against the source read for each
render. HTTP tests confirm production edits take effect without restarting,
invalid edits fail rather than serving stale output, fresh/cached includes
remain strings, and configured layouts and both cache layers retain correct
HTML. Plain-text, JSON/JSONP, development debug insertion, and normal/error
scaffolds are covered. Scaffold templates already used ordinary data
interpolation throughout; no raw conversions were necessary.

README examples, the migration guide, and the 2.0 changelog document the
breaking default, deliberate raw composition, and supported contexts. The
script-data test executes the serialization examples read from the public
documentation and verifies removal of literal `<` and JSON round-trip behavior.

Validation: **113 tests passed** with the complete suite on both
**Node.js 22.0.0** and **24.13.1**. ESLint passed for the changed runtime and
test files, and `git diff --check` passed. The minimum-version run exposed
configuration fixtures lacking a package `type: "module"`; adding that marker
to their temporary projects resolved the existing fixture failures without
changing runtime configuration behavior.

A separate integration probe found that string-form `next` handoffs replace
the next view's route with a fresh route whose chain is empty. The configured
layout path is covered here; the existing handoff defect is recorded as todo
#15 and is outside this feature's implementation. Todo #2 is complete. The
combined decoded-query regression remains todo #8's later shipping gate.
