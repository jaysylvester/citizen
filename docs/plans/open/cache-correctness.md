# Plan: Cache bug fixes and cold-fill design proposals

Target release: **2.0** (see `docs/plans/todo.md` #5)
Status: **Settled bug fixes and first-entry retention implemented; remaining design decisions deferred**

Before changing cache behavior, read
[Appendix: cache design history and rationale](#appendix-cache-design-history-and-rationale).
It records which current behaviors are deliberate and which are regressions.

The implementation updates below record what changed. The sections after them
describe each defect as it was found, before repair, and are kept as review
history; they are not descriptions of the current code.

## Implementation update — 2026-10-04

Restored unfiltered request-cache header replay and action-cache directive
replay.

`fireController()` copies a cached action's context into a request-local chain
link, then applies the same context merging, headers, session, redirect, and
`next` handling used for misses. Controller/action/params metadata is populated
on both paths. Hits reuse the stored output and rendered includes; controller
invocation, include processing, rendering, and action insertion stay on misses.
The primary-context header and cache deletions remain in place. Request-cache
insertion collects controller directive names from the chain and copies their
final response values without filtering. Each action entry retains its own
context and headers.

Also repaired the independently confirmed JSON include-data bug: parent local
context receives a copy of each include's local data on misses and hits. Include
header, cookie, redirect, and `next` directives remain ignored when called as
includes. An action cached as an include follows ordinary directive handling
when subsequently called as a route.

HTTP regressions cover unfiltered headers on 200 and 304 responses, chain
overrides, request-cache refills from actions, hook-supplied request directives,
cookies and session replay, custom context, multiple cached chain links in JSON
and JSONP, server and refresh redirects, and cached includes' JSON/JSONP data.
Repeated hits preserve stored context/output and metadata while updating normal
expiration bookkeeping; counters verify cached controllers, views, and includes
are not invoked again. Live request-hook context remains available downstream.

Later the same day, request-cache hits were found to ignore headers and
redirects from the `session.start`, `request.end`, and `response.start` hooks.
The maintainer classified this as a bug in scope for this plan. Shared header
and redirect handling now applies their live directives on hits. Controller
headers retain precedence; server-side redirects end the response before cache
validation, and refresh redirects retain their configured status and cached
body even with a matching validator. Ordinary hits still support 304 responses.
Cookie/session handling, direct-request redirect suppression, and stored cache
entries are preserved. See "Hook directives on request-cache hits."

Validation: **87 of 87 tests passed** (38 existing plus 49 cache regression
tests), including all HTTP tests, with none skipped. Changed-file lint and
`git diff --check` pass. Single-flight, method eligibility, and stronger
invalidation remain deferred.

The maintainer also approved the include-storage performance follow-up below.
Action entries now omit the consumed top-level `include` directive after
rendering, using a shallow context copy so the live chain link is unchanged.
Rendered output, `local.include` data, and the remaining cached context and
directives are retained. Existing HTTP tests now cover two includes in cached
JSON/JSONP chains, verify that their working objects are absent from storage,
and check that repeated hits preserve output and do not invoke includes again.

The maintainer then selected first-entry retention instead of coordinating
cold fills. `setRoute()` now leaves an existing route/content-type entry intact,
before converting a duplicate writer's lifespan or allocating its timer. Both
request and action entries retain their original output, context, stored
validator, and expiration bookkeeping. Clearing or expiration still allows a
new fill. This is the explicit insertion-policy choice in decision 10, not an
additional bug classification.

Direct regressions cover numeric and `'application'` lifespans, unchanged timer
identity and allocation count, other content types, and refills after expiry or
clearing. Controlled HTTP races cover request and action fills: both cold
requests render independently, the first completed entry survives the later
writer, and subsequent requests reuse it. Single-flight is deferred; no waiting
registry, method policy, publication guard, or default cold-response ETag
equality was added.

## Implementation update — 2026-10-03

Implemented sections 1–2: explicit lifespan and boolean options, falsy values,
missing-scope lookups, and route-only `exists()`. Also repaired explicit
request-cache `lastModified` propagation and invalid action-cache parameter
reporting under `capture`, preserving current `exit` behavior. Existing file
enablement and unspecified file reset defaults remain in place; explicit
`undefined` values retain their existing omitted-value behavior.

Compatibility choices are explicit for this bug-fix pass: explicit `undefined`
is treated as omitted and documented that way (decision 2); the existing static
file-enablement gate is retained and documented as current behavior (decision
12). Changing either remains future work. The internal `contentType` option to
`clear()` is not newly documented as a public API, and internal expiration and
replacement details stay in this plan rather than the README API description.

The maintainer confirmed that the original distinction between a targeted
content-type clear and a whole-route clear is intentional. Timer presence now
controls only timer cancellation, not clearing scope: supplying `contentType`
clears only that representation, while omitting it clears every representation.
Expiration and replacement preserve other content types. Finding 7 records the
targeted-clear defect and its repair.

The confirming implementation review also found an existing custom file-key
replacement defect: `set({ file, key })` cleared the source path rather than
the stored key, then recursed without removing the old entry. The focused
repair clears the resolved file key; its regression test reads changed file
contents, preserves a distinct file-path entry, and verifies the old timer is
cancelled. The unrelated application error hook template mismatch is recorded
under todo #6.

The maintainer selected full-URL request-cache identity ahead of todo #8.
Lookup now uses `params.route.parsed.href`, matching insertion and preserving
query strings. HTTP regression coverage verifies repeated query-bearing
requests hit their own entries, distinct query strings and the bare URL remain
separate, and clearing one query variant preserves the others. Query parameters
are not yet added to `params.url` or checked by the `urlParams` allowlist; that
remains todo #8, and the README records this interim behavior.

Added regression coverage in [test/cache.test.js](../../test/cache.test.js) and
[test/cache-http.test.js](../../test/cache-http.test.js), updated README option
semantics and retired-mode documentation, and added release notes. Review
follow-up added the custom file-key regression and a yielding error-hook case.
Action-cache `exit` tests assert process exit rather than an HTTP status that
depends on hook timing.

## Objective

Correct demonstrated violations of the existing cache contract. Record
cold-fill coordination as a separate design proposal, with its behavior and
implementation choices identified explicitly.

The original effort identified these issues:

1. `cache.set()` ignores an explicit lifespan because its application/static
   default selection is grouped incorrectly.
2. `cache.exists()` throws when the built-in `app` or `files` scope does not
   exist, rather than returning `false`.
3. Concurrent cold requests all execute the same controller/render pipeline and
   repeatedly replace the same completed route cache entry.

Issues 1 and 2 are confirmed bugs. Issue 3 is an observed performance problem;
the documentation does not promise one execution per simultaneous request
wave. Single-flight is a proposed enhancement, not a prerequisite for fixing
the API defects. This classification does not discard the cold-fill proposal.

Review found additional confirmed bugs, recorded separately below. Each was
added to scope explicitly and has been fixed. Reproduced behavior, a documented
contract violation, and a preferred remedy are distinct kinds of evidence.

## Confirmed defects

### Lifespan selection

The current expression in `lib/cache.js` is:

```js
lifespan = options.lifespan || options.file
  ? CTZN.config.citizen.cache.static.lifespan
  : CTZN.config.citizen.cache.application.lifespan
```

Operator precedence makes it equivalent to:

```js
lifespan = (options.lifespan || options.file)
  ? staticDefault
  : applicationDefault
```

Every explicit truthy lifespan is discarded. For example,
`lifespan: 'application'` selects the default static lifespan of 15 minutes,
which is then converted to `900000` milliseconds. Explicit numeric lifespans
are affected in the same way. A custom scope is not involved in the failure.

The defect dates to the cache cleanup in commit `c7e1121f` from May 31, 2021;
the recent project configuration and `.env` changes did not introduce it.

### Missing built-in scopes

The `cache.exists()` branches for a default application key and a file access
`CTZN.cache.app[...]` and `CTZN.cache.files[...]` without guarding the parent
scope. These scopes are created lazily and can be removed by clearing the cache,
so absence is a normal cache state and should return `false`.

### Related option and value bugs

The documented `resetOnAccess: false` option is lost to `||` fallback in
`cache.set()` and `cacheRoute()`. Static serving passes the configured
`cache.static.resetOnAccess` value into `cache.set()`; when that value is
`false`, the application default replaces it. The same problem affects
`synchronous: false` when the configured default is `true`. These are
option-handling bugs, not grounds for a general validation redesign.

Supporting a `false` override on `cache.get()` remains a design decision. The
README demonstrates turning reset on and describes `exists()` as the lookup
without timer extension. File entries have historically used the application
reset default when no option is supplied; choosing a static default instead is
a planned behavior change, not an established regression.

`cache.set()` also tests the truthiness of `options.value`, so supplied values
such as `0` and the empty string are not stored. The README describes a general
value store without excluding those values. Whether explicit `undefined`
counts as supplied is a separate API decision.

### Other confirmed bugs identified by review

| Bug | Contract or existing operation | Evidence | Scope relationship |
|---|---|---|---|
| Route-only `exists({ route })` throws | The README explicitly demonstrates this lookup. | Direct probe and `cache.exists()` branch inspection. | Related to the original lookup fix; addendum finding 6. |
| Explicit request-cache `lastModified` is ignored by the first response | The directive documents a custom date for conditional request handling. | The first response uses a fresh timestamp; hits use the supplied date. | Independent directive-propagation bug; finding 4. |
| Request-cache hits no longer replay controller `header` directives | The README promises that directive headers survive request caching. Historical replay was always unfiltered, though a key mismatch broke it from July 2021 to April 2024 (see the appendix). | Commit `9826573` deletes directive headers before insertion; HTTP probes confirmed missing headers on hits. | Preservation regression; unfiltered replay restored. Finding 4. |
| Invalid URL cache parameters prevent action rendering with a 500 | The 0.9.0 changelog says errors must not prevent rendering. | An HTTP probe returned a 500 with an empty action response. | Independent behavior bug and a timing concern for insertion changes; finding 5. |
| Request-cache lookup and insertion disagree on the route key | A stored request entry must be addressable by the lookup for that request; both sides used the same key before the 1.0 rework. | Query-bearing entries miss lookup and may alias a warm bare-path entry. | Key-consistency defect, repaired using full-URL identity selected by the maintainer; finding 1. |
| A targeted clear deletes other content types when the target has no timer | The maintainer confirmed that choosing a content type versus clearing the whole route is intentional; timer presence should control only cancellation. | Direct probe with non-expiring HTML and JSON entries. | Focused clearing repair; finding 7. |
| Replacing a file entry with a custom key overflows the stack | The README supports custom file keys and the 1.0.0 changelog promises replacement of existing keys. | Direct reproduction: `clear(options)` uses the path but the entry is stored under `key`, so recursive `set()` never removes it. | Existing adjacent file-cache bug; repaired at the replacement call site. |
| Request-cache hits ignore headers and redirects from `session.start`, `request.end`, and `response.start` | The README says hooks can set directives and pass them on, and misses act on them. | Before repair, HTTP probes showed dropped headers on hits, and a `response.start` redirect returned a 302 on a miss but the cached page (200) on a hit. | In scope because caching drives it; could bypass hook-based access redirects. Repaired through shared live directive handling, including conditional requests. See "Hook directives on request-cache hits". |
| JSON responses drop a cached include's `local` data | The 1.0.0 changelog promises "the local context of the entire controller chain and all includes" in JSON responses. | Before repair, an HTTP probe showed the parent's JSON with `include: { inc: … }` on the include's miss and no `include` key on its hit; assignment ran only on misses. | Independent repair: include local data is copied to the parent on both paths, covered in JSON and JSONP. See "Additional finding: action-cache directive replay". |
| Action-cache hits do not act on the cached action's directives | The README says a cached action's context is also cached and its cookie and session directives apply on later requests. `9826573` passed the cached context through ordinary directive handling on hits, apart from framework housekeeping. | Before repair, an HTTP probe showed a cached action's `next` and `cookie` ignored, making the hit render a different page. Introduced by `4df033f`. | Regression; ordinary directive handling restored while rendered output is reused. See "Additional finding: action-cache directive replay". |

These statements describe the faulty behavior. A particular helper, storage
layout, return value, or refactoring technique is not part of the bug definition.

### Hook directives on request-cache hits

Found on 2026-10-04 and classified as a bug by the maintainer the same day.
Caching drives the behavior, so it is in scope for cache correctness.

Before repair, the applicable hooks still fired on request-cache hits, because
the cache lookup in `serverResponse()` runs after `response.start`. Only some
of their directives took effect. `session.start` fires only for a new session.
HTTP probes confirmed each row below before repair:

| Hook returns… | Miss | Request-cache hit |
|---|---|---|
| `request.start` headers or redirect | Applied | Applied |
| Cookies or session values (any hook) | Applied | Applied |
| `session.start`, `request.end`, or `response.start` headers | Applied | Dropped |
| `session.start`, `request.end`, or `response.start` redirect | Applied (302) | Dropped (cached page, 200) |

`request.start` directives are handled before routing. Its headers are set in
the `requestStart` handler, and the `request` event acts on its redirect
before the later hooks run. The other hooks' directives merge into the context
and were acted on only inside `fireController()`, which a hit skips. Before
repair, `serverResponse()` applied only cookies and session values from the
live context. This predates
the 2.0 work. Before the April 2024 rework, request-cache entries stored headers
from the merged context, which included these hooks' headers. Whenever replay
worked, they were replayed with the first request's values. They were never
applied live on a hit.

The README says hooks can "set directives" and pass results to the next event
or controller. It does not say that later hooks' directives are ignored on
cache hits. Its example, redirecting unauthenticated users to a login page,
uses `request.start`, which works on hits. The same redirect in `request.end`
or `response.start` is skipped on a request-cache hit, and the cached page is
served instead. A page that is identical for every authenticated user is a
reasonable thing to request-cache, so the bug can bypass hook-based access
checks. The changelog notes that impact.

Action-cache hits are not affected: they now run through `fireController()`,
which acts on hook directives merged into the context.

**Implemented remedy.** Request-cache hits apply the live context's headers
and redirect through the same helpers used by misses. The hit path applies
live hook headers, existing cookie handling, then cached controller headers.
It consumes the live header directive without modifying the stored context,
then handles the live redirect before choosing a conditional response.

- A server-side redirect ends the response with the redirect instead of
  serving the cached page.
- A refresh redirect sets its header, and the cached page is served.
- Redirect handling precedes conditional response handling. A matching
  `If-None-Match` must not replace a server-side redirect with a 304, or replace
  a refresh redirect's configured status and cached body with a 304.
- Live hook headers are applied before the stored controller headers, so
  controller values still win on conflicts, as they do on a miss.

Cookies, session values, and `request.start` handling are unchanged.

**Verify** on request-cache hits that:

- headers from `session.start`, `request.end`, and `response.start` are sent
  with live values, and a stored controller header with the same name still
  wins;
- a server-side redirect from `session.start`, `request.end`, or
  `response.start` redirects instead of serving the cached page, including
  with a matching `If-None-Match`;
- a refresh redirect sets `Refresh` and serves the cached page with its
  configured status, including with a matching `If-None-Match`;
- live hook headers and controller-header precedence also hold on ordinary
  304 responses; and
- `request.start` headers and redirects, cookies, and session values behave as
  before.

**Implementation review — 2026-10-04.** Independent HTTP probes reproduced
the missing header and redirect for each of the three later hooks (six cases).
The review identified two verification gaps: conditional requests and
`session.start` redirects. Before repair, a matching cached validator produced
a 304 with no `Refresh` or body even when `response.start` returned a refresh
redirect; sharing directive handling alone would still have let the existing
304 branch overwrite its status and body. The requirements above cover that branch
explicitly. Session-start tests must use a new session on a warm cache, because
that hook does not fire for an existing session.

**Verification after repair.** HTTP regressions cover all three later hooks'
live headers, cookies, and session values on ordinary and conditional hits;
controller-header conflicts; server redirects with default and explicit
statuses; and refresh redirects with 302 and 200 statuses and matching
validators. Each session-start case uses a new session on a warm cache, with a
separate check that an existing session does not rerun the hook. Request-start
handling and direct-request redirect suppression remain covered. Tests verify
that each redirect invokes the `response.end` hook once, stored entries remain unchanged,
and a later hit does not replay a cached hook's headers or refresh redirect.

### Stale invalid-parameter documentation

The 0.9.0 release (`e596f28`) deliberately retired the configurable warning/error
modes: invalid cache parameters always report an error but must not prevent
rendering. Calling the error hook on the request-cache path is therefore
intended behavior. The README's mode descriptions were stale: commit `c6610ac`
carried the 1.0.0-era description into the 2.0 config table. On 2026-10-04 the
unused `invalidUrlParams` key was removed from the defaults and the README.
Nothing has read it since 0.9.0, and the config loader doesn't validate keys,
so configs that still set it are unaffected. This was a documentation and
configuration issue, not two missing runtime modes. Restoring selectable modes
would be new work (decision 13).

## Observed behavior requiring a contract or design decision

### Concurrent cold fills

citizen's route cache represents only missing and populated entries. It has no
state for work currently being generated. In the captured `/case-studies` wave:

- 8 identical requests arrived before the first completed;
- the route controller, layout controller, includes, and views ran 8 times;
- all responses were successful with identical 13,871-byte bodies;
- the completed request was cached 8 times; and
- the same route entry was cleared and replaced 7 times, producing a new
  `lastModified`/ETag value for every writer.

The captured wave demonstrates duplicate work and repeated insertion. It does
not demonstrate cross-request view corruption or establish a documented
single-execution guarantee. Development mode makes the cost more visible
because template-engine caching is disabled.

### Key selection and request methods

Request-cache lookup originally used `base + pathname`, while insertion used
`parsed.href`. Probes showed query-bearing entries being written but missed on
lookup, and a query-bearing request receiving an already-cached bare-path
response. The read/write disagreement is a defect. The maintainer selected
full-URL identity to anticipate todo #8, which will add query parameters to
`params.url`. Lookup and insertion now both use `parsed.href`.

The key repair ships ahead of todo #8, with the interim documented in the
README. Until query parameters reach `params.url`, the `urlParams` allowlist
cannot see them. Each distinct query string, such as a tracking or cache-busting
parameter, creates its own entry even when output is identical. Insertion
already used the full URL before this repair. Query-string allowlist protection
remains part of todo #8.

Request and action cache entries also omit the HTTP method. Pipeline probes
showed cached output being reused across GET and POST without another controller
invocation. The README defines request caching by URL and warns that cached
actions reuse context. It does not establish a GET/HEAD-only cache contract.
The behavior and its implications should be recorded, without equating the
preferred method restriction with a confirmed documented bug.

### Forced content types and the cache

Found on 2026-10-04; awaiting the maintainer's classification (decision 17).

The README's "Forcing a Content Type" section lets a controller set
`response.contentType`. Cache lookups run before the controller: the request
cache in `serverResponse()`, and the action cache at the start of
`fireController()`. They use the negotiated type. Insertion runs after the
controller and uses the forced type.

An HTTP probe of a request-cached controller that forces JSON showed:

- requests whose Accept header matches the forced type hit the stored entry;
- every other request misses and re-renders; and
- under first-entry retention, those misses leave the stored entry unchanged.
  Under 1.0's replacement branch, each one replaced it.

For clients whose Accept header differs, the cache never helps. Their output
is correct, so the cost is performance, not correctness. The action cache
follows the same lookup and insertion pattern, by code inspection. Caching
causes the difference, which is the criterion used to classify hook directives
on request-cache hits as in scope.

Separately, misses in this scenario send the negotiated `Content-Type` header
with the forced body. That also happens on uncached routes, so it is not a
cache issue; it is tracked in todo #12.

### File-cache enablement and reset defaults

`cache.set({ file })` uses `cache.static.enabled`, which defaults to `false`, so
file caching does nothing under the default configuration even though the
README presents it as an application-cache facility. The gate predates 2021.
Whether file caching should instead follow application enablement is a
contract/design question, not an established new bug. File-cache tests must
explicitly enable static caching under the current behavior.

Likewise, using the static reset default for unspecified file options and
allowing `get({ resetOnAccess: false })` are separate decisions. They must not
be bundled with preserving explicit `false` values on insertion.

### Clear and hot-reload timing

Running work can publish after `cache.clear()`, and HMR clears before awaiting
replacement imports. The docs do not specify an atomic invalidation boundary
for work already running. Preventing stale publication would be a stronger
guarantee; generation counters and changing watcher order are proposed ways to
provide it, rather than mandatory repairs to the original two API defects.

## Goals

### Bug-fix goals

- Respect explicit application and file cache options, including the
  `'application'` sentinel and numeric lifespans.
- Select application or static defaults only when the matching option is
  absent.
- Return `false` for valid `cache.exists()` queries against missing scopes.
- Use the full URL, including the query string, for request-cache lookup and
  insertion so each stored entry is addressable by its request.
- Verify documented options with focused API regression tests.
- Fix the additional confirmed bugs without depending on single-flight.

### Proposed cold-fill goals

The following describe the enhancement being considered, rather than existing
contract violations:

- Coalesce simultaneous identical cacheable requests within one citizen
  process.
- Preserve dynamic `context.cache.request` directives returned by controllers.
- Release waiting requests safely on non-cacheable decisions, errors,
  redirects, direct response completion, and disconnects.
- Stop duplicate cold-fill writers from resetting timers and ETags.
- Keep unrelated eligible requests concurrent. Decide method eligibility
  separately from the existing completed-cache behavior.
- Establish deterministic HTTP concurrency coverage if coordination is selected.

## Non-goals

- Coordinating cache work across cluster workers or hosts. That requires shared
  storage or an inter-process protocol and belongs with cluster support.
- Turning the cache into a rate limiter or denial-of-service defense.
- Changing the documented semantics of request and action cache directives.
- Enabling template-engine caching in development mode.

## Bug-fix implementation

### 1. Normalize cache options by presence, not truthiness

Resolve item type first, then resolve each option independently:

- application values use `cache.application` defaults;
- files use the static lifespan default and retain the historical application
  reset default unless a separate change is selected; file-reading options use
  the application-cache configuration;
- an explicitly supplied `lifespan` wins over either default;
- numeric minutes are converted to milliseconds exactly once;
- `'application'` remains unchanged and creates no timer.

Fix the documented numeric and sentinel cases. Introducing new rejection or
fallback rules for invalid types, zero, negative numbers, or non-finite values
is a separate policy decision, not a confirmed defect in the documented cases.

Use nullish or own-property checks where `false` is meaningful in `cache.set()`
and `cacheRoute()`. Preserve explicit `resetOnAccess: false`, including the
value passed by static serving, and `synchronous: false`. Do not change
`cache.get()`'s override semantics or unspecified file reset defaults as a side
effect. File-cache fixtures must set `cache.static.enabled: true`.

Avoiding mutation of caller options is an implementation recommendation. The
current README does not establish an options-immutability contract; it must not
be presented as an additional confirmed API bug.

Preserve the documented ability to cache falsy values by checking whether the
`value` property exists rather than whether its value is truthy. Cover `false`,
`0`, the empty string, and `null` explicitly. Preserve and document the existing
omitted-value treatment of explicit `undefined`; supporting it as a cacheable
value remains a separate change.

File replacement must clear the resolved storage key, which can differ from
the source path. Retain the existing public file lookup and clearing semantics;
repair the replacement call site rather than adding mixed-option precedence
rules to `clear()`.

### 2. Make `cache.exists()` total for valid lookup shapes

Use guarded lookups for every lazily created built-in scope:

- `{ key }` against a missing `app` scope returns `false`;
- `{ file }` against a missing `files` scope returns `false`;
- `{ route }` checks whether the supplied route key has any cached content
  types, as demonstrated in the README, and returns `false` when absent;
- `{ route, contentType }` against missing route levels returns `false`;
- `{ scope }` against a missing or empty custom scope returns `false`; and
- `{ scope, key }` against a missing custom scope returns `false`.

Retain errors for genuinely invalid calls with no recognized lookup shape. Test
the state both before any cache insertion and after the final item in a scope is
cleared.

Route-only lookup should use the supplied stored key. Automatically translating
pathnames into absolute request-cache keys, or changing precedence for mixed
`{ file, key }` calls, would be separate API changes.

## Proposed cold-fill design

Sections 3–5 describe a deferred proposal to coordinate the observed duplicate
work. Their architecture and policies are recommendations for review, not
requirements for completing sections 1–2. No public single-flight guarantee
exists. Section 6's independent first-entry retention policy was selected and
implemented on 2026-10-04. Integration constraints on waiters apply only if a
registry is implemented later.

### 3. Maintain in-flight state separately from completed entries

Add a private registry for active request-cache work. Do not expose promises,
request objects, or response objects through `CTZN.cache` or the public cache
API.

The proposed in-flight key contains:

- cache kind (`request` initially; action caching may reuse the primitive
  later);
- the canonical route used by the completed request cache;
- negotiated content type; and
- request method unless GET/HEAD equivalence is explicitly validated.

A shared key helper is one implementation option. Completed request-cache
identity now includes the query string; method policies still need decisions
before claiming that coordination isolates those representations. Restricting
the registry alone does not change what completed request or action caches
serve.

The registry should expose a small internal claim/settle contract:

- the first claimant becomes the leader;
- later claimants receive the leader's decision/result promise;
- settlement is idempotent; and
- settlement always removes the registry entry in a `finally` path.

### 4. Preserve dynamic request-cache decisions

Request cacheability is not known at the initial lookup because a route
controller can return `context.cache.request` dynamically. Avoid serializing all
same-URL requests through the full render when the response proves
non-cacheable.

For eligible simultaneous requests:

1. The leader begins the first route controller.
2. Followers wait for its cache decision.
3. After the first chain link is resolved, determine the effective request-cache
   directive, including a cached action and directives preserved from hooks.
   A positive decision keeps followers waiting for the completed entry; it does
   not settle the fill's completion promise.
4. If the response is not request-cacheable, release followers immediately to
   process independently.
5. After successful rendering and encoding, commit the completed entry before
   settling followers.
6. Followers retrieve it through the normal cache-hit path while preserving
   their own per-request hooks, cookies, sessions, headers, HEAD behavior, and
   conditional request handling.

The initial proposal limits coordination to dynamic GET and HEAD requests while
application caching is enabled. This is a proposed eligibility rule, not an
existing documented method restriction. Any change to lookup or insertion for
other methods must be specified separately, including action-cache behavior.

This design introduces up to one controller-duration delay for simultaneous
identical non-cacheable requests. Measure that tradeoff and decide whether the
feature should follow `cache.application.enabled` automatically or use an
explicit `cache.application.singleFlight` setting.

### 5. Settle every terminal path

The leader must release followers after:

- completed cache insertion;
- a non-cacheable decision or invalid URL cache parameter;
- controller, include, view, layout, hook, or compression failure;
- redirect or direct response completion; or
- connection abort/disconnect.

Followers released without a completed result retry the normal cache check
before processing. They must not inherit the leader's error, request context,
cookies, headers, or response object.

A follower disconnect removes only that follower. Continuing work after a
leader disconnect is a design choice; whichever behavior is selected must
release remaining waiters. In-flight promises must have rejection handlers and
must not remain unresolved in the registry.

Follow actual pipeline completion, rather than assuming `fireController()`
awaits all includes, chained controllers, and response work. This is a
constraint on the new registry, not evidence of an existing registry bug.

Preventing pre-clear work from publishing is an optional stronger invalidation
guarantee. If selected, settlement alone is insufficient: use a publication
guard or equivalent and account for requests started during reload. A
generation counter is a proposed technique, not the required implementation.

### 6. Retain the first completed entry

Selected and implemented on 2026-10-04. `cache.setRoute()` previously cleared
and recursively recreated an entry if a writer had already populated it.
`cacheRoute()` is its only production caller, and there is no separate
intentional-refresh call site to preserve. `setRoute()` is not exposed through
`app.cache`. Normal cache hits skip the work. Duplicate writers still occur
through concurrent misses, and through controllers that force a content type
(see "Forced content types and the cache"). No replacement API was added.

This restores the framework's pre-2024 behavior. Until April 2024, the callers
`cacheResponse()` and `cacheController()` checked `cache.exists()` immediately
before inserting and skipped insertion when an entry existed, so citizen always
kept the first entry. The replacement branch in `setRoute()` was added on
2021-05-31 alongside the public `cache.set()` overwrite change, but no framework
caller reached it until `9826573` removed that guard.

Insertion retains the first completed entry for the route/content type,
checking for an existing entry before converting options or allocating a
candidate timer. This stops repeated replacements and stored ETag/timer churn
without adding an in-flight registry. Duplicate controllers and renders still
run. Once the entry expires or is cleared, a new completed fill can be stored.

This also connects finding 7 to the captured cold wave: a duplicate HTML writer
with lifespan `'application'` calls `clear()` and deletes JSON for the same
route. A direct probe reproduced that behavior. Correcting the targeted clear
preserved JSON during replacement. The separately selected retention policy now
also stops duplicate replacements and timer/ETag churn.

Keeping input options separate from stored records is recommended. If a
registry is added, publish the selected entry before releasing followers.

Publishing before `response.end()` is one possible approach. It does not by
itself coordinate requests that have already passed the initial lookup. The
essential ordering for follower reuse is publication before releasing waiters.

Using the inserted record for response metadata, or returning that record from
insertion, are implementation options. Fixing explicit `lastModified`
propagation is a documented behavior repair; requiring every default cold
response to carry the same ETag is a separate consistency goal.

## Verification

### Bug-fix contract tests

Add direct tests for:

1. A default-scope application value with no lifespan uses the application
   default.
2. A custom-scope value with no lifespan uses the application default.
3. Numeric lifespans are converted from minutes to milliseconds exactly once
   for default and custom scopes.
4. `lifespan: 'application'` remains the sentinel, creates no timer, and
   survives retrieval for default and custom scopes.
5. With `cache.static.enabled: true`, files without an explicit lifespan use the
   static lifespan default; explicit numeric and `'application'` lifespans win.
6. Explicit `resetOnAccess: false` is retained on set and by request/action
   directive normalization in `cacheRoute()`. The configured static `false`
   passed by static serving is also retained. Retrieval without an override
   honors the stored value.
7. Falsy values can be stored, retrieved, tested with `exists()`, and cleared.
8. Every valid `exists()` shape returns `false` before scope creation and after
   its final item is cleared.
9. Invalid/empty `exists()` calls retain the documented error behavior.
10. Route-only `exists()` succeeds for a populated supplied key and returns
    `false` before insertion and after the route is cleared.
11. With `cache.static.enabled: true`, explicit `synchronous: false` wins over a
    configured `true` default. Preserve the existing application reset default
    for unspecified file options unless a separate change is chosen.
12. Request-cache hits use the same full URL as insertion. Repeated requests
    reuse entries for their query strings; the bare URL and distinct query
    variants remain separate, including after clearing one variant.

Use fake timers where available, or assert stored timer state without waiting
for real expiration.

For additional confirmed bugs included in the implementation, test their
specific contracts independently of concurrency: honor explicit `lastModified`,
and report invalid cache parameters while continuing rendering and bypassing
insertion, including on the action-cache path. Do not encode the retired
`warn`/`error` modes into these tests.

Request-cache header tests: hits replay the chain's controller `header`
directives unfiltered, with later controllers' overrides, on both 200 and 304
responses. A request-cache refill from a cached action also captures that
action's headers. Action-cache hits are tested against "Additional finding:
action-cache directive replay".

For route clearing, verify that a supplied `contentType` removes only that
representation regardless of whether it has a timer, and a missing target does
not delete other types. Omitting `contentType` must still clear the whole route.
Cover expiration and replacement preserving other types, cancellation of removed
timers, and removal of the route container after its final type is cleared.

Implemented retention tests cover competing writes for an identical
route/content type with numeric and `'application'` lifespans. They verify that
the first entry, timer, and stored validator survive, no duplicate timer is
allocated, and other content types remain present. Expiry and clearing allow
refills. Controlled HTTP races verify request and action retention without an
in-flight registry.

Not yet covered: the forced-content-type path, which reaches insertion with an
existing entry without any race. Add a test in which a request-cached
controller forces JSON. A JSON-Accept request then hits the first stored entry
after a later HTML-Accept miss has re-rendered.

New invalid-lifespan rules, caching explicit `undefined` as a value, a `false` get
override, changed file enablement/reset defaults, changed `exit`-mode handling
of invalid cache parameters, and an options-immutability assertion need a
selected policy before adding acceptance tests. They are not baseline defect
tests.

### Proposed HTTP concurrency tests

These tests apply if cold-fill coordination is implemented. They are not
prerequisites for the API fixes.

Build a minimal fixture with delayed counters and a barrier so requests reach a
cold lookup together without arbitrary sleeps.

Proposed cases:

1. Eight identical cacheable GET requests execute the controller, includes,
   layout render, and compression once; all responses match and followers reuse
   one completed entry and its ETag. Equality with the leader's default ETag is
   conditional on selecting that additional consistency goal.
2. Concurrent requests against a populated cache use the normal hit path.
3. Different content types get independent leaders and never share output.
4. A non-cacheable route releases followers after the decision and all requests
   complete independently.
5. Controller, include, view, layout, hook, and compression failures release
   followers, empty the registry, and allow a later request to lead.
6. Leader and follower disconnects do not hang remaining requests.
7. Invalid URL cache parameters bypass insertion and release followers.
8. A warm action cache and a request-cache directive supplied by a hook both
   produce a decision; positive decisions wait for insertion, negative ones
   release followers.
9. Different URLs, methods, and content types remain concurrent.
10. Hooks, cookies, sessions, HEAD responses, and conditional handling retain
    the agreed per-request behavior. The header and validator fixes already
    have their own regression tests.
11. Competing cold-fill insertions do not replace the winner or leak timers.

Add a clear/HMR stale-publication test only if the stronger invalidation
guarantee is selected. Request-cache query identity is selected as the full URL;
completed-cache method gates still need an explicit decision before they become
acceptance criteria.

Run the full test suite, lint, and `git diff --check` after focused tests pass.

## Logging, documentation, and release notes

- Keep cache API logs concise and report the resolved lifespan consistently.
- If coordination is implemented, distinguish cache hit, leader miss, follower
  wait, follower reuse, and follower release without logging rendered output.
- The README cache API examples and option semantics are updated, including
  the invalid-parameter description. The unused `invalidUrlParams` key is
  removed from the defaults, README, and config table.
- Document any selected coordination behavior and configuration switch.
- Add changelog entries for the bugs actually fixed. Describe reduced duplicate
  cold-fill work separately if implemented, without claiming multi-process
  protection.

## Design and API decisions, not confirmed bugs

1. What validation or fallback behavior should apply to invalid lifespan types,
   zero, negative numbers, and non-finite values?
2. Should explicit `undefined` become a cacheable value? This bug-fix pass
   preserves and documents the existing treatment as an omitted value.
3. Single-flight is deferred on 2026-10-04 in favor of first-entry retention.
   If revisited, should it be automatic with application caching or separately
   configurable?
4. Should GET and HEAD share an in-flight key initially?
5. Should action-cache fills be coalesced in the first implementation or after
   request-cache behavior is proven?
6. What response-hook work must remain per follower?
7. Is protection against publication after clear/HMR part of the selected
   design? If so, what mechanism provides it? Settling waiters alone does not.
8. Request-cache identity and delivery timing are resolved: the maintainer
   selected `parsed.href`, including the query string, and shipping the repair
   ahead of todo #8 with the interim documented. That repair is implemented.
   What method eligibility should request and action caches support, and does
   GET/HEAD equivalence hold? Method policy remains open.
9. Should cold leaders and cached responses always share a default ETag, and
   should insertion return the selected record to support that behavior?
10. Resolved on 2026-10-04: cold insertion retains the first completed entry
    for each route/content type, independently of a registry. This is
    implemented for request and action entries, stopping duplicate replacements
    and stored ETag/timer churn while allowing refills after clearing or expiry.
    The loss of other content types in finding 7 was repaired separately by
    correcting targeted clear; no separate refresh operation is currently called.
11. Withdrawn. Header replay is unfiltered; see the appendix's header replay
    timeline for why.
12. Should `get({ resetOnAccess: false })` be supported, and should unspecified
    file reset defaults or file-cache enablement change? These are policy
    questions; the insertion `false` override bugs are already established. The
    bug-fix baseline retains the existing static enablement gate and application
    reset default for files; documentation describes current behavior without
    selecting a future change.
13. Should the retired invalid-parameter modes return in 2.0? Restoring them is
    new work, separate from preventing the action-cache 500.
14. Should caller options be guaranteed immutable?
15. Should an invalid URL cache parameter terminate the process under
    `citizen.errors: 'exit'`? Client input triggers it. This is optional. The
    action-cache 500 can be fixed under `capture` while keeping current exit
    behavior.
16. Resolved on 2026-10-04: request-cache hits should act on headers and
    redirects returned by the `session.start`, `request.end`, and
    `response.start` hooks, as misses do. The maintainer classified the old
    behavior as a bug, and it is fixed; see "Hook directives on request-cache
    hits."
17. When a controller forces a content type, should requests whose Accept
    header differs be able to hit the request and action caches? If so, how?
    See "Forced content types and the cache."

## Review addendum: findings classified against the framework contract

Date: **2026-10-01**
Status: **Reconciled with confirming-agent feedback and commit history**

All seven original finding numbers are retained. The former P1/P2 labels are
removed because they grouped observed behavior, proposed guarantees, and
preferred remedies with demonstrated bugs. The main plan now separates bug-fix
work from the cold-fill proposal. The subsequent review feedback has been
checked against commit history and incorporated here; current README text can
be stale when it conflicts with an intentional historical change.
Classification does not automatically expand implementation scope.

### 1. Key disagreement: repaired with full-URL identity; methods remain open

Classification: **Lookup/insertion disagreement is a bug, now repaired using
full-URL identity selected by the maintainer. Restricting methods remains a
design decision.**

Before the repair in [lib/server.js](../../lib/server.js), `serverResponse()` read
using `params.route.base + params.route.pathname`, while `cacheRoute()` wrote using
`options.params.route.parsed.href`. A direct probe stored
`http://example.test/article?variant=a` but looked up
`http://example.test/article`, producing a miss. Pipeline probes also showed a
query-bearing request reusing a warm bare-path entry. The review agent also
reproduced both behaviors with end-to-end HTTP requests. Before the 1.0 rework,
lookup and insertion both used `params.route.pathname`; commit `9826573` changed
request insertion to the parsed full URL. Entries that the corresponding lookup
cannot address are a regression, regardless of the chosen common key.

Completed request and action entries omit the method. Pipeline probes showed
GET and POST receiving the same cached output without another controller
invocation, confirmed by the review agent's HTTP probes. The README describes
URL and path-parameter caching without establishing a GET/HEAD-only contract.
Method restrictions remain a policy question.

Lookup now uses `params.route.parsed.href`, matching insertion. Full-URL
identity was selected ahead of todo #8 to preserve distinct query inputs when
they become part of `params.url`; the current absence of query parsing and
allowlist checks is documented. A shared helper is optional. A request-cache
method gate alone leaves action-cache reuse intact; any selected method
restriction needs to account for both. Neither a method gate nor a registry is
required to correct the key disagreement.

### 2. Publication after clear/HMR: proposed stronger guarantee

Classification: **Observed timing behavior; stronger invalidation is a design
proposal.**

Settling waiters cannot stop a running fill from publishing after a clear. With
first-successful-writer-wins insertion, old work could also beat a newer fill.
In [lib/hooks/application.js](../../lib/hooks/application.js), HMR clears before
awaiting replacement imports, leaving an interval in which requests can still
execute the old module.

These are code-traced timing risks, not reproduced HTTP races. The documentation
does not promise an atomic invalidation boundary for work already running.
Preventing later publication would be a stronger guarantee.

Design recommendation: if that guarantee is selected, use a publication guard
or equivalent, account for the reload interval, and test both timings. A
generation counter is one possible mechanism, not a mandatory bug-fix design.
Releasing waiters alone must not be described as providing that guarantee.

### 3. Cache decision point: constraint on proposed coordination

Classification: **Future integration requirement, not a demonstrated current
bug.**

In [lib/server.js](../../lib/server.js), `fireController()` can resolve the first
chain link from the action cache rather than invoking the controller. Its
uncached path also preserves request-cache directives supplied by hooks.
Observing only freshly returned directives could miss a decision in a new
registry. The existing paths work without that registry; the hypothesized
unresolved-waiter failure is not a current single-flight defect.

Design recommendation: if coordination is implemented, observe the effective
decision on both paths. A positive decision keeps followers waiting for
completed insertion; a negative decision releases them. Test a warm action
cache with a cold request cache and a hook-supplied directive. Coalescing action
fills is a separate enhancement.

### 4. Validators and header replay: regressions

Classification: **Explicit validator propagation and loss of intended header
replay are bugs, now repaired; unfiltered replay is restored. Broader response
architecture remains a decision.**

In [lib/server.js](../../lib/server.js), `fireController()` assigns an ETag during
processing, `cacheRoute()` independently selects stored `lastModified`, and
`serverResponse()` uses the stored value on hits. The cold and cached ETags are
not guaranteed to match; default timestamps can coincide by chance.

The documented custom `cache.request.lastModified` is ignored by the first
response. `context.cache` is deleted before the ETag code reads it, and that
code tries `cache.lastModified` instead of `cache.request.lastModified`. A
pipeline probe showed a current-time first ETag and the supplied 2020 value on
hits. This is a directive-propagation defect.

The README promises that controller `header` directives survive request
caching. Every version that replayed headers replayed all of them. 0.9.0 stored
the full context. From 2021 to April 2024, `setRoute()` kept every directive
header and discarded the rest of the context. From July 2021 until `8f3a9de`
(April 12, 2024), it stored them under the wrong key, so replay was broken for
that period. Commit `9826573`
(April 20, 2024) deleted headers from the merged primary context that passes
down the chain, so later controllers would not reapply them. This is the same
reason `context.cache` is deleted. Individual controller contexts in
`params.route.chain` keep their `header` directives, because
`helpers.extend()` returns a new merged object. The request cache, however,
stores the primary context, so replay stopped. Pipeline and reviewer HTTP probes
confirmed that `X-Test` and `Cache-Control` are missing on hits. No version
filtered individual headers.

The regression is the loss of replay. The repair restores unfiltered replay:
request-cache entries carry the chain's controller `header` directives, with
later controllers' overrides. Developers control replayed headers through the
directives they return. Explicit `lastModified` has its own regression test.

Requiring all cold leaders and followers to share a default ETag is an
additional consistency goal. Returning the winning record from insertion or
introducing a common response path are possible remedies, not mandatory
architectures implied by these bugs.

### 5. Invalid URL parameters: action-rendering bug and stale mode descriptions

Classification: **The action-cache 500 is a bug; unused modes are stale
documentation/configuration, not missing runtime implementations.**

`urlParamCheck()` in [lib/server.js](../../lib/server.js) always emits `error`
and does not consult `cache.invalidUrlParams`. The 0.9.0 changelog explicitly
changed the contract to always report an error without preventing rendering.
Commit `e596f28` removes the old mode switches. The request-cache path invokes
the application error hook after send; that reporting behavior is intended.

The README's warning/error-mode descriptions did not reflect that change:
`c6610ac` carried the stale description into the 2.0 config table in August
2026. The unused key and its documentation have since been removed. Reviving
the modes would be new work.

The real behavior defect is the action-cache path: validation before send
causes a 500 with an empty body, reproduced by pipeline and reviewer HTTP
probes. This contradicts the historical requirement to continue rendering.
Separate error reporting from response interruption so invalid parameters
prevent insertion while rendering continues. Tests should preserve reporting
and successful rendering, not demand warning-only logging or a revived mode.

With `citizen.errors: 'exit'`, the same report terminates the process. The
confirming agent reproduced both paths over HTTP:

- Request-cache path: the client receives a 200. The error handler's
  ended-response branch then calls `process.exit(1)`.
- Action-cache path: the client receives a 500 and the process exits.

Both outcomes follow from documented decisions. Since 0.9.0, invalid
parameters always report an error, and `exit` mode terminates after an error.
This is therefore a policy question, not a bug.

The action-cache HTTP status depends on error-hook timing: a hook that yields
to the event loop can let rendering finish and send 200 before the handler
exits. The immediate-hook probe's 500 is an observation, not a guaranteed
status. Exit-mode regression coverage exercises immediate and yielding action
error hooks and asserts process exit code 1 for both, preserving this behavior.

It matters because client input triggers it. Any request that adds an
unlisted URL parameter to a route with a cache directive can stop the server.
Once todo #8 adds query parameters to `params.url`, `urlParamCheck()` will also
report unlisted query parameters, such as `utm_source`, because it checks every
`params.url` key.

The baseline remedy fixes rendering under `capture` and leaves `exit` behavior
unchanged, so it needs no exit-policy decision. At review time the handler's
`respond = false` flag was insufficient: it still set `response.statusCode` on
a writable response. The implementation now suppresses both response rendering
and status mutation for reporting-only errors under `capture`, while retaining
the normal error event, application error hook, and `exit` handling.

Changing `exit` behavior is optional and separate (decision 15). One option is
to report through logging and the application error hook outside the `error`
event. Another is to classify the report so it does not trigger an exit. Record
the exposure for the security review (todo #1) either way.

Moving request-cache insertion earlier needs the same non-interruption guard.
Follower release is a constraint on the optional registry, not part of the
existing bug definition.

### 6. Route-only `exists()`: confirmed documented bug

Classification: **Bug.**

The [README](../../README.md) explicitly demonstrates `{ route }` as a lookup.
In [lib/cache.js](../../lib/cache.js), the route branch requires both `route` and
`contentType`. A direct probe confirmed that `{ route: '/article' }` throws even
when the supplied key has entries. Commit `1599649` (May 29, 2024) introduced
the branch with the comment "If only a route is provided" while requiring
`contentType`. The v1.0.0 README also demonstrates route-only lookup.

Repair the documented lookup and test missing routes, populated supplied keys,
and the state after the route is cleared. It is related to the
original lookup fix. Automatically translating pathnames into absolute
request-cache keys is a separate API recommendation.

### 7. Targeted clear: timer presence incorrectly determines clearing scope

Classification: **Bug. The maintainer confirmed the original targeted versus
whole-route distinction is intentional on 2026-10-03.**

The reviewed code cleared one content type when that entry had a timer, but
every content type when it did not. Direct probes reproduced deletion of JSON
when clearing non-expiring HTML and when a duplicate HTML writer replaced that
entry. The defect is using timer existence to choose clearing scope. The
intended choice is whether `contentType` was supplied.

The repair preserves that design: first select targeted versus whole-route
clearing, then cancel any timers belonging to the selected entries. A targeted
clear of a non-expiring or missing entry must not delete other types. Delete
the route container only when it is empty. Manual whole-route clears still
flush every type, while expiration and replacement clear only the affected
representation. Tests cover both branches and the final-container cleanup.

Retaining the first completed entry was separately selected and implemented on
2026-10-04 to stop duplicate replacements and timer/ETag churn. `cacheRoute()` is
the only production caller; no distinct refresh operation needs preserving.
Neither the targeted-clear repair nor an insertion-only change requires an
in-flight registry or stronger HMR invalidation. An insertion-only change does
not eliminate duplicate controller/render work.

### Additional finding: action-cache directive replay

Classification: **Bug, a 2024 regression. The maintainer confirmed on
2026-10-03 that cached directive replay is intended, including headers.**

The README action-cache warning states the contract: "When you cache controller actions, their
context is also cached," and a cached action's cookie or session directives
apply on later requests. History matches:

- Before 1.0, a cached controller replayed the directives listed in its
  `directives` array.
- `9826573` (2024-04-20) removed that array and stored the action's context. A
  hit merged it back into ordinary directive handling. Framework housekeeping
  was the exception. `setRoute()` deleted `cache` (narrowed to
  `cache.controller` the next day). From 2024-05-09, it also deleted `include`,
  because "cached controller views already contain the rendered include."
- `4df033f` (2024-06-20, "Rendering improvements") moved all directive handling
  inside the cache-miss branch of `fireController()`. A hit now calls `next()`
  without acting on the cached context. The next day, `4c7dfae` removed the
  `include` deletion. This is most likely a side effect of moving rendering
  into `fireController()`, since cached output must not be rendered again.
  Whether it was intended remains an inference. The documented contract and the
  different pages for miss and hit establish the regression either way.

Before repair, reproduced over HTTP: a cached action returns `next: '/chainb'`
and a cookie.
On a miss, the response is chainb's page with the cookie set. On a hit, the
response is the cached action's own page with no cookie. The stored entry's
context contains `local`, `next`, `cookie`, and `cache`, so the data is present.
Hits do not act on it. Any custom context a cached action passes to later
controllers is lost the same way.

The repair applies a cached action's context through the same context merging
and directive handling a miss uses. Headers, cookies, session, redirects,
`next`, and custom context now follow that shared path.

Rendering is the exception. Controller invocation, include processing,
rendering, and action insertion stay on misses. A hit reuses the cached output
and its already-rendered includes. Before the performance follow-up below,
stored `include` entries held rendered strings for HTML/text and full working
objects for JSON/JSONP. Ordinary include processing would treat the rendered
strings as routes, which is why `setRoute()` deleted `include` before June
2024. The consumed directive is now omitted from stored action contexts;
rendered output and `local.include` data remain. `getRoute()` returns the
stored entry by reference, so a hit must not write request-specific data into it.

The replay applies to chain links: the controller for the original request and
any controller reached through `next`. It does not apply to includes. An
include acts only on its `local`, `view`, and `cache.action`, whether cached or
not. A probe of an uncached include that returned a header, a cookie, and
`next` showed all three ignored. With respect to those ignored directives,
include cache hits already match include misses.

Before the independent include-data repair, the parent's `local.include`
received an include's `local` data only on a miss. A probe showed a parent's
JSON response with
`include: { inc: { fromInclude: 'yes' } }` on the include's miss and no
`include` key on its hit. The 1.0.0 changelog promises "the local context of
the entire controller chain and all includes" in JSON responses, so this is a
separate confirmed bug (see the defect table). The assignment now runs on both
paths and copies the include's local data, with regression coverage for JSON
and JSONP. It is independent of chain-link directive replay.

Request-cache hits are different. They serve a fully rendered response, and
whenever replay worked, it covered only headers on those hits. Their unfiltered
header replay is tracked under finding 4.

Verify that an action-cache hit produces the same chain, page, cookies,
session values, and headers as the miss, and that a request-cache refill from
a cached action still captures the cached action's headers. Also verify that
repeated hits:

- leave the stored context and output unchanged (expiration bookkeeping may
  still change: `getRoute()` updates `lastAccessed` when reset-on-access is
  enabled);
- populate the chain link's controller, action, and params metadata; and
- invoke neither the cached controller nor its view or includes again.

### Approved performance follow-up: omit consumed include working objects

Classification: **Performance optimization, not a correctness bug. Approved
by the maintainer on 2026-10-04 and implemented with this cache work.**

In JSON/JSONP responses, an action's top-level `include` directive previously
retained each include's working object, including `params` and copied
application configuration. Every action hit copied those objects while copying
the stored context, although it reused the rendered output and consumed the
directive without processing it. HTML/text entries retained rendered include
strings in the same directive. Neither form is needed on a hit.

`cacheRoute()` now makes a shallow copy of an action's context and removes only
that copy's top-level `include` before insertion. This happens after rendering
and the assignment of include local data. It avoids retaining and repeatedly
copying the working objects while preserving the live chain context, cached
output and encodings, `local.include`, request-cache directives, and ordinary
directive replay. This restores the useful storage omission from May 2024
without deleting the directive from the live caller's context.

Verification extends the existing HTML action replay and multiple-link
JSON/JSONP tests. Stored contexts omit the consumed directive, both cached and
uncached includes contribute their local data, repeated action hits reproduce
the cold output, and include invocation counts remain unchanged.

### Additional lifecycle observation: constraint on proposed coordination

Classification: **Integration constraint, not an existing single-flight bug.**

The pipeline in [lib/server.js](../../lib/server.js) contains event-driven and
unawaited continuations, including `Promise.all(includes)`, `next()`, and
`respond()`. Awaiting `fireController()` alone does not establish completion of
rendering and response delivery. A new registry must follow actual completion
and terminal paths. This observation does not prescribe a pipeline rewrite.

### Option and file-cache clarifications from the confirming review

Preserving `false` in `cache.set()` and `cacheRoute()` is confirmed, including
the static reset setting passed explicitly by the server. A false get override
is a policy question; the README demonstrates a true override and recommends
`exists()` for lookup without timer extension. Tests must distinguish insertion
options from a proposed retrieval change.

File entries used the application reset default before and after `c7e1121f`.
Switching files to the static reset default would therefore change historical
behavior (decision 12). File-cache
enablement also followed the static switch before that commit. A direct probe
under current defaults confirmed `cache.set({ file, value })` inserts nothing.
Tests of file lifespan and asynchronous options must enable static caching.
Changing either default source or enablement needs its own explicit decision.

### Evidence and review checks

Before implementation, the confirming agent reported **38 of 38 existing tests
passed**, including the HTTP test, with none skipped in that agent's environment. Their scaffolded
production-server probes used end-to-end HTTP requests and confirmed all six
cases: query aliasing, POST cache reuse, missing headers, ETag mismatch,
`resetOnAccess` option loss, and the action-cache 500. The same probes later
showed that both invalid-parameter paths terminate the process under
`citizen.errors: 'exit'`. These are pre-implementation observations; current
implementation checks are recorded above.

Earlier local checks passed 37 tests with one port-restricted skip, plus targeted
lint and `git diff --check`. Local in-process probes corroborated the six
behaviors; direct cache probes reproduced route-only `exists()` and targeted
clear behavior. This reconciliation also directly reproduced default file-cache
inactivity and a duplicate non-expiring HTML writer deleting JSON.

Historical checks inspected `e596f28`, `9826573`, `c6610ac`, `1599649`, the
v1.0.0 README, and `c7e1121f` and its parent. They confirm the mode retirement,
header deletion, carried-forward stale configuration text, route-only branch,
previously consistent request keys, and historical file option behavior. Those
reviews made no runtime changes; the later implementation is recorded above.

Review factual behavior against the relevant contract before assigning bug
severity. Keep implementation scope explicit for each confirmed defect. Review
the common key choice, method restrictions, invalidation guarantees, insertion
policy, retrieval/file option changes, options immutability, and registry
architecture as design choices. The key mismatch and action-rendering failure
remain bugs even though their remedies have choices. Agreement with an
observation does not establish that its suggested remedy is mandatory.

## Appendix: cache design history and rationale

Recorded on 2026-10-03 during review of this plan. Several current behaviors
looked like design decisions but turned out to be regressions, and some
apparent bugs turned out to be deliberate. Read this before changing cache
behavior.

### Where the history is

The 1.0.0 release commit `14436dc` squashed the 2024 rework into one commit.
The individual 2024 commits are on the `origin/1.0.0` branch; search them with
`git log --all -S'<code>'`. Earlier history (0.9.x and before) is on the main
line. In zsh, brace revision variables (`git show "${c}:lib/server.js"`),
because `$c:l` is a zsh modifier.

### How intent was established

- The README and CHANGELOG define the contract. The CHANGELOG also records
  deliberate reversals that the README may not reflect, such as 0.9.0 retiring
  the `invalidUrlParams` modes.
- Current README text can be stale. `c6610ac` carried 1.0.0-era text
  describing the retired modes into the 2.0 config table.
- Code comments and commit messages show why code exists. Probes show only what
  it does.
- Behavior outside the framework's contract needs no cache handling. For
  example, headers set directly with `response.setHeader()` are not cached
  (`README.md:1154`).

### How a controller is called determines its caching

| Called as | Cache | Stored | A hit reproduces |
|---|---|---|---|
| The original HTTP request (first chain link) | Request | The fully rendered response of the whole chain | That response plus the chain's `header` directives |
| The first link, or reached through `next` | Action | The controller's rendered output and its own context | That context's directives; the rest of the chain runs live |
| An include | Action | The include's rendered output and context | The output, and in JSON responses its `local` data (hit-path loss repaired in 2.0; see the defect table) |

- Only the first controller can trigger the request cache. The 1.0.0
  changelog says it "only applies if the controller action in which it's
  called is the action specified in the original request." See the
  first-controller comments in `fireController()` and `respond()`.
- The action cache is keyed by the controller's own route pathname and content
  type. One entry serves the controller however it is called; the README says
  this for includes. That is plausibly what `9826573` meant by "work
  interchangeably."
- Includes act only on `local`, `view`, and `cache.action`, whether cached or
  not. A probe of an uncached include that returned a header, a cookie, and
  `next` showed all three ignored.

### Why `fireController()` deletes directives from the context

`delete context.cache` and `delete context.header` remove directives from the
merged primary context. This stops the next controller in the chain from
inheriting or reapplying them. The deletions are deliberate; keep them.

Each controller's own context in `params.route.chain` keeps its directives,
because `helpers.extend()` returns a new merged object. The request cache,
however, stores the primary context. Anything a request-cache hit must replay
therefore has to come from the chain links. Missing that is what broke header
replay in 2024.

### Header replay timeline

| Date | Commit | Change |
|---|---|---|
| 2019-10-04 | `e596f28` (0.9.0) | The request cache stores the full context; hits replay its headers. |
| 2021-05-31 | `05b3e01` (#85) | `setRoute()` keeps only the headers from the context. |
| 2021-07-07 | `7c768aa` | The directive is renamed to `headers` and stored under the wrong key, so replay silently breaks. |
| 2024-04-12 | `8f3a9de` | The key is fixed. |
| 2024-04-20 | `9826573` | Headers-only storage is removed and `delete context.headers` is added. Nothing keeps a copy, so replay stops. |

No version filtered individual headers. A configurable allowlist was
implemented during the 2.0 work and withdrawn on 2026-10-03. Directive replay,
headers included, is intended; developers control replayed headers through the
directives they return.

### Action-cache directive replay timeline

| Date | Commit | Change |
|---|---|---|
| Before 1.0 | — | A separate controller cache. Nothing replays unless listed in `directives` ("to prevent accidental storage of private data"); even `handoff` must be listed. A `scope` option chooses one entry per route or one global entry. |
| 2024-04-20 | `9826573` | The controller cache merges into the route cache. `directives` and `scope` are removed. The action's context is stored and merged back into ordinary directive handling on hits. As housekeeping, `setRoute()` deletes `cache` (narrowed to `cache.controller` in `b8e080b` the next day). |
| 2024-05-09 | `d893688` | `setRoute()` also deletes `include`, because "cached controller views already contain the rendered include." |
| 2024-05-16 | `12aca2d` | The README replaces the `directives` docs with a warning that cached context replays, including cookies and session values. Responsibility moves to the developer. |
| 2024-06-20 | `4df033f` | Directive handling moves inside the cache-miss branch. Hits call `next()` without acting on the cached context. This is most likely a side effect of moving rendering into `fireController()`. |
| 2024-06-21 | `4c7dfae` | The `include` deletion is removed. |

From `4df033f` until the 2.0 replay repair, an action-cache hit on a controller
that returns `next` rendered a different page than the miss. The README warning
and `9826573`
establish that replay is intended.

### Other behaviors whose classification needed history

- **`invalidUrlParams` modes (deliberate):** retired in 0.9.0, which says
  invalid parameters "always throw an error, but don't prevent rendering." The
  unused config key and the stale README mode descriptions survived until 2.0,
  which removed them. The action-cache 500
  was a bug because it prevented rendering: 1.0.0 moved action insertion ahead
  of the response. Under `citizen.errors: 'exit'`, these reports still exit the
  process; whether that should change is decision 15.
- **Request-cache key (bug):** before 1.0, lookup and insertion both used the
  pathname. `9826573` changed lookup to `base + pathname` and insertion to
  `parsed.href`, so entries with query strings were never read. 2.0 uses the
  full URL on both sides. Todo #8 plans to add query parameters to `params.url`
  and check them against the `urlParams` allowlist.
- **Method (design):** the URL is the documented key. The README recommends a
  separate action, and therefore a separate URL, for form submissions. No
  version has included the method in the key.
- **Route-only `exists()` (bug):** supported before 1.0. `1599649`
  (2024-05-29) restored the branch with the comment "If only a route is
  provided" but required `contentType`. The 1.0.0 README documents
  `{ route }`.
- **Targeted clear (bug):** before 1.0, `.timer` only guarded `clearTimeout()`.
  1.0.0 folded it into the branch condition.
- **File caching (existing behavior):** gated by `cache.static.enabled` since
  before 2021. File entries have always used the application reset default.
  `c7e1121` (2021-05-31) introduced both the static lifespan default for files
  and the lifespan precedence bug.
- **Replacing an existing route entry (restored to first entry):** until May
  2021, `setRoute()` threw if an entry already existed, unless the caller
  passed `overwrite` (`d3a8af0`). `05b3e01` (2021-05-31) added clear-and-replace,
  a day before `5f7348c` (#90) made the public `cache.set()` replace an
  existing key instead of throwing. The framework's callers checked
  `cache.exists()` first and skipped insertion, though, so internally the first
  entry was always kept. `9826573` (April 2024) dropped that guard, which made
  replacement live; it caused the repeated replacements in the captured cold
  wave. 2.0 moves first-entry retention into `setRoute()` itself.
- **Hook directives on request-cache hits (bug):** before the 2026-10-04 repair,
  only `request.start` headers and redirects were handled before the cache
  lookup. Headers and redirects from `session.start`, `request.end`, and
  `response.start` were applied only inside `fireController()`, which a
  request-cache hit skips. Before April 2024, those
  headers were stored with the entry and replayed from the first request
  whenever replay worked; they were never applied live. Classified as a bug on
  2026-10-04 because caching caused the difference from a miss. Shared header
  and redirect handling now applies the live directives on hits, including
  conditional requests.
