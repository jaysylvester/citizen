# URL query parameter implementation plan

Target release: **2.0** (see [todo #8](../todo.md)).
Status: **Implemented and validated after scope cleanup — 2026-10-09.**

## Direction change — 2026-10-09

The maintainer selected separate query data and path-based caching after the
initial implementation. This supersedes merging queries into `params.url`,
query-selected framework controls, query-aware cache keys, and query-name
allowlists. The earlier decisions remain in
[url-query-params-history.md](url-query-params-history.md).

Use `params.query` for decoded values and keep `params.url` exclusively for
citizen path parameters. Queries never vary cache keys or eligibility. There
is no query cache bypass or configuration: adding a tracking query must still
reuse the same cached content. Developers decide which routes to cache; auth
callbacks and other routes that must process each query should remain uncached.

## Scope cleanup — 2026-10-09

Review against the new direction removed cache metadata records, router cache
helpers, `actionCacheKey`, cached-include wrappers, route/path cloning changes,
and own-route allowlist checks. Existing action caching and path parsing need
no changes. Request caching needs only the two key expressions that omit the
query from lookup and insertion.

The nonfatal cache-warning policy and restricted debug selector repair are
independent work again. Their earlier implementations were removed from this
feature; existing allowlist/error policy and debug evaluation were retained at
that cleanup stage. Debug hardening was subsequently implemented independently
under todo #1; see [its implementation record](debug-inspect-selector.md#independent-implementation--2026-10-09).
No future object-next handoff is implemented in advance. Narrow helper changes
remain necessary to copy and merge arbitrary query names correctly.

## Parameter contract

For `/callback/id/path?code=abc&state=xyz&id=query`:

```js
params.url   // { id: 'path' }
params.query // { code: 'abc', state: 'xyz', id: 'query' }
```

`parseRoute()` uses `Object.fromEntries(url.searchParams)` for
`route.queryParams`; `serve()` exposes it as `params.query`. Hooks, controllers,
and views receive the new scope. `request.url`, `route.url`, and the parsed
URL retain the complete query. Framework routing remains path-only.

| Query | `params.query` |
| --- | --- |
| `?tag=first&tag=last` | `{ tag: 'last' }` |
| `?label=two+words&literal=%2B` | `{ label: 'two words', literal: '+' }` |
| `?empty=&flag` | `{ empty: '', flag: '' }` |
| `?filter%5Bid%5D=237&a.b=flat` | `{ 'filter[id]': '237', 'a.b': 'flat' }` |

Names remain literal, flat, and case-sensitive. Values remain strings, decoded
once with the native URL parser's malformed-escape behavior. Repeated decoded
names use their last value. Own keys such as `__proto__`, `constructor`,
`prototype`, and `_onTimeout` survive independent copies and merges. Timer
objects retain their existing helper-copy behavior.

Path grammar and encoding are unchanged. `/article/q/a%20b` supplies
`params.url.q === 'a%20b'`; `?q=a%20b` supplies `params.query.q === 'a b'`.
Applications needing all duplicates can use
`new URL(request.url, params.route.base).searchParams.getAll('tag')`.

Query names such as `action`, `direct`, `callback`, `ctzn_*`, and controller
names are ordinary data. They do not select actions, descriptors, direct
requests, JSONP callbacks, or debug controls.

## Inheritance and output

String includes and `next` routes extend the original path and query scopes
separately. Target path values override inherited path values; target query
values override inherited query values. Object includes inherit queries through
the existing params copy. Each target selects framework fields from its own
path before inheritance. Query map mutations must not affect the original
request or parallel includes; inherited queries are not appended to target URLs.

The template-literal engine exposes `query` as a named view scope.
Ordinary `${query.name}` HTML interpolation uses the completed escaping
boundary from todo #2. JSON/JSONP payloads and plain text retain ordinary
strings. Request logs, post-response logs, and configured HTML debug output
share scope selection and include `query` when enabled. Existing path debug
controls can inspect it. Query `ctzn_*` values cannot enable debug or replace a
path selector. Debug selector hardening is implemented separately under todo #1.

## Caching

Action keys remain each action/include/string-next target's own pathname.
Request lookup and insertion use the origin plus pathname. The origin keeps
request and action entries distinct in the shared route cache scope. Static
file selection and caching are unchanged.

Query presence, values, order, duplicates, spelling, and a bare trailing `?`
affect neither keys nor eligibility. Existing `urlParams` allowlists continue
to inspect `params.url`, including inherited path values under current behavior.
Queries never enter this scope, so no allowlist or diagnostic changes are needed.

A hit skips the cached controller. Routes needing fresh query-dependent work
or output should remain uncached; a conditional directive returned on a miss
cannot veto an existing hit. Values that distinguish cached content belong in
the citizen path, or that route must remain uncached. The same responsibility
applies to parent request caches and child action caches.

Clearing remains exact: pass the action pathname or the request origin plus
pathname, without a query. No new cache-key API or metadata is exposed.

## Independent work

Default HTML escaping (#2) is implemented and provides the output boundary for
query values. [Debug selector hardening](debug-inspect-selector.md) is also
implemented as an independent change under todo #1. The following remain
independently planned and unimplemented:

- JSONP callback validation and direct-request redirects under todo #1. The
  separate query scope does not expand their path-based control surfaces.
- Nonfatal path-cache allowlist diagnostics. Existing application error-hook
  and `citizen.errors` behavior is retained by this feature.
- URL copying (#13), [object-next cache identity](../open/object-next-cache-key.md)
  (#14), and string-next chain state (#15).
- Method policy, eviction, single-flight, and forced-format cache architecture.

## Validation

Unit and HTTP regressions cover decoded scalar query data; independent path
and query scopes; special own keys; untouched original URLs; callback handling;
escaped HTML; string/object include and next inheritance; shared cold/warm
cache entries across queries; request fills from warm actions; exact clearing;
and query names that cannot activate framework/debug controls. Existing cache
allowlist/error-policy and escaping regressions retain their original contract.

README, MIGRATION, CHANGELOG, todo, and dependent plans reflect this scope.
Validation on Node.js **24.13.1**: `npm test` passes **130 tests**, with no
failures or skips. ESLint passes for changed runtime/test files, and
`git diff --check` passes. HTTP fixtures required localhost access outside the
execution sandbox.

Review follow-up — 2026-10-09: corrected console scope selection to honor
`debug.scope.query` through the shared `debugScopes()` helper. `extend()` now
uses `defineProperty` only for an own `__proto__` key, and `fireController()`
reuses the independent query map already built for string `next` targets.
The fallback retains the controller's initial params copy. These cleanups
preserve query isolation, special keys, routing, and cache behavior.
The full suite passes **135 tests** on Node.js **24.13.1**, with no failures
or skips; ESLint and `git diff --check` pass.

## Future work

The earlier allowlist-based query-key filtering proposal is superseded: all
queries are excluded from cache identity and eligibility. Broader clearing for
reordered equivalent citizen path parameters remains deferred. Query-variant
clearing is no longer needed.
