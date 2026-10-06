todo (2.0):

1. Comprehensive security review (XSS, cookie parsing, injection, config, log file/stdout contents, CORS implementation)
   - Add request-level regression coverage for literal CORS origins containing
     regular-expression metacharacters

2. HTML escaping in template literal views using double-bracket notation ${{local.whatever}}
   — plan: plans/html-escaping-double-bracket.md

3. Option to send production logs to stdout

4. Cluster support that maintains citizen cache, session scope, etc.

5. Fix cache correctness and retain the first completed cold-cache entry
   — plan: open/cache-correctness.md
   - Confirmed fixes and first-entry retention implemented; single-flight deferred

6. Add public API contract tests that call exported functions and load
   representative helper/model/view modules; type-only smoke tests cannot verify
   `app.log()`, `app.cache.*`, `app.session.end()`, or `app.start()` behavior
   - Correct the scaffolded application error hook's argument order to
     `(err, params, request, response, context)` and cover it through a loaded
     hook module; the current template puts `err` last

7. Test harness

8. Parse URL query params and add to params.url (API redirects coming from outside sources use traditional URLs, requiring parsing workarounds in citizen apps today)
   - Check against cache URL param allowlist

9. Validate and implement 1.x -> 2.x migration automation
   — guide: ../MIGRATION.md
   — plan: plans/migration-1-to-2.md

10. Safe shutdown

11. Review for request blockers and other single-threaded behavior

12. Forcing `response.contentType` in a controller (README "Forcing a Content
    Type") leaves the negotiated `Content-Type` header in place
   - `serve()` sets the header during content negotiation, before the
     controller runs; only request-cache hits reset it from
     `response.contentType`
   - An uncached route that forces JSON returns `Content-Type: text/html` with a
     JSON body

Consider (weigh pros/cons):

1. Self-contained includes/components
   - Component directory containing controller and deps, frontend JS/CSS, bundled into site files for deployment

2. Get rid of controllers directory and move routes and hooks up to the app directory

3. Replace chokidar with native Node file watcher (requires some workarounds/fallbacks that chokidar currently handles)
