# URL query parameter plan: review and decision history

> **Historical snapshot, 2026-10-06.** This is the full query plan as it stood
> before its scope was split. The current plan is
> [url-query-params.md](url-query-params.md). Existing-behavior repairs found
> during review moved to their own plans and todo entries:
> [debug selectors](debug-inspect-selector.md),
> [JSONP callbacks](../open/jsonp-callback-validation.md),
> [direct-request redirects](../open/direct-request-redirects.md),
> [object `next` cache keys](../open/object-next-cache-key.md), and the URL-copy bug
> (todo #13). Where this snapshot conflicts with those documents, they take
> precedence. Step numbers, status lines, and "this plan" references below
> describe the pre-split document.

Target release: **2.0** (see [todo #8](../todo.md)).
Status: **Reviewed; first and second reviews reconciled. Implementation
pending.** The [second review](#second-review--2026-10-06) findings S1–S7 have
selected dispositions. Object next retains existing route fields with a separate
action key; action insertion validates only its own route's input names. The
[current dispositions](#current-dispositions) take precedence over historical
status statements in the append-only decision log.
The behavior below is proposed for implementation. R1 and R5 are resolved,
R3 is exploratory, R4's hit-time check
is excluded, and the R6 and R7 bug fixes are included. R2's nonfatal warning
policy is selected, and optional allowlist-based query-key filtering is
exploratory. HTML escaping (todo #2) is a shipping prerequisite. Replacing debug
`eval()` is included, with inspection compatibility required. JSONP callback
validation and nonfatal 400 responses are included. Direct requests will skip
`next` and the default layout while honoring redirects. The current
[review findings](#review--2026-10-06) have selected dispositions; exploratory
items remain outside completion criteria. Todo #12 is a dependency for
forced-JSONP integration acceptance, as specified in the landing order.

## Goal

Parse traditional query strings into `params.url` so redirects from external
APIs work without application parsing workarounds. Apply the existing cache
`urlParams` allowlist to query names. Request caches distinguish full URLs;
action and include caches distinguish their own route pathnames and queries.
Object next without an explicit route uses an identity derived from its selected
controller/action while preserving the original route fields in its API.

For example, `/callback?code=abc&state=xyz` should supply:

```js
params.url = { code: 'abc', state: 'xyz' }
```

## Shipping prerequisite: HTML escaping

Complete todo #2's [HTML escaping plan](html-escaping-double-bracket.md) before
shipping todo #8. Its default `${…}` interpolation escapes HTML, while
`${{…}}` explicitly emits raw output. Query parsing makes decoded markup
available to views, so this feature must ship with that output protection in
place rather than relying only on documentation of the current raw rendering.

Keep query values decoded and unchanged in `params.url`; escaping belongs at
the HTML output boundary. Require a request-level regression showing that
query-supplied markup remains available to the controller but renders as text
through ordinary `${url.name}` interpolation. This dependency does not expand
todo #2 into URL-scheme validation or make explicit raw interpolation safe for
untrusted data.

## Current behavior

- [`lib/router.js`](../../../lib/router.js) constructs a WHATWG `URL`, but
  `getUrlParams()` reads only its pathname. `parseRoute()` also derives the
  action, descriptor, and direct-request flag from those path parameters.
- [`serve()` in lib/server.js](../../../lib/server.js) assigns
  `route.urlParams` to `params.url`; controllers, hooks, and views therefore
  cannot access query values through that scope.
- String `next` and `include` directives call `parseRoute()` with a replacement
  route. Their parameters extend the original request's path parameters.
- Request-cache lookup and insertion already use `parsed.href`, including the
  query string. Action-cache lookup and insertion use only `pathname`, including
  action caches for includes.
- `cacheRoute()` checks `Object.keys(options.params.url)` against an optional
  allowlist. It exempts the original controller's name to accommodate a path
  descriptor; a query with that name would inherit the exemption if parsing
  were added without revising validation.

## Proposed parameter behavior

| Input | Result |
| --- | --- |
| `/article?id=237&page=2` | `{ id: '237', page: '2' }` |
| `/article/id/237?page=2` | `{ id: '237', page: '2' }` |
| `/article/id/237?id=999` | `{ id: '237' }`; the path value wins |
| `/article?tag=first&tag=last` | `{ tag: 'last' }`; the last query value wins |
| `/article?label=two+words&literal=%2B` | `{ label: 'two words', literal: '+' }` |
| `/article?empty=&flag` | `{ empty: '', flag: '' }` |
| `/article?filter%5Bid%5D=237` | `{ 'filter[id]': '237' }`; names stay flat |
| `/article?action=edit` | `{ action: 'edit' }`; selects `edit()` |
| `/article/action/edit?action=review` | `{ action: 'edit' }`; the path selects `edit()` |
| `/article?article=new-title` | `{ article: 'new-title' }`; sets the descriptor to `'new-title'` |
| `/article/old-title?article=new-title` | `{ article: 'old-title' }`; the path descriptor wins |
| `/article?direct=true` | `{ direct: 'true' }`; skips `next` and the default layout; honors redirects |

Use the existing `url.searchParams` iterator for query decoding. It supplies
ordered name/value pairs, and requires no dependency. See the
[Node URLSearchParams documentation](https://nodejs.org/api/url.html#class-urlsearchparams).
Decode query names and values once, retain strings without type coercion, and
follow the native parser's handling of malformed escapes. Preserve existing
path parsing, including its current encoding behavior.

Accept query names as literal, case-sensitive keys, including dots, brackets,
and empty names. Do not apply the path-name regular expression or expand names
into nested objects. Repeated names remain scalar to match the existing URL
scope; callers needing every occurrence can use `params.route.parsed.searchParams`
after the URL-copy bug described below is fixed. These entries reflect the
query in that route's parsed URL, rather than an aggregate of inherited inputs.

Parse both sources, then merge query parameters followed by path parameters.
Path values win collisions; query parameters supply values absent from the
path. The last occurrence of a repeated query name wins within the query.
This preserves the behavior explicitly expressed in an application URL when a
third party appends a conflicting query, while supporting traditional URLs
that supply parameters entirely through the query.

Treat both URL syntaxes consistently when assigning framework fields:

- Select `controller` from the pathname.
- Derive `action` from the merged `action` parameter, defaulting to `handler`.
  `/article?action=edit` and `/article/action/edit` both select `edit()`.
  `/article/action/edit?action=review` still selects `edit()`.
- Derive `descriptor` from the merged parameter named after the controller,
  defaulting to an empty string.
- Derive the parameter-based `direct` flag from the merged `direct` parameter.
  Preserve the underscore-path rule: `/_article` remains a direct request even
  when its query has an empty `direct` value. Keep the existing defaults and
  truthiness semantics; this feature does not introduce boolean coercion.
  Limit the flag's effect to skipping `next` and the default layout; hook and
  controller redirects still apply, including on cache hits (step 8).

The reserved names `action` and `direct` have the same framework meaning in
both syntaxes. A query cannot override an explicit path value, but a previously
ignored query can now supply an application or framework parameter absent
from the path. Document that compatibility impact for 2.0.

Keep development debug controls available through both URL syntaxes, subject
to the same path precedence. Replace executable `ctzn_inspect` expressions
with restricted object/property selection as specified in step 6; retain the
documented inspection results and presentation.

## Landing order

Land the existing-behavior repairs separately, with focused regressions and a
CHANGELOG entry for each, before adding query parsing. They remain selected
parts of this plan; separate landing does not defer them out of scope.

1. Repair URL copying (R6), verifying independent URL/searchParams access.
   Land narrow URL-map copying repairs where their regressions justify them.
2. Repair object-next action identity (R7/S1), preserving the selected route API.
   Establish a shared action-key mechanism that query isolation can extend.
3. Replace debug evaluation (step 6), including accessor-backed inspection
   compatibility after the URL-copy repair.
4. Land todo #12's forced-content-type header fix before JSONP's forced-format
   HTTP acceptance checks. Keep that fix independently reviewed under todo #12;
   it is a dependency, not a response-negotiation redesign in todo #8.
5. Land JSONP callback validation (step 7), including forced format, correct
   Content-Type, and nonfatal rejection on misses/hits.
6. Land the direct-request redirect repair (step 8), preserving chain/layout
   skipping and verifying conditional-response behavior.
7. Land todo #2's default HTML escaping and its own acceptance checks. It may
   proceed independently of the repairs above.
8. Land query parsing, provenance, parameter inheritance, the selected
   insertion-name policy, query-aware action keys, and public documentation
   (steps 1–4 and 9). Run the combined decoded-query escaping regression and
   all path/query compatibility checks before todo #8 ships.

The independent repairs can be reordered except for the dependencies stated
above. Query parsing must not ship ahead of the selected security repairs,
todo #2, or the forced-JSONP integration dependency.

## Implementation steps

### 1 Parse and retain query provenance

Keep `getUrlParams(pathname)` responsible for path parsing. In `parseRoute()`:

1. Parse path parameters and select the controller from the pathname.
2. Collect query entries, assigning the last value for each decoded name.
3. Merge query parameters followed by path parameters into `route.urlParams`.
4. Derive `action`, `descriptor`, and the parameter-based `direct` flag from
   that merged map, retaining the underscore-path direct-request rule.
5. Retain the distinct query names separately for allowlist validation,
   including names shadowed by path values. Retain the original query string
   for action-cache identity, and keep each route's own parameter names separate
   from its inherited effective URL map.

Represent provenance with route metadata such as `queryParamNames`. Retain the
action's own exact query suffix for cache identity; inherited query strings
must not be appended to it. Keep metadata separate from `params.url` so it
cannot collide with application parameter names. Preserve the own-route
parameter map/provenance before inheritance for action insertion. For object
next without an explicit route, derive a separate controller/action identity
and an empty own-input name set; do not reuse the original request's provenance
merely because its public route fields are retained (step 5).
Static-file detection and paths continue to use `url.pathname`; a static
request does not enter the
controller pipeline.

Construct and merge URL parameter maps with own data properties. Verify that
`__proto__`, `constructor`, `prototype`, and `_onTimeout` remain ordinary string
keys through parsing, copying, and inheritance. The current `helpers.copy()`
and `helpers.extend()` need particular attention: `Object.assign({}, source)`
can lose an own `__proto__` property, and `copy()` treats any truthy `_onTimeout`
as a timer marker. Make the narrow helper or URL-map-copy changes necessary to
preserve keys and prevent shared mutable maps. Broader security work remains
under todo #1.

#### Repair URL copying in helpers

Treat R6 as an existing bug in [`helpers.copy()`](../../../lib/helpers.js).
`route.parsed` is a `URL`, but the ordinary-object copy branch converts it to
an empty object. Controllers and views consequently lose `href`, `pathname`,
`searchParams`, and the URL methods available to hooks.

Add explicit handling for `URL` instances before ordinary-object copying,
constructing an independent `new URL(source.href)`. Its `searchParams` must
retain duplicate values and remain independent of the original URL's mutable
query state. Returning the original URL by reference would not repair the copy
contract. Include this bounded type-handling fix in this plan; support for
other class instances is separate work.

Verify the clone through `helpers.copy()` and `helpers.extend()`, nested request
parameters, controller and include copies, and view context construction.
Preserve existing primitive, array, plain-object, Date, RegExp, and timer
behavior except for the separately identified URL-map safety fixes.

### 2 Carry parameters through the controller pipeline

Keep the initial `params.url = route.urlParams` integration in `serve()`.
Update the route merge sites for string `next`, string includes, and object
includes to carry query provenance alongside the effective parameters.

Preserve the existing inheritance rule: a replacement route extends the
original request's URL scope, and its explicit parameters win. Within each
route, its path values win over its own query values. For example, a
request `/article?code=parent&page=1` with an include `/_head?page=2` gives the
include `{ code: 'parent', page: '2' }` without changing the parent's URL scope.

Resolve a replacement route's framework fields from its own merged path and
query parameters before inheriting the original request's URL scope. An
inherited `action` value must not change the replacement controller's selected
action. For example, `/article?action=edit` including `/_head` still invokes
`_head.handler()`, while an include `/_head?action=meta` invokes `_head.meta()`.
Keep explicit object-directive action selection and direct-request skipping
of `next` and the default layout, while applying the redirect repair in step 8
and the R7/S1 cache-identity repair below. Object next without an explicit route
retains its existing copied route fields; only its cache identity and internal
own-input provenance change.

A replacement route without a query inherits the original query data through
the parameter merge; `parseRoute()` should not append `request.url`'s query to
the replacement URL. Preserve object `next` parameter inheritance while fixing
its action-cache identity under R7/S1 without replacing its public route.
Audit controller copies, hook arguments, and view context construction so the
same effective URL scope reaches each
consumer.

### 3 Enforce cache allowlists for query names

Select the input-name source by cache mode before applying the shared check:

- Request insertion validates the request's effective URL keys plus its recorded
  query names, including names shadowed by path values or removed from the
  effective map. It uses the original request controller for the descriptor rule.
- Action insertion validates only path/query names from that action's own route,
  before parent inheritance. This applies to the first action, includes, and
  string next routes. Object next without an explicit route has no own URL
  input names; its controller/action-derived key does not manufacture inherited
  parameter inputs. Explicit `next.params.route` uses that supplied route's
  own input/provenance. Keep this metadata separate from the controller's public
  route fields, which plain object next preserves.

Use decoded query names, deduplicate names, and validate shadowed query names
as well as visible values. Inherited parent names do not affect action insertion
or produce child-cache warnings; they still reach the child controller as data.

Exempt a path descriptor only for the controller whose own route is being
validated, and only if that key did not also arrive through that route's query.
Thus `/_head/My-Title` can use its `_head` path exemption with `urlParams: []`,
while `/_head/My-Title?_head=other` requires `_head` to be allowlisted despite
path precedence. An inherited parent descriptor/query has no bearing on that
child action's check.

Apply the selected R2 policy to unlisted URL parameters from both path and
query syntax: report a nonfatal cache warning, bypass insertion, and continue
normal request processing. Cache validation determines caching eligibility;
it does not establish a server failure or an invalid HTTP request.

- An omitted `urlParams` allowlist imposes no name restriction.
- `urlParams: []` permits no query names; the existing path-descriptor exemption
  still applies to path-only input.
- A listed query name may be cached; an unlisted name bypasses insertion
  without deleting it from `params.url`.
- Emit the warning directly through logging rather than the server `error`
  event. Do not construct a 400/500 response, include a server-error stack,
  invoke the application error hook, or apply `citizen.errors: 'exit'` to the
  cache rejection. Controller processing, redirects, and response status
  continue normally under both `capture` and `exit`.
- Use the existing client-diagnostic logging controls for the warning, with
  a fixed cache-specific label and offending parameter names rather than
  values. Pass the names as structured array content, not raw interpolation
  into the label or a content string. Escape control characters and Unicode
  line separators in displayed names; `util.inspect()` escapes CR/LF and
  terminal controls but leaves U+2028/U+2029 literal. Do not echo the full
  request URL/cache key or parameter values in the warning. Encoding is
  diagnostic-only: do not alter parameter maps, eligibility, or cache identity.
  Cover file and
  console output; no forged lines or injected terminal controls may originate
  in a name. Logging settings may suppress output without changing cache
  eligibility. No new public logging configuration or general logger rewrite
  is required.
- Preserve normal error handling for genuine controller, rendering, or cache
  storage failures. This feature does not reinstate `cache.invalidUrlParams`.

Apply the relevant check to both request and action insertion. Do not validate
inherited names merely because they are present in the child's `params.url`.
This deliberately changes existing path-only include eligibility: shared child
entries can be populated regardless of the parent's unrelated parameter names,
and their own descriptor receives the correct exemption. It aligns cold
insertion with R1's own-route key and R4's unchanged-key hit reuse; allowlists
are caching controls, not access-control or output-dependency detection.

This selects the future policy in cache-correctness decision 15. The existing
bug-fix baseline retained exit behavior; implementation of this plan replaces
that cache-validation error flow. Optional allowlist-based query-key filtering
is exploratory under R2; it does not change this default behavior.

#### Explore allowlist-based query-key filtering

Explore an explicit opt-in mode that reuses the existing `urlParams` allowlist
to select which query names affect cache identity, rather than adding a
separate list of tracking names to ignore. Unlisted query names would remain
available to the application but would not affect the key or disqualify the
request from caching. Retain the exact pathname, including its path parameters;
unlisted path parameters would still follow the warning-and-bypass policy.

For example, with `urlParams: ['id']` and filtering explicitly enabled,
`/article?id=1&utm_source=email` and `/article?id=1&utm_source=social` could share
an entry. Without that opt-in, both follow the default warning-and-bypass
policy. An application enabling filtering must list every query name that can
affect routing, cached output, or replayed directives; omitting a functional
parameter could otherwise reuse an inappropriate entry.

Evaluate the configuration API, omitted and empty allowlists, action and
request cache applicability, and preservation of ordering, duplicates, and
encoding for retained query pairs. Determine how the filtering policy would
be available consistently before lookup and at insertion, since controllers
can supply cache directives only after a miss. Include policy changes and
clearing in the complexity assessment. Keep the R1 own-route rule for action
identity; inherited parameters do not become additional key inputs.

This exploration does not authorize changing the default allowlist semantics
or shipping a filtering mode. Record the work and complexity before proposing
an implementation. It is not a completion requirement for todo #8.

### 4 Isolate action caches by query input

R1 selects each action's own pathname and query string as its identity.
R4 retains insertion-time allowlist validation without adding validation on
cache hits. Exact-match lookup and clearing remain the baseline under R3.

Adding query values to controllers makes pathname-only action keys insufficient:
`/article?id=1` and `/article?id=2` must not reuse the same action output.
Implement one action-key helper and use it at every lookup and insertion site,
including include lookup and `cacheRoute()`.

Use the action's own pathname plus its exact query suffix. Preserve existing
pathname keys when that route has no query. Retain query ordering, duplicate
occurrences, and encoding; do not sort, decode, or reserialize the query for
cache identity. Do not mutate `parsed.href` or append the parent's query.

For the initially requested action, its own route is the request URL. For a
string include or `next`, it is the explicit replacement URL. Object includes
use their normalized target route. Object `next` with an explicit route uses
that route; without one, its key derives from the selected controller/action
(step 5) while its existing public route fields stay unchanged. Inherited URL
parameters still reach controllers but do not vary action keys.

For example, `/_header` has the key `/_header` whether its parent is
`/article/id/123?source=email` or `/article/id/456?source=social`.
`/_header?section=articles` has the separate key `/_header?section=articles`.
If an include or next controller's cached output depends on an inherited value,
the application must put that value explicitly into its target route or avoid
caching that action. This applies to inherited path and query parameters alike.

Make the key available on the parameters passed to each controller as
`params.route.actionCacheKey` so applications can target it with
`app.cache.clear({ route })`. Set it on that controller's copied route without
mutating the original request or another chain link. For object next, this is
the derived key even though pathname/controller/action/parsed still describe
the original request. Use the captured internal action identity for both
lookup and insertion; never reconstruct its key or own-name set from those
preserved public fields. Preserve the same per-action key exposure on cache
hits as on cold execution.

Do not revalidate allowlists on cache hits. Reuse entries under the exact-key
contract; a parent's inherited parameters do not add a new hit-time eligibility
check for an unchanged include or next route. Validate insertion attempts as
specified in step 3.

Request caches retain their existing full-URL keys and content-type separation.
[`lib/cache.js`](../../../lib/cache.js) can continue storing caller-supplied
keys; this work does not require a new cache scope, eviction policy, or
single-flight mechanism.

Retain exact-match `app.cache.clear({ route })` behavior. Different path
parameter orderings remain separate entries: `/article/id/123/page/2` and
`/article/page/2/id/123` are not canonicalized or cleared together. The same
principle applies to distinct query orderings and spellings. Clearing a known
action or request key must still work independently of the other entries.

#### Explore clearing groups of variants

R3 is exploratory and does not block todo #8. Estimate the work and complexity
of grouping query variants under one literal pathname, and distinguish that
from grouping equivalent routes with reordered path parameters. Compare the
metadata or indexes required, invalidation and timer handling, API semantics,
and regression coverage. Report the scope and cost before proposing an
expansion to clearing behavior. No bulk-clearing API or route canonicalization
is required for this implementation.

### 5 Repair object next action-cache identity

Include the existing R7 bug and S1's reverse collision in this plan. An object
next without explicit route parameters leaves the original route on copied
parameters. The first action's cached entry can therefore be retrieved as the
next action and repeatedly replay its `next`. Conversely, if only the next
action is cached, it stores under the first action's key; a later request can
skip the first controller entirely, including its redirects and other directives.

The maintainer selected a key-only repair that preserves the existing route API.
Derive an internal identity from the controller and action actually selected by
the next directive before that directive is cleared. `next: { controller:
'second' }` uses `/second`; an explicit action uses `/second/action/<action>`.
An inherited `params.url.action` or preserved `params.route.action` must not
change that selection. Preserve existing default action and view selection.

For object next without `params.route`, leave the next controller's existing
`params.route.pathname`, `controller`, `action`, `descriptor`, `parsed`, and URL
parameter inheritance unchanged. Add only the per-action `actionCacheKey` to
its copied route. For example, `/first/id/5?source=email` followed by object
next to `second` still exposes the original pathname and parsed query to that
controller, but its action key is `/second`, not the first controller's key.
Keep the original request route/full URL intact for request-cache identity and
response assembly. An explicitly supplied `next.params.route` still replaces
the route as before and supplies the action's own route identity/provenance.

Store the internal key and own-route name provenance alongside the chain action
so insertion uses the same identity as lookup. A route-less object next has no
own URL input names for step 3; do not mistake retained request fields for its
own target input. Output depending on inherited values requires a string next
with those values explicit in its target route, or no action caching. Document
this together with the include-cache dependency warning.

First-controller entries and object-next entries must not collide with or
without query input, regardless of which controller's cache is populated first.
Verify both controllers cached, only the first cached, and only the next cached;
assert cold/warm completion, first-controller redirects, expected invocations,
retained public route fields, and distinct exposed action keys. Keep ordinary
query-free route keys unchanged rather than introducing a global key format.

### 6 Preserve debug inspection without evaluating URL input

Include the bounded development-debug repair in this plan, with the
maintainer's requirement that object inspection retain the same end result.
Replace `eval(params.url.ctzn_inspect)` in `debug()` with a restricted selector
resolver that selects a value and passes it to the existing `util.inspect()`
and HTML formatting path. Do not exclude `ctzn_*` query names as a substitute
for repairing the debugger; the existing path input reaches the same eval.

Preserve the README's `params` and `params.session` selectors and ordinary
nested property selection. Use an explicit map of debug argument roots
(`params`, `request`, `response`, and `context`) instead of evaluating variable
names in the function's lexical or global scope. Support literal property
paths, including literal bracket keys and array indexes where needed for
existing object-selection use. The resolver must not execute function calls,
computed expressions, assignments, or other JavaScript. Reject `__proto__`,
`constructor`, and `prototype` segments at every depth, in dot and bracket
forms. Do not require own properties: ordinary property reads must retain
legitimate accessor-backed fields such as `params.route.parsed.href`,
`pathname`, `searchParams`, and `request.socket.remoteAddress`. Function values
may be inspected, but the resolver must never call them. Property getters run
as part of ordinary reads on the existing debug objects; this compatibility
contract is not a side-effect-free sandbox. Catch property-read failures and
produce the same bounded diagnostic used for unsupported selectors.

Preserve development-only HTML debug gating, `ctzn_debug`, configured scope
output when no selector is supplied, inspection depth and hidden-property
settings, and the existing escaped `<pre>` presentation. Both path and query
selectors must resolve to the same object/value under path precedence and
produce equivalent inspection output. A missing property should retain the
existing `undefined` inspection result. Malformed, executable, or disallowed
selectors must produce a bounded debug diagnostic without execution or a
request failure; do not silently select a different object.

During implementation, check representative existing selector forms and
accessor-backed fields against the resolver. Record and resolve compatibility
gaps before landing rather than silently reducing useful object inspection.
The intentional compatibility limit is arbitrary JavaScript expression
evaluation: expressions such as `Math.max(1,2)` and function calls no longer
execute. Preserving that behavior would defeat the repair. Document this
limit explicitly; the approval preserves object inspection, not general
JavaScript execution. No debug resolver or runtime change is implemented by
this planning update.

### 7 Validate JSONP callbacks before output or cache reuse

Include callback validation for `application/javascript` JSONP output in this
plan. Accept a literal JavaScript identifier or dot-separated identifier path,
such as `show`, `app.show`, or a conventional jQuery callback name. Validate
the entire effective string against a documented grammar; do not evaluate it
or accept executable expressions, calls, bracket expressions, comments, or
additional statements. Define identifier and reserved-word handling so accepted
callbacks produce syntactically valid JavaScript calls.

Validate the merged `params.url.callback` value, with path precedence and
normal query decoding/repetition rules. Apply the same callback rule to path
and query input; a conflicting query must not invalidate a valid path callback
that overrides its value. Keep the parameter data available to the application.
This rule applies when the actual output is JSONP; other response formats do
not reject an ordinary `callback` parameter solely because of this grammar.

For a missing, empty, or malformed JSONP callback, return HTTP 400 with a fixed,
non-executable diagnostic body that does not reflect the rejected value. Stop
further response, rendering, and cache-insertion work for that request. Do not
emit the server `error` event, call the application server-error hook, include
a server-error stack, or apply `citizen.errors: 'exit'` to this client rejection.
The rejection is nonfatal under both `capture` and `exit`; assigning 400 through
the current generic error handler alone would not meet that requirement.

Use a shared guard before serving JSONP request, action, or include cache hits
and before actual JSONP rendering or response writing. Check the effective
callback for replacement routes as well as the initial request. Cover forced
content-type changes in controllers and hooks so validation cannot be skipped
when JSONP is selected after negotiation. Propagate a handled rejection through
the pipeline without throwing into generic server-error handling or allowing
another response write. This format-specific output guard does not reinstate
R4's cache-allowlist validation on hits.

Forced JSONP integration depends on todo #12: negotiation currently sets the
Content-Type header before a controller or hook changes `response.contentType`.
For example, `Accept: */*` negotiates `text/plain`; forcing JavaScript must
produce both a valid JSONP body and an `application/javascript` response header.
Land the separately scoped header fix before accepting these cases. Assert
headers and bodies on cold/warm and hook/controller-forced responses; do not
weaken acceptance to body-only tests or describe a stale MIME header as valid
JSONP delivery. Content negotiation otherwise remains outside this feature.

Valid callbacks retain their existing JSONP output and namespace behavior.
Cache allowlists remain separate: `callback` and client-added `_` names must
be allowed to cache those requests under the default warning-and-bypass policy.
No tracking exemption or filtered cache key is added by this repair.

### 8 Honor redirects on direct requests

Include the direct-request redirect repair in this plan. A direct request
skips `next` and the default layout; it must still honor hook and controller
redirects. Apply this consistently to `/direct/true`, `?direct=true`, and
underscore-prefixed routes. Keep path precedence, underscore-path detection,
and existing truthiness rules for the flag.

Remove the `!params.route.direct` exclusions from the initial `request`
redirect check and shared `setRedirect()` handling. Retain the direct flag's
gate in `next()` for explicit chaining and the implicit default layout.
Ordinary controller execution and include rendering remain available on direct
requests unless a server-side redirect ends the response first.

Honor string redirects and object directives, preserving status, Location or
Refresh headers, session/cookie handling, and existing referrer behavior. The
same redirect handling must work for live hooks, fresh controller context,
replayed action-cache directives, and request-cache hits. Server-side redirects
must take precedence over a cached body or conditional 304. Refresh redirects
retain their configured status and body even when a cache validator matches.
Stop processing after a response ends; do not write another body or mutate the
stored entry while applying live redirects.

Update the existing HTTP regression named `direct requests still suppress
redirects and allow conditional responses` to assert the selected redirect
behavior. Cover both cold and warm caches and retain ordinary conditional
responses when no redirect is requested. Document this as a 2.0 compatibility
change from the existing suppression behavior. The cache-correctness plan's
historical repair retained that behavior; this plan selects its replacement.

### 9 Document the public behavior

Update [`README.md`](../../../README.md) routing and URL-scope examples to show
path, query, and mixed URLs. Document collision precedence, repeated values,
decoding, literal query names, framework fields derived from merged parameters,
the underscore-path direct-request rule, and inherited query parameters. Show
equivalent path and query action URLs, and explain the compatibility impact of
previously ignored query values now supplying parameters absent from the path
and participating in routing. State that explicit path values take precedence
over appended queries. Replace the statement that query strings are not parsed
or checked by cache allowlists.

Describe query-aware action keys and targeted clearing, and add allowlist
examples with valid and invalid query names. Update the include-cache warning
to cover both path and query syntax: inherited values do not vary an action's
key, and values affecting cached output must be explicit in its target route.
For route-less object next, use string next to express such inputs explicitly;
its public route remains inherited and its derived `actionCacheKey` is separate.
Explain own-route action insertion versus request-name insertion, the exemption
for each checked route's path-only descriptor, and the removal of inherited
path/query names from child eligibility. Parent input must not make cold child
insertion or warning behavior differ from warm reuse.
Explain exact-match clearing for action keys versus full-URL request keys;
identify bulk clearing as exploratory
rather than a new API guarantee. Document the object-next cache-identity repair
and restored URL access in copied route parameters. Note that apps using
allowlists must add external callback or tracking parameter names if they
intend to cache those requests under the current exact-key design. Document
allowlist-based query-key filtering as exploratory, without promising a new
configuration option or changing the default contract. Explain that allowlists
validate insertion attempts and are not rechecked on cache hits. Document
nonfatal cache warnings for both URL syntaxes and their independence from
`citizen.errors`, including the change from the existing error-event behavior.
Link the todo #2 escaping behavior, show ordinary escaped interpolation for
query values, and explain that explicit raw output requires trusted data.
Update debugging examples with equivalent path and query selectors and the
supported property-path grammar. Explain the removal of executable expressions
while retaining ordinary object inspection and its output settings.
Document JSONP path and query callback examples, the supported callback grammar,
nonfatal HTTP 400 behavior for invalid JSONP callbacks, and the independence of
callback validation from cache allowlist eligibility. Document todo #12's
forced-format/header repair in its own CHANGELOG entry and retain the JSONP
integration dependency in the implementation notes.
Explain that direct requests skip `next` and the default layout while honoring
redirects, including the change from prior redirect suppression and parity
across path, query, and underscore-prefixed routes.
Add the feature, action-cache isolation, and warning policy to the 2.0
[`CHANGELOG.md`](../../../CHANGELOG.md) when implementation lands.

## Validation

Add `test/router.test.js` using the existing `node:test` setup. Cover the table
above, URLs without queries, encoded names and Unicode, malformed escapes,
empty names, case sensitivity, repeated names after decoding, reserved routing
names, route overrides, static URLs with queries, and safe special-property
handling. Assert that parsing does not modify the original URL or request.

Add focused helper regressions for a nested `URL` copy, retained URL properties
and methods, duplicate query values, and independent mutations of the original
and clone. Cover URL preservation through `helpers.extend()` as well.

Extend [`test/cache-http.test.js`](../../../test/cache-http.test.js), reusing
its scaffolded child-process fixtures:

- A callback controller receives `code` and `state`; a hook and HTML view can
  access the query values through the URL scope. Controllers, includes, and
  views can also access their route's copied `parsed.searchParams`, including
  repeated values, without mutating the original request's URL.
- With todo #2 implemented, send an encoded markup value such as
  `<input value="query marker">` through a query. Assert that the controller
  receives the decoded string and `${url.name}` emits HTML-escaped text rather
  than a literal input element. Verify both the initial response and a cached
  response for an allowlisted query name.
- Path and query parameters both select actions, descriptors, and direct
  responses. Cover path precedence over conflicting query values, query-only
  framework parameters, default fallbacks, and the underscore-path direct-
  request rule. `/article/action/edit?action=review` must select `edit()`.
- Direct requests through path parameters, query parameters, and underscore
  routes skip explicit `next` and the default layout while retaining ordinary
  controller/include output when no redirect applies. Hook login redirects
  and controller redirects still take effect. Cover string and object redirects,
  server-side and refresh forms, live request/session/response hooks, replayed
  action directives, and request-cache hits. With matching cache validators,
  assert server-side redirects take precedence over 304 and refresh redirects
  retain their configured status and body. Verify cold/warm parity and normal
  conditional responses without a redirect. Update the existing suppression
  regression instead of retaining its old expectation.
- Includes and chained controllers inherit query values, apply explicit
  overrides, and cannot mutate the parent's URL map. Verify that inherited
  action values do not change the replacement route's selected action, while
  query actions explicitly present in a replacement route do select it.
- In development HTML responses, compare inspection of `params`,
  `params.session`, nested values, literal bracket keys, and array indexes
  against the existing inspected values and formatting on a stable fixture.
  Check URL getters (`href`, `pathname`, `searchParams`) and the socket's
  `remoteAddress` getter, with equivalent results to direct property reads.
  Check both path and query selectors, path precedence, depth and hidden-value
  settings, configured debug output without a selector, missing properties,
  and production-mode suppression. Verify that executable or malformed
  selectors and blocked prototype segments in both dot/bracket forms neither
  execute selector code nor fail the request. Include a side-effect marker to
  prove function-call input does not run and a throwing getter to prove read
  failures produce a bounded diagnostic.
- JSONP responses accept simple, dotted, and conventional jQuery callback names
  from path and query parameters, retaining payload and namespace behavior.
  Cover decoding, repeated queries, path precedence, includes/chains, cache
  hits, and content types forced by a controller or hook after todo #12.
  Include `Accept: */*` and assert both the final JavaScript Content-Type and
  body on cold/warm requests. Missing, empty, malformed, and executable
  callbacks return a non-executable HTTP 400 before rendering or cache reuse,
  without reflecting the callback or creating a
  cache entry. Assert no server-error hook or process exit under either error
  policy, then send a valid request to the same server to prove it remains
  alive. Check that non-JSONP output retains callback parameters without this
  format-specific rejection and existing valid JSONP regressions still pass.
- Both cache modes cache allowed query names and bypass insertion for unlisted
  names. Cover omitted and empty allowlists, encoded names, overridden names,
  controller-name queries, and unlisted path names. Under both `capture` and
  `exit`, verify normal response behavior, retained parameters, cache warning
  reporting when enabled, no application error-hook call, and no process exit.
  Follow an `exit`-mode cache warning with another request to prove the server
  remains alive. Verify that genuine controller errors retain their selected
  error policy. Update existing invalid-parameter tests that expect an error
  hook or process exit to assert the new warning contract. Assert that a query
  shadowed by a same-name path descriptor still requires allowlisting on the
  checked route. Capture file and console warning output for encoded CR/LF,
  terminal control bytes, and Unicode
  line separators in query names. Assert that names are diagnostic-escaped,
  values are omitted, and no name injects a log line or terminal control while
  the controller still receives the original decoded key.
- Warm bare-path action entries cannot satisfy requests whose action's own
  route contains query input. Distinct query values, duplicate sequences, and
  encodings on that route remain isolated; repeated identical requests reuse
  their entries.
- Cached includes and chained actions reuse the same entry across parents with
  different path and query parameters when their own target route is unchanged.
  Start with a cold child under a parent carrying unlisted inherited path and
  query names; with child `urlParams: []`, assert insertion and no child warning.
  Then use another such parent and verify warm reuse without hit-time validation,
  warnings, or bypass. Isolate child assertions from any legitimate request-cache
  warning for that parent. An own path-only descriptor is exempt; an own query
  with that name (including a shadowed one) is not. An unlisted own child name
  still warns and bypasses insertion. Explicit target-route path/query variants
  create separate entries. Test a warm action with a cold request cache,
  combined request/action caching, and targeted action clearing.
- Retain the existing full-URL request-cache regression and check that clearing
  one query variant preserves the other entries. Verify that reordered path
  and query parameters retain distinct cache keys and exact-match clearing.
- Object next completes cold/warm with only the first controller cached, only
  the next controller cached, and both cached. Warm the next controller, then
  repeat the first route and assert that the first controller still runs and
  applies a fixture redirect/access decision; warm output must retain both
  controller namespaces when no redirect applies. Cover default/explicit next
  actions, query-bearing input, explicit `next.params.route`, and string-next
  output parity. Assert distinct lookup/insertion keys and invocation counts,
  no replay loop, and unchanged public pathname/controller/action/descriptor/
  parsed URL fields for route-less object next, including R6 searchParams access.
  The inherited map remains available but does not enter the child's name check.
  Verify `params.route.actionCacheKey` and exact targeted clearing, without
  mutating another link or the original full URL used for request caching.

Run focused router, helper, and HTTP regressions, then `npm test`. Include the
existing config and cache tests to verify other consumers of the helper fixes.

## Completion criteria

Todo #8 is complete when external callback query values reach `params.url`,
request allowlists check request names and action allowlists check only own-route
names, including shadowed queries without descriptor bypasses. Request caches
isolate distinct full URLs, and action/include caches isolate distinct own-route
pathnames and query strings. Inherited inputs vary an action
entry only when the application explicitly includes them in the target route.
The parser and HTTP regressions must pass with the documented collision,
routing, inheritance, and error-policy behavior. Unlisted parameters encountered
during insertion checks must produce nonfatal warnings and bypass insertion
under both error policies. Cache hits do not revalidate allowlists.
The R6 URL-copy and R7/S1 object-next cache-identity regressions must pass in
both collision directions, without changing route-less object next's public
route fields or skipping first-controller redirects. Cold/warm child eligibility
must be independent of unrelated inherited names, with each own path-only
descriptor exempted correctly. Grouping or clearing equivalent URL variants
remains exploratory and is not a completion criterion.
Optional allowlist-based query-key filtering is also exploratory and is not
required for completion; exact keys and warning-and-bypass remain the default.
Shipping todo #8 also requires todo #2's default HTML escaping to have landed
and the decoded-query HTML regression to pass.
The debug repair must preserve supported object-selection results and settings
for both URL syntaxes, with no execution of arbitrary selector expressions.
JSONP callback validation must preserve valid callback output and return a
nonfatal HTTP 400 for invalid callbacks before rendering or cache reuse under
both error policies. Todo #12 must have landed and forced-JSONP regressions
must assert the final response Content-Type as well as callback/body behavior.
Cache warnings must safely encode arbitrary decoded names without altering
application data. Supported debug getters must remain inspectable; dangerous
segments and executable selectors must be rejected without request failure.
Direct-request regressions must show that chaining/layout are skipped while
hook and controller redirects are honored on both misses and cache hits.

## Review — 2026-10-06

Classifications follow the cache-correctness plan. A *design gap* needs a
maintainer decision. A *bug* was reproduced or violates a documented contract.
A *factual error* is a claim in this plan that the code does not support. Line
references are as of commit `1bfb0b2`. R1 through R7 and the security findings
below record the selected implementation scope, shipping dependency, and
exploratory dispositions. These decisions do not claim implementation is done.

The parsing mechanics are sound: `URLSearchParams` decoding, own-property
maps, static detection on `url.pathname`, and the inheritance examples. These
claims were checked and are accurate:

- Assignment and `Object.assign()` lose an own `__proto__` key.
- `copy()` returns any object with a truthy `_onTimeout` by reference.
- The allowlist exemption compares against the original
  `params.route.controller`.
- Request-cache keys use `parsed.href`.

The findings below concentrate in steps 3 and 4 and in the security effects of
query decoding.

### Cache and routing review dispositions

#### R1. Action cache identity uses the action's own route

Classification: **Resolved design decision.**

Use each action's own pathname plus its own exact query string. The README's
include-cache rule already uses the target route and recommends explicit
parameters to vary the entry. Extend that rule consistently to query syntax.

Inherited values remain available to controllers but do not enter the key.
Applications must make values affecting cached output explicit in the target
route. A site-wide `/_header` therefore retains one entry across parent pages
and their tracking queries, while `/_header?section=articles` creates a distinct
entry. Query ordering and encoding remain significant under exact matching.

Action insertion now validates only names from that same own route, as selected
under S2. This removes parent-dependent cold eligibility and makes its descriptor
exemption refer to the action's controller. Request insertion still checks the
request, and hit-time validation remains excluded. Route-less object next uses
a controller/action-derived identity without replacing its public route (S1).

This preserves documented include behavior, avoids implicitly multiplying
shared entries by parent input, and follows R3's exact-match contract. It
replaces the draft's signature of inherited query sources and effective URL
parameters. R4 also retains shared hit reuse without rechecking inherited
parameters against the allowlist.

#### R2. Nonfatal cache warnings and tracking parameters

Classification: **Nonfatal warning policy selected; optional allowlist-based
query-key filtering exploratory.**

The maintainer identified the core problem as classifying an invalid cache
parameter as a server error. The cache allowlist determines caching eligibility;
an unlisted name does not establish a server failure or an invalid HTTP request.
The maintainer selected a nonfatal cache warning, normal uncached response
processing, and no application error-hook call or process exit. Apply this
policy to path and query names alike. Emit the warning outside the server
error event; assigning a 400 alone would still reach the current generic
`exit` policy. Step 3 defines the implementation and logging requirements.

Third-party names such as `fbclid`, `gclid`, and `utm_*` follow the selected
warning policy and current exact-key design by default:

- An allowlist that omits them serves normally, reports a cache warning, and
  bypasses insertion under both `capture` and `exit` when the name belongs to
  the checked cache route. Parent names do not warn or block child insertion.
- Omitting the allowlist or permitting the tracking name allows a separate
  entry per exact URL containing a distinct value. Under R1, parent tracking
  queries do not multiply entries for an unchanged include or next route.
- Query provenance survives removal from `params.url`, so deleting a property
  in a hook does not by itself exclude it from validation or cache identity.

The maintainer agreed to make optional query-key filtering exploratory and
reuse the existing `urlParams` allowlist instead of introducing a second list
of ignored names. In an explicit opt-in mode, only allowlisted query names
would affect identity; other query names would remain available to controllers
and would not prevent caching. Exact pathnames remain part of the key. This
changes the meaning of an unlisted query name from cache ineligibility to an
application assertion that it does not affect the cached result, so it must
not become the default. Step 3 records the scope and complexity questions.
No configuration API or filtering implementation has been selected, and this
exploration is not a prerequisite for todo #8.

The cache-correctness decision 15 reporting/exit question is now resolved for
the implementation of todo #8. The earlier repair's retained error-event
behavior remains historical implementation context, rather than this plan's
target behavior.

#### R3. Clearing groups of cache variants is exploratory

Classification: **Exploratory; exact-match clearing retained.**

`app.cache.clear({ route: '/article/id/237' })` clears that path's action entry.
Distinct stored keys require distinct exact-match clears, including the
separately cached paths `/article/id/123/page/2` and
`/article/page/2/id/123`. Query variants follow the same principle. This plan
does not require finding or clearing every URL expressing equivalent inputs.

Grouping query variants by literal pathname and grouping equivalent routes
with reordered parameters are possible enhancements. Explore their work and
complexity as described in step 4 before proposing a broader API. This is not
a prerequisite for the query feature or its completion tests.

Related existing documentation gap: the README's `cache.clear({ route })`
example uses a pathname, which matches action entries only. Request entries
use the full href as their key, including scheme and host. Step 9's README pass
should correct this.

#### R4. Hit-time allowlist validation is outside this feature

Classification: **Resolved scope decision; hit-time check excluded.**

The maintainer agreed to remove the proposed hit-time allowlist check. Under
the default exact-key design, each action's own query is already part of its
identity. Revalidating hits would primarily change shared include and next
reuse based on inherited parent parameters, which R1 deliberately keeps out
of the key. That is a separate behavior change outside this feature.

Keep allowlist validation at insertion, including the step 3 query-name and
warning-policy changes. Do not add hit-time warnings or bypass existing child
entries solely because a later parent's inherited parameters differ. Step 4,
documentation, and acceptance coverage now reflect this decision. Any future
hit-validation proposal needs separate justification; exploratory key filtering
does not reinstate this check.

#### R5. Path precedence with query fallback

Classification: **Resolved design decision.**

Path parameters take precedence over query parameters so appended third-party
values cannot change the behavior explicitly expressed in a route. Queries
still supply parameters absent from the path, including framework parameters.

For example, `/article?action=edit` selects `edit()`, while
`/article/action/edit?action=review` also selects `edit()`. Derive `action`,
`descriptor`, and the parameter-based `direct` flag from the merged URL scope;
the controller and underscore-path direct-request rule still come from the
pathname. Use this same precedence for application parameters, such as `id`.

Query framework parameters remain supported when the path does not supply
them. Development `ctzn_*` controls remain supported with the bounded debug
selection repair in step 6.

### Security effects of query decoding

Classification: **HTML escaping dependency selected; debug, JSONP, and
direct-request repairs included.** Each item widens an existing
exposure rather than creating a new class.
The broader review belongs to todo #1; the decisions here affect whether and
how query parsing ships.

Path values are never percent-decoded. The WHATWG URL parser percent-encodes
spaces, `"`, `<`, `>`, `` ` ``, `{`, and `}` in paths. Query values are fully
decoded. Verified: `/x/name/<input value="review marker">` yields the path
parameter `%3Cinput%20value=%22review%20marker%22%3E`, while the same markup
passed as an encoded `name` query value is decoded into literal markup.

- **Reflected XSS — shipping dependency selected.** The current raw
  `${url.name}` interpolation can emit decoded query markup verbatim. The
  maintainer agreed that todo #2's default HTML escaping must land before
  todo #8 ships, with an HTTP regression proving query markup renders as text.
  The query values themselves remain decoded for application use. The
  [escaping plan](html-escaping-double-bracket.md) owns the renderer change;
  documenting the existing risk alone does not satisfy this dependency.
- **Development-mode `eval()` — repair included with compatibility required.**
  [`debug()`](../../../lib/server.js#L1701)
  evaluates `params.url.ctzn_inspect`. Executable expressions already work
  through path input, as verified with `Math.max(1,2)`. Query decoding permits
  less restricted JavaScript input; the existing eval exposure is not limited
  to queries. Any page a developer visits can trigger it, for example with
  `<img src="http://localhost:3000/?ctzn_debug=1&ctzn_inspect=…">`. The maintainer
  approved replacing eval with restricted property selection, provided useful
  object inspection retains its end result. Step 6 preserves documented
  selectors, output settings, and debug presentation for path and query input;
  arbitrary executable expressions are the explicit compatibility limit.
- **JSONP callback — validation and nonfatal 400 included.**
  [`renderView()`](../../../lib/server.js#L1687) currently writes
  `params.url.callback` into the response unescaped. `?callback=` is the
  conventional JSONP syntax. jQuery also appends `_=<timestamp>`, which runs
  into R2. The maintainer agreed to accept identifier/dotted-name callbacks and
  reject malformed values with HTTP 400, outside the server-error and exit
  policy. Apply this to effective path and query values before JSONP rendering
  or cache reuse, as specified in step 7. Cache-name eligibility stays governed
  by R2; the `_` parameter is not automatically exempted.
- **`direct` suppresses redirects — repair included.** The
  [`request` handler](../../../lib/server.js#L79) and
  [`setRedirect()`](../../../lib/server.js#L1334) skip redirects when
  `params.route.direct` is set, including hook redirects. The README's
  login-redirect request hook can therefore be bypassed with `/direct/true`.
  A disposable HTTP app reproduced a 302 login redirect becoming a 200
  controller response with `/direct/true`; simulated query parsing reproduced
  the same result with `?direct=true`. The maintainer agreed to limit direct
  requests to skipping `next` and the default layout while honoring hook and
  controller redirects, consistently across path, query, and underscore
  routes. Step 8 covers cold/warm redirect behavior and replacing the existing
  cache regression's suppression expectation. Document the 2.0 compatibility
  change; merely documenting the bypass is no longer the selected disposition.

### Helper copying bug

#### R6. `params.route.parsed.searchParams` is unavailable in controllers and views

Classification: **Bug; reproduced; fix included in this plan.**

[`fireController()`](../../../lib/server.js#L1054) passes `helpers.copy(params)`
to controllers. Views receive those copied parameters. `copy()` converts the
`URL` instance to `{}`, because `Object.assign()` finds no own properties on
it. Verified: after copying, `parsed` is `{}` and `parsed.searchParams` is
`undefined`. Hooks receive the original URL, but controllers and views lose its
data and methods. This is a type-handling bug in `helpers.copy()`, not a
limitation to document as the intended controller API.

Fix it in step 1 with an independent `new URL(source.href)` clone. Verify that
URL properties, methods, and repeated query values survive, and that changing
the clone's `searchParams` does not change the original URL. The plan's
`params.route.parsed.searchParams` guidance depends on this repair; a new array
API for repeated values is not required.

### Existing bug affecting action caching

#### R7. Object `next` without params shares the first controller's action-cache key

Classification: **Bug; reproduced; predates this plan; fix included.**

The README documents object-form `next` without parameters. In that form,
`fireController()` keeps the original route. The next controller's action-cache
key is therefore the original pathname, which the first controller also uses.

Reproduction in production mode, without a layout controller:

```js
// first.js
export const handler = async () => ({
  local: { who: 'first' },
  next: { controller: 'second' },
  cache: { action: true }
})
```

`GET /first` hangs until the client times out. Without `cache.action`, the same
chain returns both controllers' JSON. With `cache.action`,
`next: '/second'` also works. Instrumented HTTP probes confirmed the mechanism:
`second` repeatedly hits `first`'s new `/first` entry, replays its `next`
directive, and loops.

Repair object-next action identity in step 5 while retaining URL parameter
inheritance, public route fields, and original request-cache identity. S1 extends
this finding to the opposite collision: only the second controller cached can
cause later requests to skip the first. The selected repair derives a separate
key from the invoked controller/action and uses it consistently for lookup and
insertion, without replacing route-less object next's public route. Cold and
warm requests must preserve both controllers and their directives regardless
of which cache is populated first.

### Smaller items

- The same name decodes differently by source. `/article/q/a%20b` gives
  `'a%20b'`, while `?q=a%20b` gives `'a b'`. The README should state this
  asymmetry explicitly.
- The motivating OAuth values, `code` and `state`, will appear in `params.url`
  and therefore in development debug output. Access logs already include them
  through the href. Note this for the log-content review in todo #1.
- Add validation coverage for:
  - unlisted tracking parameters under `capture` and `exit`
  - include action-cache identity under parents with and without a query
  - exact-match clearing of distinct path and query keys; clearing groups of
    variants is an R3 exploration rather than required acceptance coverage
  - `ctzn_*` and `callback` handling from query input
  - object `next` after an action-cached first controller (R7)

## Current dispositions

This table is the current planning contract. The dated log below preserves how
decisions evolved; its earlier "still open" statements are historical, not
instructions to undo later selections. All runtime implementation is pending.

| Item | Current disposition |
| --- | --- |
| R1 | Selected: action's own exact pathname/query identity; inherited data does not vary it |
| R2 | Selected: warning and insertion bypass, normal response, no server-error/exit flow; filtering exploratory |
| R3 | Exact-match clearing retained; grouping variants exploratory |
| R4 | Hit-time allowlist validation excluded |
| R5 | Path parameters win, query supplies missing values, framework fields use merged input |
| R6 | Independent URL copying repair included |
| R7 / S1 | Both collision directions covered; controller/action-derived key preserves route-less object next's public route fields |
| S2 | Selected: action insertion checks only own-route input names; request insertion checks request names |
| S3 | Safe structured warning names and explicit control/line-separator escaping required |
| S4 | Supported accessor reads preserved; dangerous segments and executable selectors rejected |
| S5 | Todo #12 required before forced-JSONP integration acceptance; assert headers and bodies |
| S6 | Existing repairs land separately first; query parsing ships after prerequisites and combined regressions |
| S7 | This table supersedes historical status statements without rewriting the log |
| Decoded HTML | Todo #2 shipping prerequisite and combined initial/cached HTML regression required |
| Debug evaluation | Restricted selectors selected, with ordinary inspection compatibility |
| JSONP callbacks | Validation and nonfatal HTTP 400 selected, including cache reuse and forced formats |
| Direct requests | Skip next/layout; honor redirects on cold/warm requests and before conditional responses |

## Decision log

### Review reconciliation

Date: **2026-10-06**. These decisions update the draft following the appended
review and maintainer feedback. They concern planned implementation scope;
the bug fixes described here have not been implemented.

- **R3 — Exact-match clearing retained; grouped clearing exploratory.** The
  maintainer pointed out that `/article/id/123/page/2` and
  `/article/page/2/id/123` already produce separate cache entries. Extending
  invalidation to every equivalent URL would expand the current contract.
  The plan now keeps exact-match clearing as the required behavior and asks
  for an assessment of work, indexes or metadata, timer handling, and API
  complexity before proposing grouped clearing. Grouping query variants of one
  literal pathname and grouping reordered path parameters are separate levels
  of scope. Neither is an acceptance requirement for todo #8.

- **R5 — Path values win; query framework parameters remain supported.** The
  maintainer reconsidered the previously approved query-wins revision because
  a third party's appended query must not change explicit route intent. The
  parser therefore merges query values followed by path values. It derives
  `action`, `descriptor`, and parameter-based `direct` from that merged scope:
  `/article?action=edit` selects `edit()`, and
  `/article/action/edit?action=review` still selects `edit()`. This supersedes
  query precedence, while retaining query fallback for parameters absent from
  the path. Controller selection and the underscore-path direct-request rule
  continue to use the pathname. Examples, inheritance rules, documentation
  tasks, and validation cases were revised together.

- **R6 — URL copying classified as a helper bug and included in the plan.**
  In response to the maintainer's question, a local probe confirmed that
  `helpers.copy({ route: { parsed: new URL(...) } })` loses the URL type and
  produces an empty `parsed` object. The plan now requires explicit URL
  handling with an independent `new URL(source.href)` clone. Another probe
  verified that this retains repeated query values and allows changes to the
  clone without modifying the original. The rationale is to repair lost
  request data and methods at the copy boundary, rather than introduce a
  separate repeated-query API. Helper and controller/view integration
  regressions were added to the validation plan. Broader class-instance
  cloning remains outside this fix.

- **R7 — Object-next cache collision included as a required bug fix.** The
  maintainer explicitly selected this repair for the query plan. Instrumented
  HTTP probes confirmed that object `next` repeatedly retrieves the first
  controller's cached `/first` entry and replays its `next` directive. The
  planned remedy normalizes the replacement route to the selected controller
  and action, following the existing object-include approach, and uses that
  route for action-cache lookup and insertion. URL parameter inheritance and
  original request-cache identity are preserved. Cold and warm requests,
  explicit actions, query input, and both controllers cached are required
  regression cases. The fix does not require a global change to ordinary
  query-free cache keys.

Security evidence was also corrected: the original closing-script-tag path
example contains a slash and does not produce one `name` parameter, so it was
replaced with a verified input-tag example. A benign `Math.max(1,2)` probe
confirmed that debug evaluation already accepts executable path expressions.
HTTP probes confirmed the existing direct-request login-redirect bypass and,
with query parsing simulated in a disposable app, the same bypass through
`?direct=true`. These corrections strengthen the evidence; they do not resolve
the security policies or add those repairs to the selected scope.

**Still open:** R1 action/include cache identity, R2 allowlist reporting and
tracking parameters, R4 hit-time validation, and the security findings. The
recommendations to use only an action's own route for identity, make allowlist
failures nonfatal, and remove hit-time validation have not been adopted as
decisions. Steps 3 and 4 remain provisional where those findings apply. The
plan remains a draft with review open.

### Action cache identity decision

Date: **2026-10-06**. The maintainer agreed to resolve R1 using each action's
own pathname and exact query string. For the requested action, that is its
request route; for an include or chained action, it is its explicit or
normalized target route. Parent path and query parameters remain available as
inherited data but do not vary the target action's cache key.

The rationale is to preserve the documented include-cache contract and avoid
duplicating a shared include for every parent page or tracking query. Cached
output that depends on inherited data requires the application to express that
data in the target route. For example, `/_header` retains one key across
different parents, while `/_header?section=articles` creates a distinct key.
Order, encoding, and duplicate query occurrences remain significant; the
decision introduces no canonicalization or broader clearing guarantee.

The status, step 1 metadata guidance, step 4 key design, include-cache
documentation tasks, HTTP validation cases, completion criteria, and R1 review
disposition were reconciled. The inherited-input signature was removed from
the current design. Earlier log entries record the state when R1 was still
open; this entry supersedes that status.

**Still open after R1:** R2 allowlist reporting and tracking parameters,
R4 hit-time validation, and the security findings. R1 does not select a new
reporting policy, ignored-query configuration, or hit-validation behavior.

### Cache validation classification

Date: **2026-10-06**. The maintainer identified that an invalid cache URL
parameter is incorrectly treated as a server error. The current path creates
an `Error` without a status code, and the error handler defaults it to 500,
logs a stack trace, and invokes the server-error application hook. The plan now
distinguishes cache-validation diagnostics from server failures. An allowlist
rejection establishes cache ineligibility rather than an invalid HTTP request.

This resolves the classification part of R2. Its logging level, reporting
destination, and nonfatal error-flow treatment remain open, as does the
separate question of excluding tracking names from cache identity. A 400
classification by itself would still reach the current generic `exit` policy,
so selecting a lower status code alone does not resolve the whole finding.
Step 3 now marks the existing error-event and exit behavior as a baseline under
review instead of an agreed implementation policy.

### Nonfatal cache warning decision

Date: **2026-10-06**. The maintainer agreed to report unlisted cache URL
parameters as nonfatal cache warnings and continue normal processing of the
uncached response. The decision applies to path and query syntax. The rationale
is that a cache allowlist rejection establishes cache ineligibility, not a
server failure or an invalid HTTP request.

Warnings must bypass the server error event, application error hook, HTTP error
status assignment, and process-exit policy. Use direct logging with a
cache-specific diagnostic and the existing client-diagnostic logging controls.
Retain the parameter data for the application and skip insertion. Genuine
runtime errors retain normal error handling. Assigning a 400 alone would not
meet this decision because the current error handler can exit on client errors.

Step 3, the provisional R4 hit-rejection wording, documentation tasks,
acceptance tests, completion criteria, and R2 disposition were updated.
Cache-correctness decision 15 is selected for the future todo #8 implementation;
the existing baseline and its tests must be updated when this plan is executed.
Earlier log entries describing the reporting policy as open are superseded by
this entry. The warning policy is planned, not implemented.

**Still open after the warning decision:** R2 tracking-name exclusions, R4
hit-time validation, and the security findings. No ignored-query configuration
or cache-key normalization was selected by this decision.

### Allowlist-based query-key filtering exploration

Date: **2026-10-06**. The maintainer agreed to explore an optional filtering
mode using the existing `urlParams` allowlist, rather than adding a separate
tracking-parameter ignore list. Only listed query names would affect a filtered
key; all query values would remain available to the application. The exact
pathname and R1's action-own-route identity rule would remain intact.

The default remains nonfatal warning-and-bypass for unlisted path or query
parameters. Filtering requires explicit opt-in because it changes the meaning
of an unlisted query name: the application would be asserting that the value
cannot affect routing, cached output, or replayed directives. Reusing the
allowlist avoids maintaining two overlapping lists, while explicit opt-in
preserves existing cache-eligibility expectations. Path-parameter validation
is not relaxed by this query-only exploration.

Step 3 now includes the exploration, its example, and questions about lookup
policy availability, cache scopes, retained query representation, policy
changes, and clearing. The status, R2 disposition, documentation tasks, and
completion criteria were reconciled. This decision supersedes earlier log
entries leaving the disposition of tracking-name exclusions open. It does not
select a public configuration API or require shipping filtering with todo #8.

**Still open:** R4 hit-time allowlist validation and the security findings.
Exploratory filtering and R3 bulk clearing remain outside completion criteria.

### Hit-time allowlist validation excluded

Date: **2026-10-06**. The maintainer agreed to remove R4's proposed allowlist
validation on cache hits from this plan. Exact own-route keys already separate
query input under the default design. Rechecking a shared include or next hit
against inherited parent parameters would change existing reuse behavior and
conflict with R1's decision to keep those parameters out of action identity.

Allowlist validation remains an insertion-time eligibility check, with the
selected nonfatal warning-and-bypass policy for unlisted names. Existing
entries are reused by exact key without a new validation pass, warning, or
bypass based on inherited input. This decision does not change query parsing,
path precedence, insertion validation, or the exploratory filtering scope.

The provisional check was removed from step 4, and the status, R1/R4
dispositions, documentation tasks, validation coverage, and completion wording
were reconciled. Earlier log entries describing R4 as unresolved or its check
as provisional are superseded by this entry. Runtime code is unchanged.

**Still open:** the security findings. Optional allowlist-based query-key
filtering and R3 grouped clearing remain exploratory, outside completion
criteria.

### HTML escaping selected as a shipping prerequisite

Date: **2026-10-06**. The maintainer agreed to make todo #2's default HTML
escaping a prerequisite for shipping todo #8, with a request-level regression
proving query-supplied markup renders as text. The rationale is that decoded
queries can contain literal HTML, which the current template-literal renderer
emits verbatim through ordinary `${…}` interpolation.

The existing [escaping plan](html-escaping-double-bracket.md) makes `${…}`
escaped by default and `${{…}}` an explicit raw-output choice. That feature
must land before query parsing ships. Keep decoded parameter data unchanged
for controllers; escape at the output boundary. The integration regression
must assert both retained decoded controller input and escaped HTML, including
a cached response. Explicit raw output and URL-scheme validation retain the
escaping plan's existing scope.

The status, shipping prerequisite, documentation tasks, validation, completion
criteria, and reflected-XSS review disposition were reconciled. A dependency
note and cross-feature regression were added to the escaping plan with a link
back to this decision. Earlier log entries describing the HTML policy as open
are superseded. These are planning changes; neither feature is implemented by
this update.

**Still open:** development debug `eval()`, JSONP callback validation, and
direct-request redirect handling. Optional allowlist-based query-key filtering
and R3 grouped clearing remain exploratory.

### Debug selector repair included with inspection compatibility

Date: **2026-10-06**. The maintainer approved including the bounded
`ctzn_inspect` repair, with the condition that the end result remains the same.
The selected approach replaces eval with restricted object/property lookup,
then keeps the existing `util.inspect()` and escaped HTML debug presentation.
The README's `params` and `params.session` examples must retain their results;
ordinary nested selectors, depth, hidden-property settings, default scope
output, and development/production gating also require compatibility coverage.

Keep `ctzn_*` controls available through path and query syntax with path
precedence. An explicit argument-root map avoids lexical/global evaluation.
Literal property and array selection must not become function execution or
prototype traversal. Check existing selector forms and accessor compatibility
during implementation and resolve any useful-inspection regressions before
landing. Invalid or disallowed selectors should yield a debug diagnostic
without running code or turning the request into an error.

The compatibility requirement preserves selecting and displaying objects.
Arbitrary JavaScript expressions and calls cannot retain execution semantics
while removing URL-driven execution; that is the intentional, documented
limit. This distinction is recorded explicitly rather than promising complete
eval equivalence.

Added implementation step 6 and renumbered documentation to step 7. The status,
framework-control wording, security disposition, documentation, validation,
completion criteria, and current README-step reference were reconciled. This
entry supersedes earlier log entries leaving the debug policy open. Runtime
code remains unchanged.

**Still open:** JSONP callback validation and direct-request redirect handling.
HTML escaping remains a shipping prerequisite. Optional query-key filtering
and grouped clearing remain exploratory.

### JSONP callback validation and nonfatal client rejection

Date: **2026-10-06**. The maintainer agreed to accept JSONP callback identifiers
and dotted names, such as `show` and `app.show`, and reject malformed callbacks
with HTTP 400 before rendering or cache reuse. Apply the rule to both path and
query values after precedence is resolved. The rationale is that the renderer
currently places the callback directly into executable response syntax.

Return a fixed, non-executable diagnostic without reflecting the rejected
value. Keep this client rejection outside the server-error event, application
server-error hook, and process-exit policy. Test both `capture` and `exit`,
including a follow-up request proving the server remains alive. A 400 assigned
through the generic error handler alone would still be subject to exit and
would not satisfy the decision.

Preserve valid callback output, namespace behavior, and normal parameter data.
Validate actual JSONP output, including forced format changes and effective
replacement-route callbacks, with a shared guard before cache reuse and
rendering/writing. Stop the handled rejection from continuing into cache
insertion or another response write. Non-JSONP output is outside this callback
grammar rule. This output guard is separate from the R4 allowlist check that
was excluded; callback and `_` allowlist eligibility still follows R2.

Added implementation step 7 and renumbered documentation to step 8. The status,
security disposition, documentation tasks, validation, completion criteria,
and current README-step reference were reconciled. Earlier log entries leaving
the JSONP policy open are superseded. Runtime code remains unchanged.

**Still open:** direct-request redirect handling. HTML escaping remains a
shipping prerequisite; optional query-key filtering and grouped clearing
remain exploratory.

### Direct requests honor redirects; review decisions reconciled

Date: **2026-10-06**. The maintainer approved including the direct-request
redirect repair. The selected contract is that `direct` skips `next` and the
default layout while honoring hook and controller redirects. Apply it to
path parameters, query parameters, and underscore-prefixed routes with the
existing path precedence and direct-flag truthiness rules.

The rationale is that the existing direct check can turn a hook's login
redirect into a controller response. Earlier disposable HTTP probes reproduced
this for path input and simulated query parsing. Restricting the flag to chain
and layout selection preserves its documented purpose while ensuring redirect
directives are applied. Both initial request handling and shared redirect
handling must drop the direct exclusion; `next()` keeps its direct gate.

Preserve redirect statuses, Location/Refresh behavior, and existing cookie,
session, and referrer handling. Test live hooks, controllers, action directive
replay, and request-cache hits, including matching validators: server redirects
precede 304/body output and refresh redirects retain their status and body.
Update the old HTTP regression asserting direct redirect suppression. The
cache-correctness plan receives a dated cross-reference documenting this future
policy; its historical findings and completed baseline remain accurate.

Added implementation step 8 and renumbered documentation to step 9. Reconciled
the status, parameter table, direct flag and pipeline wording, documentation,
validation, completion criteria, security disposition, and README-step reference.
This entry supersedes earlier log entries leaving direct-request handling open.
Runtime code is unchanged.

Final reference checks also found stale relative code/test links in the related
cache-correctness and escaping plans after their move into `open/`. Those
navigation targets were corrected and noted in each plan without changing the
historical findings or renderer scope.

**Current review decisions are reconciled.** HTML escaping remains a shipping
prerequisite, and debug inspection compatibility is required. Optional
allowlist-based query-key filtering and grouped clearing remain exploratory,
outside completion criteria. Implementation and its regressions are still
pending; this status does not claim the features or fixes have shipped.

## Second review — 2026-10-06

This review covers the reconciled draft above. Classifications follow the first
review, and line references are as of commit `1bfb0b2`. Findings S1–S3 need a
decision or plan change before implementation; S4–S7 are smaller.

### S1. Object `next` entries can also replace the first controller

Classification: **Bug; reproduced; predates this plan. Extends R7.**

R7 and step 5 describe the loop that occurs when the first controller is
action-cached. The shared key also fails in the other direction, when only the
next controller is cached.

Reproduction in production mode, without a layout controller:

```js
// first.js: not cached
export const handler = async () => ({
  local: { who: 'first' },
  next: { controller: 'second' }
})

// second.js: action-cached
export const handler = async (params) => ({
  local: { who: 'second', id: params.url.id },
  cache: { action: true }
})
```

Cold requests to `/first/id/5` and `/first/id/6` return both controllers' JSON.
A repeated `/first/id/5` returns only the `second` namespace with `id: '5'`.
The first controller's own lookup of `/first/id/5` finds the entry that
`second` stored under that key, so `first` never runs. On warm requests its
redirects, cookies, session values, and other directives are skipped, not only
its output. A first controller that performs an access check and redirects is
therefore bypassed once the entry is warm. That consequence follows from
`first` not running; it was not separately reproduced.

Add this case to step 5 and the R7 validation: only the next controller cached,
warm requests, and a redirect returned by the first controller.

#### Route seen by the next controller

Step 5 normalizes object `next` "as object includes already do." For includes,
that replaces `params.route`. Applied to object `next`, the next controller's
`params.route.pathname`, `controller`, `descriptor`, and `parsed` would change
from the original request to `/second`, including the R6 `searchParams` access.
State whether normalization changes `params.route` or only the action key.

Recommendation: derive the action key from the selected controller and action,
expose it as `actionCacheKey` without replacing the route, and leave
`params.route` unchanged. A cache repair should not change the controller API.

Under R1, an object `next` entry is shared across requests either way. Object
`next` has no route of its own to carry parameters, so output that depends on
inherited values requires string `next` with those values in its route.
Document this with the include-cache warning.

### S2. Step 3 still validates inherited names at insertion

Classification: **Design inconsistency with R1 and R4.**

Step 3 applies validation to "actions invoked as includes and queries inherited
by chained controllers." Under R1, inherited names cannot vary an include or
next key, and R4 excluded hit-time checks for that reason. Checking inherited
names at insertion therefore protects nothing: once any parent without unlisted
names fills `/_header`, every parent reuses that entry. The check does have
effects:

- Caching becomes order-dependent. A site-wide `_header` with `urlParams: []`
  is cached only after a parent without tracking parameters requests it.
- Until then, every page view carrying a tracking parameter logs one warning
  per include.
- The descriptor exemption compares against the original controller. An
  include's own descriptor, such as `_head` in `/_head/My-Title`, is not exempt.

Recommendation:

- Action insertion validates only names from the action's own route, exempting
  that route's own descriptor, which is named after the action's controller.
- Request insertion validates the request's names, including query names, as
  step 3 specifies.

Path-only includes are currently checked against inherited path names, so this
changes existing behavior. Document it with the R1 change. Extend the
validation case that adds an unlisted inherited name on a later parent to cover
a cold include under that parent as well as a warm one.

### S3. Cache warnings must escape decoded query names

Classification: **Gap; new with query parsing.**

Path parameter names must match `[A-Za-z-_]+[A-Za-z0-9-_]*`, but decoded query
names can contain any character, including CR and LF (`?a%0Ab=1`).
[`helpers.log()`](../../../lib/helpers.js) writes `label` and string `content`
to log files unchanged; only non-string content passes through
`util.inspect()`. A warning that interpolates names into its label or a content
string would let a client forge log lines. Step 3 should require passing the
names as an array in `content`, or escaping them explicitly. Logging names
rather than values remains correct.

### Smaller items

#### S4. The debug selector restriction conflicts with URL accessors

Step 6 requires the resolver to "prevent prototype-chain traversal." After the
R6 repair, `params.route.parsed` is a `URL`, whose `href`, `pathname`, and
`searchParams` are prototype getters. `request.socket.remoteAddress` is
similar. A resolver limited to own properties would return `undefined` for
them. Define the restriction as rejecting `__proto__`, `constructor`, and
`prototype` segments and never calling function values, rather than as
own-property lookup.

#### S5. JSONP from script elements depends on todo #12

Script elements send `Accept: */*`, which content negotiation in
[`serve()`](../../../lib/server.js#L683) maps to `text/plain`. A script-element
JSONP client, the case the jQuery references describe, receives JSONP only when
a controller forces `response.contentType`. That is todo #12's defect: the
negotiated `Content-Type` header remains. Step 7's forced-content-type tests
will encounter it. Land todo #12 first, or limit those assertions to the
response body and callback handling and record the dependency.

#### S6. Specify a landing order

The R6 and R7 repairs, the debug resolver, JSONP validation, and the
direct-request redirect repair each fix existing behavior reachable through
path syntax; none depends on query parsing. Land each first as a separate
change with its own regressions and CHANGELOG entry. Then land query parsing
(steps 1–4 and 9) after todo #2. Each change stays reviewable, and the security
repairs ship even if todo #8 is delayed.

#### S7. Superseded decision-log statements

The "Review reconciliation" entry still states that R1, R2, R4, and the
security findings are open, and that its evidence corrections do not add those
repairs to the selected scope. Later entries supersede both statements, but a
reader working from the top meets the outdated instructions first. Add a table
of final dispositions above the log, or strike the superseded statements.


## Second-review assessment log

### S3–S7 reconciliation; S1/S2 choices pending

Date: **2026-10-06**. Reviewed all seven findings against the reconciled plan,
`fireController()`, `next()`, `cacheRoute()`, `debug()`, content negotiation,
`helpers.log()`, and the existing HTTP scaffold. Runtime code is unchanged.

- **S1 — Accepted as an extension of the selected R7 repair.** Source review
  confirms that lookup and insertion use the same original pathname for an
  object next without explicit route parameters. This explains both the first
  entry's replay loop and the next entry replacing the first controller on a
  later request. The report's access-check consequence follows from skipped
  first-controller execution; it is an inference, not a separately reproduced
  access-check test. Add both cache-population directions and a first-controller
  redirect regression. Asked the maintainer whether to retain the existing
  next-controller route fields and derive only an action key, as recommended,
  or replace those fields with the normalized target route. No API choice is
  silently assumed.
- **S2 — Valid inconsistency; policy choice pending.** Inherited inputs cannot
  vary the selected R1 key, and R4 intentionally allows reuse without validating
  them on hits. Insertion checks against those inputs therefore gate whether a
  shared entry is created, without protecting later reuse, and exempt the wrong
  controller's descriptor. Own-route-only validation is recommended for actions;
  request validation remains against the request. Asked the maintainer because
  this changes the previously written insertion contract and existing path-only
  include eligibility. Step 3 retains that contract until the answer arrives.
- **S3 — Included as a bounded warning-format requirement.** Logging string
  content/labels directly would allow decoded CR/LF injection. A disposable
  `util.inspect()` probe confirmed that array content escapes CR/LF and terminal
  ESC, but leaves Unicode U+2028/U+2029 literal. Require a fixed label, structured
  names, explicit control/line-separator encoding, and file/console regression
  checks. Keep names decoded in application maps and omit values from warnings;
  no general logger rewrite or new public setting is required.
- **S4 — Reconciled with already approved inspection compatibility.** A probe
  confirmed that URL `href`, `pathname`, and `searchParams`, and socket
  `remoteAddress`, are prototype getters rather than own properties. Replace
  the blanket prototype restriction with rejection of `__proto__`, `constructor`,
  and `prototype` at every segment, no selector/function execution, ordinary
  accessor reads, and bounded diagnostics for read failures. Document that
  trusted getters may run during ordinary property reads. Add getter parity,
  blocked dot/bracket segments, and throwing-getter regressions.
- **S5 — Dependency accepted.** Source confirms that `Accept: */*` falls back to
  plain text and that negotiation sets Content-Type before a forced format.
  Todo #12 owns the header correction. Require it before forced-JSONP acceptance
  and assert headers and bodies on cold/warm and hook/controller-forced paths;
  body-only tests would leave the integration defect unverified.
- **S6 — Landing order specified.** Separate R6/R7, debug, JSONP, and direct
  repairs with their own focused tests/release notes; place the header dependency
  before forced-JSONP acceptance, and todo #2 before query parsing ships. Query
  parsing follows with its combined security and compatibility regressions.
  Separate landing preserves the selected scope and allows existing-path fixes
  to ship if query work is delayed.
- **S7 — Current-disposition table added.** Preserve the append-only history and
  make the current contract explicit above the decision log. Earlier unresolved
  statements and proposed routes remain dated history, superseded only where
  later decisions say so.

The second review is assessed; S1's route API and S2's insertion validation
scope remain open until the maintainer replies. All other required first-review
repairs remain selected, and both cache-key explorations remain non-blocking.


### S1/S2 maintainer decisions and final reconciliation

Date: **2026-10-06**. The maintainer selected both recommended dispositions:
**preserve object-next route fields and change only its cache key**, and
**validate only an action's own route names at insertion**. This supersedes
pending-choice wording in the preceding assessment and the earlier R7 proposal
to replace the next route. Earlier first-review insertion wording is likewise
superseded where it checked inherited names on child actions.

For S1, the selected controller/action determines a separate internal identity
used at both lookup and insertion. Route-less object next keeps its existing
pathname, controller, action, descriptor, parsed URL, and inherited URL scope,
with a per-action `params.route.actionCacheKey` added to that controller's copy.
Explicit route-bearing next directives retain their existing replacement-route
behavior. The rationale is to repair collisions without an unrelated controller
API change. Added the next-only cached regression alongside first-only/both
cached cases, a first-controller redirect/access fixture, retained route getter
assertions, key exposure, and exact clearing. The security consequence reported
in S1 remains an inference until its planned regression is run.

For S2, action validation uses its own route's path/query provenance before
inheritance; the descriptor exemption uses that action's controller and cannot
exempt a query with the same name. Plain object next has no own URL input names,
so retained public request fields must not be reused as child provenance.
Request insertion continues checking request names, including shadowed query
names. This removes order-dependent child population and warning behavior while
matching the already selected key and hit policies. It changes current path-only
include eligibility deliberately and must be documented; it does not detect
whether cached output depends on inherited values. Applications still need to
put such inputs in a string target route or avoid action caching.

Reconciled the status, metadata/pipeline guidance, steps 3–5, public documentation,
validation, completion criteria, R1/R2/R7 dispositions, and the current-disposition
table. The second review has no unresolved design choices. Required repairs and
shipping dependencies remain selected; filtering and grouped clearing remain
exploratory. Implementation and production acceptance are pending; runtime code
and test files were not changed by this review.


## Direction and scope changes — 2026-10-09

The initial implementation merged queries into `params.url`, added query-aware
cache keys and metadata, changed allowlist diagnostics, and implemented the
debug selector prerequisite. Its first full suite passed 154 tests.

The maintainer then selected separate `params.query` data and path-only cache
identity and eligibility, without a query-specific bypass or configuration.
A further scope review removed the leftover metadata, action-key API, path
parser changes, own-route allowlist logic, cache-warning policy, and debug
selector repair from this feature. Existing path behavior remains intact;
request-cache lookup/insertion omit queries with two key-expression changes.
The current contract and validation are in [the active plan](url-query-params.md).
Earlier merged-query decisions in this archive are superseded.
