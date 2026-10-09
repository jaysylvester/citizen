# Debug inspection without `eval()`

Target release: **2.0** (see [todo #1](../todo.md)).
Status: **Implemented and validated — 2026-10-09.** Independent of query parsing
([todo #8](url-query-params.md)) now that queries have their own scope.

Moved out of the query plan (pre-split step 6) on 2026-10-06. Review history is
in [url-query-params-history.md](url-query-params-history.md). Line references
are as of commit `1bfb0b2`.

## Problem

Before this repair, development `debug()` passed `params.url.ctzn_inspect` to
`eval()`. Executable expressions worked through path parameters; a probe
confirmed `Math.max(1,2)` ran. This was an existing path-based exposure.

The initial query plan would have expanded this control surface through decoded
query values. The selected separate `params.query` scope leaves debug controls
path-only, so this independent repair is no longer a shipping prerequisite for
query parsing. Query names cannot enable debug or replace a path expression.

## Decision

The maintainer approved replacing `eval()` with restricted property selection,
on the condition that object inspection keeps its end result. Arbitrary
JavaScript evaluation is the intentional compatibility limit: expressions such
as `Math.max(1,2)` and function calls no longer run. Document that limit.

## Specification

The resolver replaces `eval(params.url.ctzn_inspect)`, selects a value, and
passes it to the existing `util.inspect()` and HTML formatting path. The
implementation validates a complete property expression with the existing
Acorn dependency before reading any root or property. Literal string keys
(including JavaScript escapes) and nonnegative safe-integer keys are supported;
optional chaining and parenthesized expressions are rejected.

This is the resolver's grammar, not a change to path transport. The
`ctzn_inspect` path value remains URL-encoded: spaces, double quotes, and
Unicode characters are encoded, while raw backslashes normalize to slashes.
Literal JavaScript escapes work in direct resolver calls, but cannot be passed
through this URL control. Inspect the whole `params.query` map for keys with
spaces or Unicode; do not decode selector path values as part of this repair.

- Use an explicit map of the debug argument roots: `params`, `request`,
  `response`, and `context`. Do not resolve names from the function's lexical
  or global scope.
- Support literal property paths, including literal bracket keys and array
  indexes where existing object selection needs them. Keep the README's
  `params` and `params.session` selectors working, along with ordinary nested
  selection.
- Never execute function calls, computed expressions, assignments, or other
  JavaScript. Function values may be inspected but are never called.
- Reject `__proto__`, `constructor`, and `prototype` segments at every depth, in
  dot and bracket forms.
- Do not require own properties. Ordinary reads must keep accessor-backed
  fields such as `params.route.parsed.href`, `pathname`, and `searchParams`, and
  `request.socket.remoteAddress`. Getters run as part of ordinary reads on the
  existing debug objects; this is not a side-effect-free sandbox.
- A missing property keeps the existing `undefined` result. Malformed,
  executable, or disallowed selectors, and property reads that throw, produce a
  bounded debug diagnostic. They must not execute selector expressions, fail
  the request, or silently select a different object.

Keep development-only HTML debug gating, `ctzn_debug`, configured scope output
when no selector is supplied, depth and hidden-property settings, and the
escaped `<pre>` presentation.

Reuse the shared internal HTML escaper after `util.inspect()`, including for
selector diagnostics. Preserve literal entities such as `&lt;` as displayed
text and keep dollar sequences literal when inserting the debug wrapper.

Before landing, check representative existing selector forms and accessor
fields against the resolver, and resolve compatibility gaps rather than quietly
reducing useful inspection.

With todo #8, `ctzn_*` controls remain path-only. Query names are ordinary
`params.query` data; selectors may inspect that data once this repair lands.

## Validation

In development HTML responses, on a stable fixture:

- Compare inspection of `params`, `params.session`, nested values, literal
  bracket keys, and array indexes against the existing output and formatting.
- Check the URL getters (`href`, `pathname`, `searchParams`) and the socket's
  `remoteAddress` getter against direct property reads.
- Check depth and hidden-value settings, configured output without a selector,
  missing properties, and production-mode suppression.
- Preserve literal entity strings and all five HTML characters in inspected
  values and selector diagnostics; dollar sequences must not alter the page
  during insertion.
- Executable and malformed selectors, and blocked segments in dot and bracket
  forms, neither run code nor fail the request. Use a side-effect marker to
  prove a function-call selector does not run, and a throwing getter to prove
  read failures produce the bounded diagnostic.
- After todo #8, inspect query data through a path selector and verify query
  `ctzn_*` names cannot enable debug or replace a path selector.

Update the README's debugging section with the supported property-path grammar
and the removal of executable expressions, and add a CHANGELOG entry.

## Split-review log — 2026-10-06

The extracted plan retains approved selector behavior, accessor compatibility,
bounded failures, output settings, and path-first/query-later validation. The
debugger receives the original request params in `setPublicContext()`, so its
URL getter tests do not depend on todo #13's controller/view copy repair.
Clarified that forbidden execution means selector expressions, while trusted
getters may run during the ordinary reads already specified. This remains an
independent repair after the query-direction change. No runtime or test code was changed.

## HTML-escaping code review — 2026-10-07

The HTML-escaping follow-up already corrected debug formatting to use the
shared five-character escaper and replacement callbacks during insertion.
HTTP coverage checks configured output and selected request headers. Keep
those fixes when replacing selector evaluation; selector removal remains
pending.


## Scope cleanup — 2026-10-09

An earlier #8 implementation included this repair as a prerequisite. The
maintainer's separate-query direction no longer requires it; the implementation
and its resolver tests were removed while narrowing #8. At that stage the plan
remained approved and pending. The independent implementation below follows
the maintainer's subsequent request; query parsing stays separate.


## Independent implementation — 2026-10-09

Implemented `lib/debug.js` and replaced the server's debug `eval()` call with
`debugValue()` using the four explicit roots. The whole selector is
validated before reading properties, including decoded forbidden names in dot
and bracket forms. Ordinary getters remain available, function values remain
inspectable, and null/missing paths return `undefined`. Parse/grammar failures
and throwing property reads use fixed diagnostics without reflecting selector
text or private exception messages.

Unit coverage verifies roots, literal keys and indexes, inherited properties,
URL getters, Unicode escapes, rejected expressions without getter/function
side effects, and bounded read errors. HTTP coverage verifies both error
policies, URL/socket accessors, depth and hidden properties, unchanged escaped
formatting, current query scope inspection, inert query control names, and
production suppression. Configured debug output remains covered by the existing
HTML regressions. README, MIGRATION, CHANGELOG, todo, and related plans record
the implementation and intentional compatibility limit.

Validation on Node.js **24.13.1**: focused debug/HTTP checks pass **56 tests**;
`npm test` passes **134 tests**, with no failures or skips. ESLint passes for
changed runtime/test files and `git diff --check` passes. HTTP fixtures required
localhost access outside the execution sandbox. This adds no dependency, query
routing, cache metadata, allowlist policy, or class-copying repair.


## Review follow-up — 2026-10-09

Corrected the implementation record to name the exported `debugValue()`.
README and MIGRATION now distinguish the resolver's literal-key grammar from
the unchanged encoded-path transport: escaped keys work in direct calls, but
selectors containing spaces, double quotes, Unicode, or JavaScript escapes
cannot select decoded keys through the URL control. Inspect the whole query
map for those keys; no selector-specific path decoding was added.

The shared `debugScopes()` helper now builds request logs, post-response logs,
and configured HTML debug output. All three honor `debug.scope.query`;
request logs still omit context. A regression checks enabled/disabled scopes
in both hook logs and production suppression.

Validation on Node.js **24.13.1**: `npm test` passes **135 tests**, with no
failures or skips. ESLint passes for the changed runtime/test files and
`git diff --check` passes. Existing HTTP regressions retain query isolation,
special keys, caching, and selector behavior after the associated helper and
controller-copy cleanups.
