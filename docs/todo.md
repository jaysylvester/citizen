todo (2.0):

1. Comprehensive security review (XSS, cookie parsing, injection, config, log file contents)
   - Replace CORS regular expressions built from request-controlled origins and
     methods with exact comparisons; add request-level coverage for the global
     baseline, controller/action overrides, `cors: false`, and metacharacter
     origins

2. HTML escaping in template literal views using double-bracket notation ${{local.whatever}}
   — plan: plans/html-escaping-double-bracket.md

3. Option to send production logs to stdout

4. Cluster support that maintains citizen cache, session scope, etc.

5. Fix `app.cache.exists()` throwing when the requested built-in cache scope
   (`app` or `files`) has not been created or was removed after its last item
   was cleared; missing entries should return `false`

6. Add public API contract tests that call exported functions and load
   representative helper/model/view modules; the current JSON-based smoke test
   drops functions and cannot verify `app.log()`, `app.cache.*`,
   `app.session.end()`, or `app.start()`

7. Test harness
   - Restore `global.CTZN` after tests that replace it so test order cannot leak
     framework state

8. Parse URL query params and add to params.url (API redirects coming from outside sources use traditional URLs, requiring parsing workarounds in citizen apps today)

9. Validate and implement 1.x -> 2.x migration automation
   — guide: ../MIGRATION.md
   — plan: plans/migration-1-to-2.md

10. Safe shutdown

11. Give the scaffold an actionable error when it is run outside a project with
    an existing `package.json`, instead of exposing the raw filesystem `ENOENT`

12. Move the `CITIZEN_COMPRESSION__FORCE` allowed values and nonblank directory
    constraints out of the generic coercer and into per-setting metadata

13. Rename the `logEnv()` result parameter so it doesn't require expressions
    such as `config.config.mode`


Consider (weigh pros/cons):

1. Self-contained includes/components
   - Component directory containing controller and deps, frontend JS/CSS, bundled into site files for deployment

2. Get rid of controllers directory and move routes and hooks up to the app directory

3. Replace chokidar with native Node file watcher (requires some workarounds/fallbacks that chokidar currently handles)
