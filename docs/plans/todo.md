todo (2.0):

1. Comprehensive security review (XSS, cookie parsing, injection, config, log file/stdout contents, CORS implementation)
   - Add request-level regression coverage for literal CORS origins containing
     regular-expression metacharacters
   - Complete: replaced development-mode `ctzn_inspect` `eval()` with restricted
     property selectors; implemented independently of #8; review follow-up
     complete, with shared debug scope selection; 135 tests pass on
     Node.js 24.13.1
     — plan: open/debug-inspect-selector.md
   - Validate JSONP callbacks and reject invalid ones with a nonfatal 400;
     forced-format acceptance depends on #12
     — plan: open/jsonp-callback-validation.md
   - Honor hook and controller redirects on direct requests; `direct` only
     skips `next` and the default layout
     — plan: open/direct-request-redirects.md
   - Review query/OAuth values such as `code` and `state` in access logs and
     debug output, alongside configuration secrets
     — notes: open/url-query-params-history.md#smaller-items

2. HTML escaping in template literal views using double-bracket notation ${{local.whatever}}
   — plan: open/html-escaping-double-bracket.md
   - Complete: compiler, renderer, error fallbacks, and migration documentation
     implemented and review corrections applied; 118 tests pass on Node.js
     24.13.1, with 115 passing and 3 unsupported-syntax skips on Node.js 22.0.0

3. Option to send production logs to stdout

4. Cluster support that maintains citizen cache, session scope, etc.

5. Fix cache correctness and retain the first completed cold-cache entry
   — plan: open/cache-correctness.md
   - Confirmed fixes and first-entry retention implemented; remaining cache
     proposals and API decisions are tracked under "Consider" below

6. Add public API contract tests that call exported functions and load
   representative helper/model/view modules; type-only smoke tests cannot verify
   `app.log()`, `app.cache.*`, `app.session.end()`, or `app.start()` behavior
   - Correct the scaffolded application error hook's argument order to
     `(err, params, request, response, context)` and cover it through a loaded
     hook module; the current template puts `err` last

7. Test harness

