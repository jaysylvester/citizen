# JSONP callback validation

Target release: **2.0** (see [todo #1](../todo.md)).
Status: **Approved; implementation pending.** Forced-format acceptance depends
on todo #12. Independent of query parsing ([todo #8](../done/url-query-params.md)).

Moved out of the query plan (pre-split step 7) on 2026-10-06. Review history is
in [url-query-params-history.md](../done/url-query-params-history.md). Line references
are as of commit `1bfb0b2`.

## Problem

[`renderView()`](../../../lib/server.js#L1687) writes `params.url.callback`
into `application/javascript` responses unescaped. Path input already allows
calls such as `alert(1)`. A missing callback currently produces
`undefined({…});` with a 200. Todo #8 now puts queries in `params.query`, so
query `callback` values do not select JSONP callbacks or expand this exposure.

## Decision

The maintainer approved accepting identifier and dotted-identifier callbacks
and rejecting missing or malformed ones with a nonfatal HTTP 400, outside the
server-error and exit policy.

## Specification

Accept a literal JavaScript identifier or a dot-separated identifier path, such
as `show`, `app.show`, or a conventional jQuery callback name. Validate the
whole string against a documented grammar. Do not evaluate it, and reject
calls, bracket expressions, comments, and additional statements. Define
identifier and reserved-word handling so accepted callbacks always produce a
syntactically valid call.

Validate the effective path-only `params.url.callback`. Query `callback`
values stay separate in `params.query`; they must not invalidate or replace a
valid path callback. Keep both parameters available to the application. The rule applies only when the output is JSONP;
other formats do not reject a `callback` parameter because of this grammar.

For a missing, empty, or malformed callback, return HTTP 400 with a fixed,
non-executable body that does not reflect the rejected value. Stop further
rendering, response, and cache-insertion work for the request. Do not emit the
server `error` event, call the application server-error hook, include a stack,
or apply `citizen.errors: 'exit'`; the rejection is nonfatal under both
`capture` and `exit`. Assigning 400 through the current generic error handler
would not meet this, because that handler can still exit.

Use a shared guard before serving JSONP request, action, or include cache hits,
and before JSONP rendering or response writing. Check the effective callback
for replacement routes as well as the initial request. Cover content types
forced by controllers and hooks, so validation cannot be skipped when JSONP is
chosen after negotiation. Propagate the handled rejection without throwing into
generic error handling or allowing a second response write. This output guard
does not add cache-allowlist checks on hits.

Valid callbacks keep their existing output and namespace behavior. Cache
allowlists stay separate and check only citizen path names. Query `callback`
and client-added `_` names do not participate in allowlists or cache identity.
A changing `_` query does not bypass a warm cache entry; developers choose
whether the route is appropriate to cache. This repair does not add query
callback support or a cache-busting policy.

### Dependency: todo #12

Negotiation sets the `Content-Type` header before a controller or hook changes
`response.contentType`. `Accept: */*`, which script elements send, negotiates
`text/plain`, so forcing JavaScript must produce both a valid JSONP body and an
`application/javascript` header. Land todo #12's header fix first, and assert
headers and bodies on forced responses; body-only tests would leave the
integration defect unverified. Content negotiation otherwise stays out of
scope.

Todo #12 fixes headers, not the mismatch between negotiated-format cache lookup
and controller-forced-format insertion (cache-correctness decision 17). Keep
that cache architecture outside this repair. Assert cold/repeated forced-format
bodies and headers, but do not claim a cache hit when the controller must run
again to select JSONP. Actual request/first-action hit tests use JavaScript
negotiated through `Accept`, or a hook selecting it before the relevant lookup.
Include-hit tests must likewise make the format available before their lookup.
Decision 17 remains a separate follow-up, not an additional prerequisite.

## Validation

- Simple, dotted, and conventional jQuery callback names keep their payload and
  namespace behavior, through includes, chains, and cache hits.
- Content types forced by a controller or a hook, after todo #12, including
  `Accept: */*`, return a JavaScript `Content-Type` and a valid body on cold and
  repeated requests. Invocation counts distinguish real hits from repeat misses.
- Missing, empty, malformed, and executable callbacks return a non-executable
  400 before rendering or cache reuse, without reflecting the callback or
  creating a cache entry. Under both error policies there is no server-error
  hook call or exit; a following valid request to the same server succeeds.
- Non-JSONP output keeps callback parameters without this rejection, and the
  existing JSONP regressions still pass.
- After todo #8, verify query callback names remain ordinary data and do not
  replace path callbacks. Query-only JSONP requests still have a missing path
  callback and receive the selected nonfatal 400.

Document the callback grammar, the 400 behavior, and its independence from
cache-allowlist eligibility in the README, and add a CHANGELOG entry.

## Split-review log — 2026-10-06

The extracted plan retains callback grammar, effective-value validation,
nonfatal 400 rejection, and guards before rendering or cache reuse. Resolved
its two review questions without expanding runtime scope:

- Todo #12 remains the forced-format header dependency. Decision 17 remains
  deferred; tests separate response correctness from actual hits and use a
  pre-lookup JavaScript format for hit assertions. A controller-forced repeat
  miss is not evidence that a cache guard was exercised.
- Cache-busting guidance now distinguishes permission to insert from reuse:
  a varying `_` value makes a separate exact entry. No exemption/filtering
  mode is added, and the warning-policy change stays owned by todo #8.

This plan and the direct-redirect plan remain independent of #8's shipping
gates as selected by the split. No runtime or test code was changed.

## Deferred-work tracking — 2026-10-07

Cache-correctness decision 17 is explicitly indexed as Consider #16 in
[the todo list](../todo.md). This keeps the forced-format cache lookup question
visible while retaining its independence from callback validation and todo
#12's response-header fix. Its classification and solution remain undecided.


## Query direction update — 2026-10-09

Todo #8 now uses separate `params.query` data, path-only framework controls,
and path-only cache identity/eligibility. The current specification above
replaces the earlier merged-query assumptions. Callback validation remains
independent and unimplemented.
