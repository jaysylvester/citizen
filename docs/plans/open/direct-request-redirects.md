# Direct requests honor redirects

Target release: **2.0** (see [todo #1](../todo.md)).
Status: **Approved; implementation pending.** Independent of query parsing
([todo #8](url-query-params.md)).

Moved out of the query plan (pre-split step 8) on 2026-10-06. Review history is
in [url-query-params-history.md](url-query-params-history.md). Line references
are as of commit `1bfb0b2`.

## Problem

The [`request` handler](../../../lib/server.js#L79) and
[`setRedirect()`](../../../lib/server.js#L1334) skip redirects when
`params.route.direct` is set, including redirects returned by hooks. The
README's login-redirect request hook can therefore be bypassed with
`/direct/true` or an underscore-prefixed route. A disposable HTTP app
reproduced a 302 login redirect becoming a 200 controller response with
`/direct/true`; simulated query parsing reproduced the same result with
`?direct=true`. The 1.0 CHANGELOG describes `direct` only as bypassing the
controller chain.

## Decision

The maintainer approved limiting direct requests to skipping `next` and the
default layout while honoring hook and controller redirects, on misses and
cache hits, for path parameters, underscore-prefixed routes, and, once todo #8
lands, query parameters. This is a 2.0 compatibility change.

## Specification

Remove the `!params.route.direct` exclusions from the initial `request`
redirect check and from shared `setRedirect()` handling. Keep the direct flag's
gate in `next()` for explicit chaining and the default layout. Controller
execution and include rendering stay available on direct requests unless a
server-side redirect ends the response first. Underscore-path detection and the
flag's truthiness rules are unchanged.

Honor string and object redirects, preserving the status code, the `Location`
or `Refresh` header, session and cookie handling, and the existing referrer
behavior. The same handling must apply to live hooks, fresh controller context,
replayed action-cache directives, and request-cache hits. Server-side redirects
take precedence over a cached body or a conditional 304. Refresh redirects keep
their configured status and body even when a cache validator matches. Stop
processing once a response ends; do not write another body or change the
stored entry while applying a live redirect.

The cache-correctness plan's earlier repair kept the suppression; this plan
replaces it.

## Validation

Update the existing HTTP regression `direct requests still suppress redirects
and allow conditional responses` to assert the new behavior rather than keeping
its old expectation.

- Direct requests through path parameters and underscore routes skip explicit
  `next` and the default layout, and keep ordinary controller and include
  output when no redirect applies.
- Hook login redirects and controller redirects take effect. Cover string and
  object redirects, server-side and refresh forms, live request, session, and
  response hooks, replayed action directives, and request-cache hits.
- With matching cache validators, server-side redirects take precedence over a
  304, and refresh redirects keep their configured status and body.
- Cold and warm requests behave the same, and ordinary conditional responses
  still work without a redirect.
- After todo #8, repeat the checks with `?direct=true`.

Document in the README that direct requests skip `next` and the default layout
while honoring redirects, and record the change from redirect suppression in
the CHANGELOG's breaking changes.

## Split-review log — 2026-10-06

The extracted plan retains the approved redirect policy, cold/warm hook and
controller coverage, conditional/refresh behavior, and the required update to
the old suppression regression. Query-specific checks run after both features
land; the split makes this repair independent of #8's shipping gate. No missing
implementation contract or new runtime scope was identified in this review.
