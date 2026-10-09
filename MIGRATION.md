# Migrating citizen 1.x applications to 2.x

citizen 2.x replaces host-selected JSON files with a project-root JavaScript
configuration module and an optional project environment. The established
`citizen` namespace remains intact, and typed application configuration can
remain alongside it.

The default template literal engine also escapes HTML data by default. Audit
view composition and trusted markup as described in step 7 below.

| 1.x | 2.x |
| --- | --- |
| Node.js 16 or newer | Node.js 22 or newer |
| `app/config/*.json` | Project-root `citizen.config.js` |
| Hostname-selected config files | One config module per project/deployment |
| Secrets mixed into JSON config | Project `.env`, process environment, or secret files |
| `app.config.citizen.forms` | `app.config.citizen.forms` |
| Typed application config such as `app.config.db` | Typed application config such as `app.config.db` |
| citizen settings passed to `app.start()` | `citizen` in `citizen.config.js` |
| Application settings passed to `app.start()` | Still supported as optional application overrides |
| Raw `${…}` output in HTML template literal views | Escaped `${…}` data; `${{…}}` for trusted markup |
| Ignored query strings | Decoded `params.query`, separate from path-only `params.url`, with last-value wins |
| Query-bearing request-cache keys | Origin plus pathname; queries do not vary cache keys or eligibility |
| Executable `ctzn_inspect` expressions | Restricted property selectors |

Controller and action configuration remains a typed object and continues to
override citizen settings for an individual request.

## 1. Prepare the project

Create a migration branch and verify that the application runs on its current
citizen version. Preserve every legacy config file until the migrated
application has been tested.

Update the runtime declaration and dependency:

```json
{
  "engines": {
    "node": ">=22.0.0"
  }
}
```

```bash
npm install citizen@2
```

Inventory configuration sources and consumers:

```bash
find app/config -type f -name '*.json' -print
rg -n "app\.start\(|config\.citizen|app\.config|params\.config" app
```

Search for aliases, destructuring, computed properties, templates, and
deployment scripts as well; simple member-expression searches will not find
every use.

## 2. Convert JSON to the config module

Given a 1.x file such as:

```json
{
  "host": "dev.example",
  "citizen": {
    "mode": "development",
    "http": {
      "port": 8080
    },
    "forms": {
      "maxPayloadSize": 1048576
    }
  },
  "db": {
    "max": 10,
    "password": "secret",
    "port": 5432,
    "server": "localhost"
  }
}
```

create a project-root module that preserves the typed, non-secret settings:

```js
// citizen.config.js
export default {
  citizen: {
    forms: {
      maxPayloadSize: 1048576
    },
    http: {
      port: 8080
    },
    mode: 'development'
  },
  db: {
    max: 10,
    port: 5432,
    server: process.env.DB_SERVER || 'localhost'
  }
}
```

Move secrets and values genuinely supplied by the deployment environment out
of the committed module:

```bash
# .env
DB_PASSWORD=secret
DB_SERVER=localhost
```

Read secrets directly where they are consumed so they are not published
through `app.config`:

```js
const connection = connect({
  ...app.config.db,
  password: process.env.DB_PASSWORD
})
```

citizen loads `.env` before importing `citizen.config.js`, so the module may
read deployment values. Environment values remain strings; convert and validate
only values that genuinely cross that boundary. Stable numbers, booleans,
arrays, and objects should remain typed values in the module.

The legacy `host` selector has no replacement. Select the applicable settings
for the deployment or use explicit environment inputs where a value truly
varies.

## 3. Review `app.start()` options

citizen settings must be available before controllers, models, views, and
directories are loaded. Move any `citizen` object passed at startup into
`citizen.config.js`:

```js
// 1.x
app.start({
  citizen: {
    http: { port: 8080 }
  },
  db: {
    max: 20
  }
})
```

```js
// 2.x citizen.config.js
export default {
  citizen: {
    http: { port: 8080 }
  },
  db: {
    max: 10,
    port: 5432
  }
}
```

Application-only startup overrides remain supported:

```js
app.start({
  db: {
    max: 20
  }
})
```

