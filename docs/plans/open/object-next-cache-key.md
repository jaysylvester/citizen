# Object `next` action-cache identity

Target release: **2.0** (see [todo #14](../todo.md)).
Status: **Approved; implementation pending.** Bug; reproduced; predates query
parsing ([todo #8](url-query-params.md)).

Moved out of the query plan (pre-split step 5, findings R7 and S1) on
2026-10-06. Review history is in
[url-query-params-history.md](url-query-params-history.md). Line references are
as of commit `1bfb0b2`.

## Problem

The README documents object-form `next` without route parameters. In that
form, [`fireController()`](../../../lib/server.js#L1050) gives the next
controller a copy of the original route, so its action-cache key is the
original pathname, the same key the first controller uses. The collision fails
in both directions. Both reproductions ran in production mode without a layout
controller.

**First controller cached: the request hangs.**

```js
// first.js
export const handler = async () => ({
  local: { who: 'first' },
  next: { controller: 'second' },
  cache: { action: true }
})
```

`GET /first` hangs until the client times out. Without `cache.action`, the
chain returns both controllers' JSON, and `next: '/second'` with `cache.action`
also works. Instrumented probes confirmed that `second` repeatedly hits
`first`'s new `/first` entry, replays its `next` directive, and loops.

**Next controller cached: the first controller is skipped.**

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
A repeated `/first/id/5` returns only the `second` namespace: the first
controller's lookup of `/first/id/5` finds the entry `second` stored under that
key, so `first` never runs. Its redirects, cookies, session values, and other
directives are skipped on warm requests. A first controller that performs an
access check and redirects is therefore bypassed once the entry is warm; that
consequence follows from `first` not running and has not been separately
reproduced.

## Decision

The maintainer selected a key-only repair that keeps the existing route API:
derive the next controller's action key from the controller and action it
invokes, and leave its `params.route` unchanged.

## Specification

Derive the key from the controller and action actually selected by the `next`
directive, before the directive is cleared. `next: { controller: 'second' }`
uses `/second`; an explicit action uses `/second/action/<action>`. An inherited
`params.url.action` or the retained `params.route.action` must not change that
selection. Default action and view selection are unchanged.

For object `next` without `params.route`, leave the next controller's
`params.route.pathname`, `controller`, `action`, `descriptor`, and `parsed`, and
its URL parameter inheritance, unchanged. An explicitly supplied
`next.params.route` still replaces the route as before and supplies the
action's own route. Keep the original request route and full URL intact for
request-cache identity and response assembly.

Store the derived key with the chain link so insertion uses the same identity
as lookup; never reconstruct it from the retained route fields. Ordinary
query-free route keys are unchanged; do not introduce a global key format.

Route-less object `next` entries become shared across requests, like string
`next` and include entries for the same controller and action. Output that
depends on inherited values needs a string `next` with those values in its
target route, or no action caching.

### Interaction with query parsing

When todo #8 lands, a route-less object `next` has no own URL input, so its
action insertion checks no names, and its derived key is exposed as
`params.route.actionCacheKey` while its other route fields still describe the
original request.

Keep the internal identity and own-input provenance with the action, separate
from its preserved public route. Todo #8's shared key/check helpers must consume
that record at lookup and insertion rather than derive another key or inherit
the original request's name set. If #8 lands first, add this record here when
repairing the collision; if this repair lands first, #8 must preserve it. The
query plan does not implement this repair or require it as a shipping gate.

## Validation

- Object `next` completes on cold and warm requests with only the first
  controller cached, only the next controller cached, and both cached.
- Warm the next controller, then repeat the first route: the first controller
  still runs and applies a fixture redirect or access decision. Without a
  redirect, warm output keeps both controller namespaces.
- Cover default and explicit next actions, explicit `next.params.route`, and
  output parity with string `next`.
- Assert distinct lookup and insertion keys, invocation counts, no replay loop,
  and unchanged public route fields for route-less object `next`.
- After todo #8, add query-bearing input and check `actionCacheKey` and exact
  targeted clearing, without mutating another chain link or the original full
  URL.

Verify the combined contract once both #8 and #14 land: query-bearing parents
retain their own first-action keys, object-next actions retain their derived
keys and empty own-input checks, and neither integration overwrites the other.

Document in the README's caching and chaining sections that route-less object
`next` entries are shared across requests, and add a CHANGELOG entry that
describes both the fix and that change.

## Split-review log — 2026-10-06

The extracted plan retains both reproduced collision directions, the selected
key-only repair, public route compatibility, and its independent validation.
Clarified the internal identity/provenance handoff with todo #8 and ownership
of combined regressions. Neither landing order silently puts this repair back
into query scope. No runtime or test changes were made.
