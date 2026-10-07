# URL query parameter implementation plan

Target release: **2.0** (see [todo #8](../todo.md)).
Status: **Reviewed after scope split; implementation pending.**

Scope was reduced on 2026-10-06. Repairs to existing behavior found during
review now have their own todo entries and plans; see
[Moved out of scope](#moved-out-of-scope). The full review and decision history
before the split is in [url-query-params-history.md](url-query-params-history.md).
Line references are as of commit `1bfb0b2`.

## Goal

Parse traditional query strings into `params.url` so redirects from external
APIs work without application parsing workarounds. Check query names against
the existing cache `urlParams` allowlists. Keep cached output isolated: request
caches distinguish full URLs, and action caches distinguish each action's own
pathname and query string.

For example, `/callback?code=abc&state=xyz` should supply:

```js
params.url = { code: 'abc', state: 'xyz' }
```

## Shipping prerequisites

Query values are decoded, so they can contain characters that path values never
do. Two existing exposures become much easier to reach, so query parsing must
not ship until both are repaired:

- **HTML escaping (todo #2).** The URL parser percent-encodes `<`, `>`, and `"`
  in paths, but decoded query values can contain them. The template-literal
  renderer currently emits `${url.name}` raw. Todo #2's
  [escaping plan](html-escaping-double-bracket.md) makes `${…}` escape by
  default. Keep query values decoded and unchanged in `params.url`; escaping
  belongs at the HTML output boundary. The combined regression is listed under
  [Validation](#validation).
- **Debug selector repair (todo #1).** In development mode,
  [`debug()`](../../../lib/server.js#L1701) passes `params.url.ctzn_inspect` to
  `eval()`. Path values cannot contain `/`, `>`, braces, or spaces, which limits
  payloads. Decoded query values can contain arbitrary JavaScript, and any page
  a developer visits can send one to a local server. The repair is specified in
  [debug-inspect-selector.md](debug-inspect-selector.md).

The JSONP callback and direct-request redirect repairs are independent and do
not gate this feature; both exposures are reachable through path syntax today.
The pre-split plan gated on them.

The URL-copy and object-next repairs (todos #13 and #14) are also separate.
Do not implement them as side effects of this feature. The object-next cache
guarantees below apply once #14 lands; until then its known collision remains
outside this plan's acceptance checks. Either landing order must keep the
shared key mechanism compatible, as described in step 4.

## Current behavior

- [`lib/router.js`](../../../lib/router.js) constructs a WHATWG `URL`, but
  `getUrlParams()` reads only its pathname. `parseRoute()` derives the action,
  descriptor, and direct-request flag from those path parameters.
- [`serve()`](../../../lib/server.js#L592) assigns `route.urlParams` to
  `params.url`, so controllers, hooks, and views cannot see query values.
- String `next` and `include` directives call `parseRoute()` with a replacement
  route. Their parameters extend the original request's path parameters.
- Request-cache lookup and insertion use `parsed.href`, including the query
  string. Action-cache lookup and insertion use only `pathname`, including for
  includes.
- `cacheRoute()` checks every key in the action's `params.url`, including names
  inherited from the parent, against an optional allowlist. It exempts the
  original controller's name to allow a path descriptor. A failed check emits
  the server `error` event as a server-level diagnostic and invokes the
  application error hook. The repaired baseline keeps the normal response
  under `capture`; under `citizen.errors: 'exit'` it can terminate the process.

## Parameter behavior

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
| `/article?direct=true` | `{ direct: 'true' }`; a direct request |

Use the existing `url.searchParams` iterator for query decoding; it needs no
dependency. Decode query names and values once, keep them as strings without
type coercion, and follow the native parser's handling of malformed escapes.
Accept query names as literal, case-sensitive keys, including dots, brackets,
and empty names. Do not apply the path-name regular expression or expand names
into nested objects.

Path parsing is unchanged, including its encoding behavior, so the two sources
decode differently: `/article/q/a%20b` gives `'a%20b'`, while `?q=a%20b` gives
`'a b'`. Document this.

Repeated names stay scalar to match the existing URL scope; the last
occurrence wins. Applications that need every occurrence can parse the query
from `request.url`. Once the URL-copy bug (todo #13) is fixed,
`params.route.parsed.searchParams` also works in controllers and views. This
feature does not depend on that fix.

### Precedence

Merge query parameters first and path parameters second, so path values win
collisions and the query supplies values absent from the path. A third party
appending a conflicting query cannot change behavior that the application's
URL states explicitly, while traditional URLs that pass everything in the query
still work.

Framework fields use the merged input, so both syntaxes behave the same:

- `controller` comes from the pathname.
- `action` comes from the merged `action` parameter, defaulting to `handler`.
- `descriptor` comes from the merged parameter named after the controller,
  defaulting to an empty string.
- The parameter-based `direct` flag comes from the merged `direct` parameter.
  The underscore-path rule is unchanged: `/_article` is a direct request even
  when its query has an empty `direct` value. Truthiness rules are unchanged;
  there is no boolean coercion. What a direct request does is also unchanged by
  this feature: it skips `next` and the default layout and, until the
  [direct-request redirect repair](direct-request-redirects.md) lands, skips
  redirects too. Query parsing makes that reachable through `?direct=`.

A query cannot override an explicit path value, but a previously ignored query
can now supply an application or framework parameter that the path omits.
Document that compatibility impact for 2.0.

The `ctzn_*` development controls work through both syntaxes with the same
precedence. Their behavior is defined by the debug selector repair, which ships
first.

## Implementation steps

### 1 Parse and record each route's own input

Keep `getUrlParams(pathname)` responsible for path parsing. In `parseRoute()`:

1. Parse path parameters and select the controller from the pathname.
2. Collect query entries, assigning the last value for each decoded name.
3. Merge query parameters, then path parameters, into `route.urlParams`.
4. Derive `action`, `descriptor`, and the parameter-based `direct` flag from
   the merged map, keeping the underscore-path rule.
5. Record the route's own input for step 3: its path parameter names and its
   distinct decoded query names, including names shadowed by path values.
   Record its exact query suffix for step 4, including a bare trailing `?`.
   `url.search` alone loses that empty delimiter; retain it from the route's
   serialized URL before any fragment, without reserializing query pairs.

Keep this metadata on the route, separate from `params.url`, so it cannot
collide with application parameter names. Static-file detection and paths keep
using `url.pathname`; static requests do not enter the controller pipeline.

Build and merge URL parameter maps with own data properties. Query names can
be `__proto__`, `constructor`, `prototype`, or `_onTimeout`, and must stay
ordinary string keys through parsing, copying, and inheritance. In
[`helpers`](../../../lib/helpers.js), `Object.assign({}, source)` can drop an
own `__proto__` key, and `copy()` treats any truthy `_onTimeout` as a timer
marker and returns the object by reference. Make only the narrow helper or
URL-map copying changes needed to keep these keys and avoid shared mutable
maps. Broader hardening stays under todo #1.

### 2 Carry parameters through the controller pipeline

Keep the initial `params.url = route.urlParams` assignment in `serve()`.
Update the merge sites for string `next`, string includes, and object includes
to carry each route's own-input metadata alongside the effective parameters.

Keep the existing inheritance rule: a replacement route extends the original
request's URL scope, and its explicit parameters win. Within each route, its
path values win over its own query values. For example, a request
`/article?code=parent&page=1` with an include `/_head?page=2` gives the include
`{ code: 'parent', page: '2' }` without changing the parent's URL scope.

Resolve a replacement route's framework fields from its own merged path and
query parameters before inheritance, so an inherited `action` cannot change the
replacement controller's action. `/article?action=edit` including `/_head`
still invokes `_head.handler()`, while an include `/_head?action=meta` invokes
`_head.meta()`. Explicit object-directive action selection is unchanged.

A replacement route without a query inherits the original query data through
the parameter merge; `parseRoute()` must not append `request.url`'s query to
the replacement URL. Audit controller copies, hook arguments, and view context
construction so the same effective URL scope reaches each consumer.

### 3 Check cache allowlists and report nonfatal warnings

Choose the names to check by cache mode:

- **Request insertion** checks the request's effective `params.url` keys plus
  its recorded query names, including names shadowed by path values or removed
  from the map by a hook. The descriptor exemption uses the original request's
  controller.
- **Action insertion** checks only the path and query names from that action's
  own route, before inheritance. This applies to the first action, includes,
  and string `next` routes. Inherited parent names reach the child controller
  as data but do not affect its insertion or produce warnings. Route-less
  object `next` remains governed by [todo #14](object-next-cache-key.md).
  Before that repair, retain its existing route-based identity/provenance;
  once it lands, use its controller/action-derived identity and empty own-input
  name set rather than the retained public request fields.

Exempt a path descriptor only for the controller whose own route is being
checked, and only if that name did not also arrive in that route's query.
`/_head/My-Title` passes `urlParams: []`, while `/_head/My-Title?_head=other`
requires `_head` to be listed despite path precedence.

This changes existing path-only behavior. Today a child's insertion is checked
against inherited parent names, so whether a shared include is cached depends
on which parent requests it first, and the exemption uses the original
controller. Inherited names cannot vary the child's key (step 4) and hits are
not rechecked, so checking them protected nothing. Document the change.

Allowlist semantics:

- An omitted `urlParams` allowlist imposes no restriction.
- `urlParams: []` permits no query names; the path-descriptor exemption still
  applies to path-only input.
- A listed name may be cached. An unlisted name bypasses insertion; it is not
  deleted from `params.url`.

An unlisted name, from either syntax, produces a nonfatal cache warning. This
resolves cache-correctness decision 15.

- Bypass insertion and continue normal processing. Log the warning directly:
  do not emit the server `error` event, set an error status, include a stack,
  call the application error hook, or apply `citizen.errors: 'exit'`.
  Responses are unchanged under both `capture` and `exit`.
- Use the existing client-diagnostic logging controls with a fixed,
  cache-specific label. Report offending names only, not values, the full URL,
  or the cache key.
- Pass names as structured array content, never interpolated into the label or
  a content string. `helpers.log()` writes labels and string content raw.
  `util.inspect()` escapes CR/LF and terminal controls but leaves U+2028 and
  U+2029 literal, so escape those as well. Escaping applies only to the
  diagnostic, not to parameter maps, eligibility, or keys.
- Genuine controller, rendering, and cache-storage failures keep normal error
  handling. `cache.invalidUrlParams` is not reinstated.

Keep the selected client-diagnostic level and existing logging controls.
Deduplicate offending names within one insertion attempt and issue one
structured warning for that attempt. A request with rejected action and
request insertions can therefore issue two warnings. Do not add cross-request
suppression state or move warnings to debug level as part of query parsing.

### 4 Isolate action caches by query input

Controllers can now read query values, so pathname-only action keys would serve
one query's output for another: `/article?id=1` and `/article?id=2` must not
share an entry. Implement one action-key helper and use it at every lookup and
insertion site, including include lookup and `cacheRoute()`.

The key is the action's own pathname plus its exact query suffix. Routes without
a query keep their existing pathname keys. Keep query order, duplicates, and
encoding as received; do not sort, decode, or reserialize the query, mutate
`parsed.href`, or append a parent's query. An action's own route is:

- for the first action, the request URL;
- for a string include or `next`, its explicit target route;
- for an object include, its normalized target route (unchanged); and
- for route-less object `next`, as defined by todo #14.

Consume an existing per-action identity supplied by #14 instead of rebuilding
it from the controller's preserved `params.route`. If #14 has not landed, do
not silently implement its controller/action-derived key here: its existing
route-based key remains a known defect owned by that plan. Query regressions
cover requested actions, includes, and explicit replacement routes; the
object-next plan owns combined regressions once both changes land. Neither
plan may overwrite the other's key or metadata at lookup or insertion.

For requested actions, includes, and explicit replacement routes, inherited
parameters reach controllers without adding key inputs. The same rule applies
to route-less object next once #14 lands. `/_header` has the key `/_header`
under `/article/id/123?source=email` and
`/article/id/456?source=social`; `/_header?section=articles` is a separate
entry. If an include or `next` controller's cached output depends on an
inherited value, the application must put that value in the target route or not
cache that action. This extends the README's existing include-cache rule to
query syntax.

Expose the actual key as `params.route.actionCacheKey` on that controller's
copied route, on misses and hits, without mutating the original request or
another chain link. Applications can pass it to `app.cache.clear({ route })`.

Do not check allowlists on cache hits; reuse entries by exact key. Request
caches keep their full-URL keys and content-type separation.
[`lib/cache.js`](../../../lib/cache.js) needs no new scope, eviction policy, or
single-flight mechanism.

Clearing stays exact-match. Reordered path parameters and distinct query
orderings or spellings are separate entries and are cleared separately.

### 5 Document the public behavior

Update [`README.md`](../../../README.md):

- Routing and URL-scope examples with path, query, and mixed URLs: precedence,
  repeated values, the decoding difference, literal names, framework fields
  from merged input, inheritance, and the compatibility impact of previously
  ignored query values now supplying parameters, including `action`, `direct`,
  and descriptors.
- Replace the statement that query strings are not parsed or checked by cache
  allowlists.
- Query-aware action keys, `actionCacheKey`, and exact-match clearing for action
  keys versus full-URL request keys. The current `cache.clear({ route })`
  example matches action entries only.
- The include-cache warning: inherited values do not vary a key in either
  syntax.
- Own-route action checks versus request checks, the descriptor exemption, and
  the removal of inherited names from child checks.
- Allowlist examples with valid and invalid query names. Tracking or callback
  names must be listed for those requests to be cached, and each distinct value
  then gets its own entry.
- Nonfatal warnings for both syntaxes, independent of `citizen.errors`,
  replacing the error-event behavior.
- Escaped interpolation of query values, linking todo #2.

Add the feature, action-cache isolation, own-route checks, and the warning
policy to the 2.0 [`CHANGELOG.md`](../../../CHANGELOG.md) when implementation
lands.

Update [`MIGRATION.md`](../../../MIGRATION.md) with the application-facing
changes: query input now supplies omitted routing parameters, first-action
keys include the query, child insertion checks only its own route's names,
and cache rejection uses warnings rather than application error hooks or exit.
Keep migration entries for the separate repairs in their respective changes.

## Validation

Add `test/router.test.js` using the existing `node:test` setup. Cover the table
above, URLs without queries, encoded names and Unicode, malformed escapes,
empty names, case sensitivity, repeated names after decoding, reserved routing
names, route overrides, static URLs with queries, and special-property names.
Assert that parsing does not modify the original URL or request. Add focused
regressions for any helper changes, and run the existing config and cache tests
to cover the helpers' other consumers.

Extend [`test/cache-http.test.js`](../../../test/cache-http.test.js), reusing
its scaffolded child-process fixtures:

- A callback controller receives `code` and `state`; a hook and an HTML view
  see them through the URL scope.
- After todo #2 lands, an encoded markup value such as
  `<input value="query marker">` reaches the controller decoded and renders as
  escaped text through `${url.name}`, on the initial response and on a cached
  response for an allowlisted name.
- Path and query parameters select actions, descriptors, and direct responses.
  Cover path precedence over conflicting query values, query-only framework
  parameters, defaults, and the underscore-path rule.
  `/article/action/edit?action=review` selects `edit()`.
- Includes and chained controllers inherit query values, apply explicit
  overrides, and cannot mutate the parent's URL map. Inherited `action` values
  do not change a replacement route's action; an explicit query `action` in the
  replacement route does.
- Both cache modes cache listed query names and bypass unlisted ones. Cover
  omitted and empty allowlists, encoded names, shadowed names, controller-name
  queries, and unlisted path names. Under both `capture` and `exit`, verify
  normal responses, retained parameters, warnings when logging is enabled, no
  error-hook call, and no exit, following each `exit` case with another request.
  Genuine controller errors keep their error policy. Rewrite the existing
  invalid-parameter tests that expect an error hook or process exit.
- Capture file and console warning output for names containing encoded CR/LF,
  terminal control bytes, and U+2028/U+2029. Names are escaped, values are
  omitted, no name injects a line or control sequence, and the controller still
  receives the original decoded key.
- Warm bare-path action entries do not satisfy requests whose own route has a
  query. Distinct values, duplicate sequences, and encodings stay isolated;
  identical requests reuse their entries. A bare trailing `?` has no parameter
  names but remains a distinct exact action/request key from a URL without it.
- A cold child with `urlParams: []`, under a parent carrying unlisted inherited
  path and query names, is inserted without a child warning; a second such
  parent reuses it without warnings or bypass. Keep child assertions separate
  from the parent's legitimate request-cache warning. An own path-only
  descriptor is exempt; an own query with that name, even when shadowed, is
  not. An unlisted own child name warns and bypasses. Explicit target-route
  variants get separate entries. Cover a warm action with a cold request cache
  and combined request and action caching.
- `actionCacheKey` matches the key used for lookup and insertion and supports
  targeted clearing. Keep the existing full-URL request-cache regression;
  clearing one query variant preserves the others, and reordered path and query
  parameters keep distinct keys.
- Test one warning per rejected insertion attempt with distinct offending names
  listed once, including when both cache modes reject. Logging-disabled cases
  retain the same response and insertion behavior.

Run the focused router and HTTP tests, then `npm test`.

## Completion criteria

Todo #8 is complete when:

- external callback query values reach `params.url` with the documented
  precedence, decoding, and inheritance;
- request insertion checks request names, action insertion checks only
  own-route names, shadowed query names are not exempted as descriptors, and
  unlisted names produce safe nonfatal warnings under both error policies;
- request caches isolate full URLs, action caches isolate own-route pathnames
  and query strings for requested actions, includes, and explicit replacement
  routes, inherited inputs do not vary those keys, and hits are not rechecked;
- the router and HTTP regressions above pass; and
- todo #2 and the debug selector repair have landed, and the decoded-markup
  regression passes.

Route-less object-next isolation remains todo #14's completion criterion; it
must not become an undeclared repair or shipping prerequisite for todo #8.

## Moved out of scope

These repairs were part of the pre-split plan. Each fixes behavior that exists
today through path syntax and does not depend on query parsing. Their decisions
moved with them.

| Item | Pre-split location | Now |
| --- | --- | --- |
| Debug `ctzn_inspect` evaluation | Step 6 | Todo #1, [debug-inspect-selector.md](debug-inspect-selector.md); ships before this feature |
| JSONP callback validation | Step 7 | Todo #1, [jsonp-callback-validation.md](jsonp-callback-validation.md) |
| Direct requests skipping redirects | Step 8 | Todo #1, [direct-request-redirects.md](direct-request-redirects.md) |
| `helpers.copy()` turning URLs into `{}` (R6) | Step 1 | Todo #13 |
| Object `next` action-cache collisions (R7, S1) | Step 5 | Todo #14, [object-next-cache-key.md](object-next-cache-key.md) |

### Future work

Two explorations remain outside completion criteria and are listed under
"Consider" in [the todo list](../todo.md). Their earlier notes are in the
[history file](url-query-params-history.md#explore-allowlist-based-query-key-filtering).

- **Allowlist-based query-key filtering.** An explicit opt-in mode that reuses
  `urlParams` to choose which query names vary a cache key, so unlisted names
  such as tracking parameters neither vary the key nor block caching. It must
  not become the default, because it turns an unlisted name into an application
  assertion that the name does not affect cached output. The exact pathname and
  own-route rule stay in the key, and unlisted path parameters still warn.
- **Clearing groups of variants.** Clearing every query variant of one
  pathname, or equivalent routes with reordered path parameters, instead of
  exact keys only.

## Split-review log — 2026-10-06

Reviewed the reduced plan, the four extracted repair plans, todo ownership,
the archived pre-split decisions, and the relevant routing/cache/error paths.
The split retains query parsing, precedence, inheritance, query-aware keys,
allowlist integration, and the selected nonfatal warning policy. It supersedes
the archive's JSONP/direct shipping gates: only default HTML escaping and the
debug selector repair remain security prerequisites for query parsing.

- **Object-next handoff clarified.** The reduced draft referred to #14's
  derived key and empty input-name set without requiring #14 to land. Retain
  existing behavior until that independent repair exists; then consume its
  internal identity/provenance instead of reconstructing it from public route
  fields. Combined object-next/query regressions belong to #14 once both land.
  This avoids restoring the collision repair to #8 or creating a hidden gate.
- **Current cache baseline corrected.** `cacheRoute()` reports with
  `respond = false`; the error handler does not turn a capture-mode warning
  into a 500 response. Existing HTTP assertions expect 200 while reporting to
  the error hook. Exit behavior remains. The future nonfatal policy is unchanged.
- **Empty query delimiter preserved.** A disposable URL probe showed that
  `/article?` has an empty `search` but retains `?` in `href`. The promise of
  exact identity therefore needs more than `pathname + url.search`; retain the
  delimiter and test it without adding canonicalization or broader clearing.
- **Warning-volume question resolved within the selected policy.** Keep the
  previously selected client-diagnostic level and controls, with distinct
  offending names grouped once per insertion attempt. Separate rejected cache
  modes may log separately. Cross-request suppression or a debug-level downgrade
  would be a new logging policy and is not needed for query parsing.
- **Migration-guide question resolved as documentation.** Add the selected
  application-facing behavior to MIGRATION.md when #8 lands. This adds no
  migration automation or runtime repair; extracted repairs own their entries.
- **Other plan handoffs checked.** JSONP's header dependency stays under #12;
  controller-forced cache lookup remains deferred cache decision 17. The
  extracted JSONP plan distinguishes forced-format correctness from real cache
  hits and explains the cache-busting guidance. The debug resolver reads the
  original request parameters, so its URL getter checks do not require the
  controller-copy fix in #13. Direct-redirect semantics and tests are retained
  in their own plan.

The archived history remains unchanged. No runtime or test code was changed,
and no independent repair was moved back into query scope.