`app.start()` options must be a plain object and cannot contain `citizen`.
They extend application settings from the config module and become publicly
available through `app.config`, so do not pass secrets. Prefer the config module
when application modules need a setting before `app.start()` runs.

## 4. Keep config references namespaced

The runtime paths from 1.x remain valid:

```js
app.config.citizen.forms.maxPayloadSize
params.config.citizen.forms.enabled
config.citizen.mode
app.config.db.port
```

Do not flatten citizen paths. Application properties remain at the top level,
so an application-owned `forms` object cannot collide with
`app.config.citizen.forms`.

Controller and action config remains relative to the citizen namespace:

```js
export const config = {
  controller: {
    contentTypes: ['application/json']
  },
  submit: {
    forms: {
      maxPayloadSize: 1000000
    }
  }
}
```

## 5. Review global CORS

Move a legacy global `citizen.cors` object under `citizen` in the root module.
Controller and action policies extend that baseline:

```js
// citizen.config.js
export default {
  citizen: {
    cors: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN
    }
  }
}
```

```js
// route controller
export const config = {
  submit: {
    cors: {
      'Access-Control-Allow-Methods': 'OPTIONS, POST'
    }
  },
  private: {
    cors: false
  }
}
```

If an environment value such as `CORS_ALLOW_ORIGIN` is required, validate it in
the config module or deployment configuration. Retest preflight, credentialed,
and disallowed requests after consolidating repeated controller policies.

## 6. Use the project-root convention

Run from the project root so citizen finds `<cwd>/app`, `.env`, and
`citizen.config.js`. A process that must start elsewhere can set
`CITIZEN_APP_PATH` to an absolute app path before importing citizen. This
bootstrap value cannot be placed in `.env` or changed by the config module.

Add `.env` to `.gitignore` and commit a safe `.env.example`. After every old
value has been classified, archive or remove `app/config/*.json`. citizen
deliberately refuses to start while JSON config files remain so an incomplete
migration cannot silently use defaults.

Classify each old value as one of:

- a citizen setting under `citizen` in `citizen.config.js`;
- a typed, non-secret application setting in `citizen.config.js`;
- a deployment input or secret in the environment;
- a controller/action override;
- obsolete and intentionally removed.

## 7. Migrate template literal views

In `text/html` responses from the default engine, ordinary `${expression}`
escapes `&`, `<`, `>`, `"`, and `'`. Keep request and application data in ordinary
interpolations, including error messages and stacks. Null/undefined output is
unchanged, and intermediate templates or JSON inside an ordinary expression
retain their native values; only the final result is escaped.

Audit every expression that produces markup:

- Use `${{local.trustedHtml}}` for HTML already trusted or sanitized by your
  application. Raw output does not sanitize HTML.
- Keep direct top-level includes such as `${include._head}` as they are.
  Include values remain strings. Conditional includes, nested include
  references, concatenated includes, and controller-chain output need explicit
  raw syntax, for example `${{route.chain.article.output}}`.
- Change layout loops to
  `${{Object.keys(route.chain).map(name => route.chain[name].output).join('')}}`.
- Convert markup concatenation into a nested template whose data is escaped:
  ``${{cookie.username ? `<p>Welcome, ${cookie.username}</p>` : '<a href="/login">Login</a>'}}``.
  Direct helper results, ternary strings, and `.join()` separators inside raw
  expressions are emitted raw; do not mechanically mark untrusted
  concatenations as raw.
- Inside raw expressions, untagged nested templates are markup builders, even
  when used as keys or comparison values. Build intermediate data outside the
  raw expression. Ordinary nested interpolations own their final escaping
  boundary. Tagged template strings and substitutions stay native; the
  expression selecting the tag follows normal transformation rules. Raw
  markers within tagged substitutions fail compilation.
- Write `${ {a: 1} }` for an object expression. Adjacent `${{a: 1}}` is now
  interpreted as raw syntax and fails because `a: 1` is not an expression.

