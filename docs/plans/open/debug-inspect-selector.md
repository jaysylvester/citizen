# Debug inspection without `eval()`

Target release: **2.0** (see [todo #1](../todo.md)).
Status: **Approved; implementation pending.** Must land before query parsing
([todo #8](url-query-params.md)) ships.

Moved out of the query plan (pre-split step 6) on 2026-10-06. Review history is
in [url-query-params-history.md](url-query-params-history.md). Line references
are as of commit `1bfb0b2`.

## Problem

In development mode, [`debug()`](../../../lib/server.js#L1701) passes
`params.url.ctzn_inspect` to `eval()`. Executable expressions already work
through path input; a probe confirmed `Math.max(1,2)` runs. Path values cannot
contain `/`, `>`, braces, or spaces, which limits payloads. Once todo #8 decodes
query strings, the selector can be arbitrary JavaScript, and any page a
developer visits can send one to a local server, for example
`<img src="http://localhost:3000/?ctzn_debug=1&ctzn_inspect=…">`.

Excluding `ctzn_*` names from query parsing is not a substitute: path input
reaches the same `eval()`.

## Decision

The maintainer approved replacing `eval()` with restricted property selection,
on the condition that object inspection keeps its end result. Arbitrary
JavaScript evaluation is the intentional compatibility limit: expressions such
as `Math.max(1,2)` and function calls no longer run. Document that limit.

## Specification

Replace `eval(params.url.ctzn_inspect)` with a resolver that selects a value and
passes it to the existing `util.inspect()` and HTML formatting path.

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

Once todo #8 lands, `ctzn_*` controls work through both path and query syntax,
with path values taking precedence. Path and query selectors must then resolve
to the same value and produce equivalent output.

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
- After todo #8, repeat the selector checks through query syntax and with a
  conflicting query to confirm path precedence.

Update the README's debugging section with the supported property-path grammar
and the removal of executable expressions, and add a CHANGELOG entry.

## Split-review log — 2026-10-06

The extracted plan retains approved selector behavior, accessor compatibility,
bounded failures, output settings, and path-first/query-later validation. The
debugger receives the original request params in `setPublicContext()`, so its
URL getter tests do not depend on todo #13's controller/view copy repair.
Clarified that forbidden execution means selector expressions, while trusted
getters may run during the ordinary reads already specified. This remains a
shipping prerequisite for #8. No runtime or test code was changed.

## HTML-escaping code review — 2026-10-07

The HTML-escaping follow-up already corrected debug formatting to use the
shared five-character escaper and replacement callbacks during insertion.
HTTP coverage checks configured output and selected request headers. Keep
those fixes when replacing selector evaluation; selector removal remains
pending.
