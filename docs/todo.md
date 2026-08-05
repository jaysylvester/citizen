todo (2.0):

1. Comprehensive security review (XSS, cookie parsing, injection, config, log file contents)

2. HTML escaping in template literal views using double-bracket notation ${{local.whatever}}
   — plan: plans/html-escaping-double-bracket.md

3. Option to send production logs to stdout

4. Cluster support that maintains citizen cache, session scope, etc.

5. Test harness

6. Parse URL query params and add to params.url (API redirects coming from outside sources use traditional URLs, requiring parsing workarounds in citizen apps today)

7. Validate and implement 1.x -> 2.x migration automation
   — guide: ../MIGRATION.md
   — plan: plans/migration-1-to-2.md


Consider (weigh pros/cons):

1. Self-contained includes/components
   - Component directory containing controller and deps, frontend JS/CSS, bundled into site files for deployment

2. Get rid of controllers directory and move routes and hooks up to the app directory