Use supported output contexts: HTML text and quoted ordinary attributes.
HTML escaping does not filter URL schemes or protect unquoted attributes,
JavaScript-bearing attributes, or `<script>`/`<style>` content. Prefer
`data-state="${JSON.stringify(local.state)}"` for client-side data. For a JSON
script data block, serialize it in the controller with
`JSON.stringify(state).replaceAll('<', '\\u003c')`, then emit only that serialized
JSON with `${{…}}`. This prevents embedded `</script>` and `<!--` sequences;
the replacement is not a serializer for arbitrary JavaScript or CSS.

View code remains trusted JavaScript; `eval()` and `with` are outside the
escaping protection contract. Plain-text responses normalize raw markers but
do not escape values. JSON/JSONP and third-party engines are unchanged.

Test representative normal and error views, includes, layouts, and cached
responses before deploying. Syntax failures name the view path and never fall
back to an older compiled function or raw source.

## 8. Review query data, caching, and debug selectors

Query strings now reach `params.query`, while `params.url` remains the citizen
path scope. Query names and values are decoded once, stay flat and
case-sensitive, and remain strings; repeated decoded names use their last
value. Path values keep their existing encoding. Review callback handlers and
applications that parsed query strings manually.

Queries do not select framework routing fields. `action`, `direct`, controller
names, `callback`, and `ctzn_*` in a query are ordinary data. Routing, JSONP
callbacks, and per-request debug controls continue to read citizen path params.
String include/next targets inherit the original query scope independently;
the target's own query values override inherited query values only.

Action-cache keys use the action's own pathname. Request-cache keys now use the
origin plus pathname, without a query. All query variants, including a bare
trailing `?`, use the same entry and the same eligibility checks. There is no
query-specific bypass or configuration. Queries do not participate in cache
`urlParams` allowlists.

Review each cached route: a hit skips its cached controller, so auth callbacks
and other routes that must act on query values on every request should remain
uncached. A conditional cache directive returned by the controller cannot
prevent a pre-existing cache hit. Put values that distinguish cached output in
the citizen path, or leave that route uncached. Inherited values do not vary a
child action's key. Use its pathname for exact action clearing and the origin
plus pathname for request clearing. The independent route-less
object-next identity repair remains tracked separately.

Existing path allowlist checks and error handling remain unchanged, including
inherited path checks on child actions and the `exit` policy. Query names stay
outside those checks because they are absent from `params.url`.

Replace executable `ctzn_inspect` expressions with selectors rooted at
`params`, `request`, `response`, or `context`. Dot properties, quoted literal
bracket keys, and nonnegative integer indexes work. Calls, computed expressions,
assignments, optional chaining, parentheses, and prototype-related segments
are rejected before any property reads. Function values can be inspected but
cannot be invoked by a selector. Missing properties retain `undefined`, and
invalid selectors or throwing getters produce fixed diagnostics without
failing the request. Trusted getters can still run during ordinary reads.

The `ctzn_inspect` path value remains URL-encoded. Spaces, double quotes, and
Unicode characters are encoded, and raw backslashes normalize to slashes;
JavaScript string escapes cannot be passed through this URL control. Select
the whole `params.query` map to inspect query keys with spaces or Unicode.

Debug controls remain path-only, and a selector can inspect `params.query`.
Query values cannot enable debug or replace a path selector. Production
suppression and the existing output formatting remain in place.

## 9. Verify

Confirm that no active JSON configuration or startup citizen settings remain:

```bash
find app/config -type f -name '*.json' -print
rg -n -U "app\.start\([\s\S]*?citizen" app
```

Then verify that:

1. `.env` is ignored and `.env.example` contains no secrets.
2. The app starts with and without a local `.env` as appropriate.
3. Deployment environment values remain authoritative over `.env`.
4. Typed citizen and application settings appear under the expected `app.config` paths.
5. `app.start()` application overrides merge without changing `app.config.citizen`.
6. Controller/action overrides, CORS, HTTP/HTTPS, sessions, caching, logs, and watchers behave as expected.
7. The normal test suite and representative endpoint smoke tests pass under Node.js 22.
8. Ordinary view data is escaped, trusted markup composition works, and cached HTML retains the same behavior.
9. Query callbacks, path-only routing and cache identity, cache allowlists and exact clearing, and debug query data behave as documented.

Cases requiring manual review include multiple host configs, computed startup
values, config aliases, dynamic property access, and secret-bearing tracked
files.