8. Parse URL query params into params.query, separate from citizen path params
   — plan: open/url-query-params.md
   - Complete: decoded flat queries, independent inherited scopes, path-only
     routing, and query-independent caching; existing path allowlists unchanged
   - Direction updated 2026-10-09: queries do not vary cache keys or eligibility;
     developers decide which routes are appropriate to cache
   - HTML escaping (#2) and independent debug hardening under #1 are complete;
     cache diagnostic policy changes remain deferred
   - 130 tests pass on Node.js 24.13.1; cleanup validation is recorded in the plan

9. Validate and implement 1.x -> 2.x migration automation
   — guide: ../../MIGRATION.md
   — plan: open/migration-1-to-2.md

10. Safe shutdown

11. Review for request blockers and other single-threaded behavior

12. Forcing `response.contentType` in a controller (README "Forcing a Content
    Type") leaves the negotiated `Content-Type` header in place
   - `serve()` sets the header during content negotiation, before the
     controller runs; only request-cache hits reset it from
     `response.contentType`
   - An uncached route that forces JSON returns `Content-Type: text/html` with a
     JSON body

13. `helpers.copy()` turns `URL` instances into empty objects, so controllers
    and views receive `params.route.parsed` as `{}`; hooks get the real URL
   - Clone with `new URL(source.href)` before the ordinary-object branch; the
     clone's `searchParams` keeps duplicate values and is independent of the
     original
   - Other class instances are out of scope
   - Cover `copy()`, `extend()`, controller and include copies, and view
     context; once fixed, `params.route.parsed.searchParams` exposes repeated
     query values (#8)

14. Object-form `next` without a route shares the first controller's
    action-cache key: a cached first controller loops until the request times
    out, and a cached next controller replaces the first on warm requests,
    skipping its redirects
   — plan: open/object-next-cache-key.md

15. String-form `next` loses controller-chain state in the next controller's
    params and view context
   - `fireController()` replaces `controllerParams.route` with the freshly
     parsed next route, whose `chain` is empty
   - A next view reading `route.chain.previous.output` throws; configured
     layouts preserve the chain and are covered by #2's escaping regression
   - Found during #2 integration; repair independently of HTML escaping and
     #14's action-cache key fix

Consider (weigh pros/cons):

These entries track deferred proposals and open decisions. Scope and landing
requirements are selected separately from the implementation tasks above.

1. Self-contained includes/components
   - Component directory containing controller and deps, frontend JS/CSS, bundled into site files for deployment

2. Get rid of controllers directory and move routes and hooks up to the app directory

3. Replace chokidar with native Node file watcher (requires some workarounds/fallbacks that chokidar currently handles)

4. Superseded: opt-in query cache-key filtering; #8 now ignores all query
   names in cache keys and eligibility
   — notes: open/url-query-params.md#future-work

5. Clearing groups of equivalent reordered path parameters instead of exact
   keys only; query variants already share one entry
   — notes: open/url-query-params.md#future-work

6. Single-flight coordination for simultaneous cold-cache requests
   - Decide automatic versus opt-in enablement, GET/HEAD in-flight equivalence,
     whether to coalesce action fills, and which hooks/context work remains
     per request
   - Preserve dynamic cache decisions and release followers on failures,
     redirects, non-cacheable results, and disconnects; decide whether work
     continues after the leader disconnects
   — proposal: open/cache-correctness.md#proposed-cold-fill-design
   — decisions: cache plan 3–6

7. HTTP method eligibility and cache identity for request and action caching
   - Decide reuse across GET/POST and other methods, GET/HEAD equivalence, and
     consistency between completed entries and any future in-flight keys
   — notes: open/cache-correctness.md#key-selection-and-request-methods
   — decision: cache plan 8 (method policy remains open)

8. Stronger cache invalidation during clear and hot reload
   - Decide whether pre-clear work may publish afterward, and address the
     interval between clearing and loading replacement modules
   — notes: open/cache-correctness.md#clear-and-hot-reload-timing
   — decision: cache plan 7

9. Consistent default ETags for cold responses and retained cache entries
   - Decide whether insertion should return the selected record so concurrent
     cold writers can use the retained entry's validator; a shared cold/hit
     response path is another possible approach
   — decision: cache plan 9
   — notes: open/cache-correctness.md#design-and-api-decisions-not-confirmed-bugs

10. Cache lifespan validation and fallback policy
    - Define handling of invalid types, zero, negative, and non-finite values
    — decision: cache plan 1
    — notes: open/cache-correctness.md#design-and-api-decisions-not-confirmed-bugs

11. Support explicit `undefined` as a cached value
    - Current behavior treats it as an omitted value; changing that is a
      separate API decision
    — decision: cache plan 2
    — notes: open/cache-correctness.md#design-and-api-decisions-not-confirmed-bugs

12. Support `cache.get({ resetOnAccess: false })` as a retrieval override
    — decision: cache plan 12
    — notes: open/cache-correctness.md#file-cache-enablement-and-reset-defaults

13. File-cache enablement and default reset policy
    - Decide whether file caching follows application or static enablement,
      and application or static `resetOnAccess` defaults
    — decision: cache plan 12
    — notes: open/cache-correctness.md#file-cache-enablement-and-reset-defaults

14. Guarantee that cache API calls do not mutate caller-supplied options
    — decision: cache plan 14
    — notes: open/cache-correctness.md#design-and-api-decisions-not-confirmed-bugs

15. Evaluate whether retired invalid-URL-cache-parameter modes should return
    - Nonfatal path-cache diagnostics remain deferred with this policy review;
      #8 retains existing error-hook and exit behavior
    — decision: cache plan 13
    — notes: open/cache-correctness.md#design-and-api-decisions-not-confirmed-bugs

16. Cache reuse when a controller forces a different response content type
    - Lookup currently uses the negotiated type while insertion uses the forced
      one, so mismatched requests keep missing
    - Classify and select the lookup contract separately from #12's header fix
      and JSONP validation
    — decision: cache plan 17
    — notes: open/cache-correctness.md#forced-content-types-and-the-cache

17. Public trusted-HTML/raw-value API, such as `SafeString` or `raw()`
    - Evaluate separately from #2's selected `${{…}}` syntax; the current
      implementation plan keeps include values as strings
    — notes: open/html-escaping-double-bracket.md#implementation-readiness-review-and-selected-compiler-policy

18. Define `helpers.copy()` behavior for class instances beyond supported types
    - Decide preservation versus cloning independently of the bounded URL fix
      in #13; do not silently expand that repair
    — notes: open/url-query-params-history.md#repair-url-copying-in-helpers

19. Standalone migration CLI after the #9 agent workflow is validated
    - Evaluate only after exercising the workflow against representative apps
    — proposal: open/migration-1-to-2.md#possible-cli-after-the-workflow-stabilizes

20. Convenience translation from pathnames to full request-cache keys
    - Decide origin/query handling independently of current supplied-key lookup
      and exact-match clearing
    — proposal: open/cache-correctness.md#6-route-only-exists-confirmed-documented-bug

21. Cache API option precedence for mixed selectors such as `{ file, key }`
    - Evaluate separately from the repaired custom file-key replacement and
      existing lookup/clear behavior
    — notes: open/cache-correctness.md#2-make-cacheexists-total-for-valid-lookup-shapes
