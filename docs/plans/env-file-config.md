# Plan: .env file configuration

Target release: **2.0** (see `docs/todo.md` #3)
Status: **Additive.** The JSON config convention stays as a deprecated fallback,
so 2.0 requires no migration. Removal targeted at 3.0.

## Current state

All config resolution lives in one module,
[`init/config.js`](../../init/config.js) (179 lines). It builds a plain object at
import time and hands it to [`index.js`](../../index.js), which parks it on
`global.CTZN.config`. Every other module — [`lib/server.js`](../../lib/server.js),
[`lib/cache.js`](../../lib/cache.js), [`lib/session.js`](../../lib/session.js),
[`lib/hooks/application.js`](../../lib/hooks/application.js) — reads the
*resolved* object and never touches the filesystem or knows where a value came
from.

**That single fact is what makes this change small.** Swapping the source of
config is a rewrite of one function (`getConfig()`, [config.js:134-177](../../init/config.js#L134-L177))
plus documentation. No consumer changes.

Today's hierarchy:

1. `app/config/*.json` — every file is parsed, the one whose `host` key matches
   `os.hostname()` wins
2. otherwise `app/config/citizen.json`
3. `app.start({…})` options ([server.js:47](../../lib/server.js#L47))
4. route controller `config` exports

Config surface: **60 scalar/array leaves** under `citizen.*`, plus four
free-form nodes with no defaults (`citizen.cors`, `citizen.cache.control`,
`citizen.https.pfx|key|cert` + passthrough `createServer()` options), plus
**arbitrary app-owned nodes** (`db`, etc.) exposed at `app.config.db.*`.

## Goals

- Secrets out of committed files; config settable by real environment variables
  (Docker, systemd, PaaS) with no file at all
- Keep the per-environment convenience the `host` key provides today
- No breakage for 1.x apps

## Design

### 1. Separate loading from mapping

Two independent steps. This matters — it means an app that starts with
`node --env-file=.env app/start.js`, or one that gets its vars from Docker,
needs no citizen file loading at all.

```
[ .env files ] --load--> process.env --map--> { citizen: { … } } --extend--> config
```

Node covers the loading half natively: `process.loadEnvFile(path)` and
`util.parseEnv(string)` (both v20.12+), or the `--env-file` /
`--env-file-if-exists` flags. Verified behavior of Node's loader, which the plan
depends on:

- **Real environment variables win** over values in a loaded file
- **No `${VAR}` interpolation** — `EXPAND=${BAR}/x` stays a literal string
- Quoted multi-line values and `#` comments are supported

Use `util.parseEnv()` rather than `process.loadEnvFile()` for citizen's own
loading, so citizen controls precedence across multiple files instead of
inheriting first-write-wins, and so file values never leak into `process.env`
for unrelated code to read.

### 2. Key naming

Env keys are derived mechanically from the default config: strip the `citizen`
node, split camelCase, upper-snake, join with `_`, prefix `CITIZEN_`.

```js
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
// citizen.cache.application.resetOnAccess -> CITIZEN_CACHE_APPLICATION_RESET_ON_ACCESS
// citizen.forms.maxPayloadSize            -> CITIZEN_FORMS_MAX_PAYLOAD_SIZE
```

Because the map is *generated from the defaults object* rather than hand-written,
it can't drift, and the reverse lookup is unambiguous. **Verified: all 60 leaves
generate distinct keys — zero collisions.** Add a startup assertion in
development mode so a future config addition that does collide fails loudly.

Unknown `CITIZEN_*` variables are ignored, but should be logged as a warning in
development mode — a typo in `CITIZEN_HTTP_PROT` would otherwise fail silently.

### 3. Type coercion

Coerce against the type of the default value, so no type annotations are needed
in the `.env`:

| Default type | Env value                      | Result                            |
| ------------ | ------------------------------ | --------------------------------- |
| `boolean`    | `true` / `false` / `1` / `0`   | boolean (anything else → error)   |
| `number`     | `3000`                         | `Number()`, reject `NaN`          |
| `string`     | `development`                  | as-is                             |
| `array`      | `text/html,text/plain`         | split on `,`, trim (full replace) |
| `array`      | `["text/html"]`                | `JSON.parse` if it starts with `[`|
| `RegExp`     | `(^\|[/\\])\..`                | `new RegExp(value)`               |
| `null`       | `100`                          | number if numeric, else string    |

Coercion failures should throw at startup with the offending key name, not
silently produce `NaN` or the string `"false"`. A bad `CITIZEN_HTTP_PORT` must
not reach `httpServer.listen()`.

### 4. Free-form nodes

The four nodes with no defaults to type against take **JSON string values**:

```bash
CITIZEN_CORS='{"Access-Control-Allow-Origin":"https://example.com"}'
CITIZEN_CACHE_CONTROL='{"/":"max-age=86400","/images":"max-age=31536000"}'
CITIZEN_HTTPS_PFX=/absolute/path/to/site.pfx
```

`pfx`/`key`/`cert` are plain path strings; `cors` and `cache.control` are maps
with arbitrary keys, so JSON is the only sane flat encoding. General rule to
document: any value beginning with `{` or `[` is parsed as JSON.

**Unknown keys under `citizen.http` / `citizen.https` pass through** to Node's
`createServer()` rather than being rejected as typos. Since `start()` no longer
supplies these (§7), env is now their only route, and there are no defaults to
type against. Reverse the naming transform (lowercase, capitalize after `_`) and
coerce heuristically:

```bash
CITIZEN_HTTP_KEEP_ALIVE_TIMEOUT=5000   # -> citizen.http.keepAliveTimeout = 5000
CITIZEN_HTTPS_MAX_HEADER_SIZE=16384    # -> citizen.https.maxHeaderSize   = 16384
```

The reverse transform is only lossless because Node's options are camelCase with
no consecutive capitals — true for the current `createServer()` surface, but
document the JSON escape hatch (`CITIZEN_HTTP='{"…":…}'`) for anything it can't
express.

### 5. App-owned config — the one real design consequence

`APP_DB_SERVER` cannot be unambiguously mapped to `db.server` (vs `dbServer`,
vs `db.se.rver`) because there's no default object to match its shape against.
Rather than invent a lossy convention, **citizen's env mapping covers the
`citizen.*` namespace only**, and app settings move to `start.js`:

```js
// app/start.js
app.start({
  db: {
    server:   process.env.DB_SERVER,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
})
```

This is idiomatic Node, and it's a security improvement:
`development.debug.scope.config` dumps `params.config` to the console and
optionally into the view ([server.js:1641](../../lib/server.js#L1641)), so today
a `db.password` sitting in `citizen.json` gets rendered in debug output.
Under the new convention the developer chooses what lands in `app.config`, and
`process.env.DB_PASSWORD` can stay out of it entirely.

Document this prominently — along with the `start({ citizen })` deprecation it's
one of only two user-visible behavior changes in the plan, and it's the reason
the deprecated JSON path still earns its keep (see the evaluation below).
The inverse also holds: `start()` no longer sets
`citizen.*` (§7), so the two sources partition cleanly rather than overlapping.

### 6. One `.env`, found by upward traversal

**A single uncommitted `.env` plus a committed `.env.example`.** No
`.env.<mode>`, no `.env.<hostname>`, no `.env.local`. The host-keyed multi-file
convention existed so per-environment configs could be committed together, but
secrets always had to be pulled out separately anyway, which defeated the point.
Per-environment values are the deployment's job now — a real `.env` on each host,
or actual environment variables. `CITIZEN_ENV_FILE` (and Node's `--env-file`)
remain the escape hatch for anyone who wants explicit per-environment files.

Discovery walks **upward from the app directory**, returning the first `.env`
found:

```js
// from CTZN.config.citizen.directories.app, walk up
//   <root>/app/.env      -> found? use it
//   <root>/.env          -> found? use it   <- Node convention, the documented default
// stop at the first ancestor containing .git or node_modules (= project root),
// or the filesystem root, whichever comes first
```

This lands on the Node convention (project root, next to `node_modules/`) while
still honoring an `app/.env` if someone prefers citizen's app-local layout — one
rule, both outcomes, no second code path. Deriving the root arithmetically
instead (`new URL('../../../', import.meta.url)`) would be shorter but assumes
citizen sits at `<root>/node_modules/citizen`, which pnpm layouts, hoisting, and
`npm link` all break. Traversal is startup-only, so the extra `stat` calls cost
nothing. **Log the resolved path at startup** — "which `.env` did it actually
find" must never be a guess.

### 7. Namespace split: env owns `citizen.*`, `start()` owns the app

The two config sources are kept strictly disjoint:

| Source            | Owns                                          |
| ----------------- | --------------------------------------------- |
| `.env` / env vars | `citizen.*` — framework settings only         |
| `app.start({…})`  | app-owned nodes (`db`, etc.) — everything else |

This drops the awkward env-vs-`start()` precedence question entirely: for any
given key exactly one source is authoritative, so there's no ordering to explain
or defend. It also matches how the two are actually used — framework settings
vary per deployment, app structure doesn't.

Consequence: `app.start({ citizen: { https: { pfx: '…' } } })`, which the README
currently documents, becomes `CITIZEN_HTTPS_PFX=…`. Since that's a documented
1.x API, deprecate rather than break — consistent with the JSON decision:

- **2.x** — `start({ citizen: … })` still applies, at lowest precedence (below
  both the deprecated JSON file and env), and logs a deprecation warning naming
  the env variables that replace the keys it saw
- **3.0** — the `citizen` node in `start()` options is ignored

Final chain, lowest to highest:

1. citizen defaults
2. `app.start({ citizen: … })` — **deprecated**, warns
3. `app/config/*.json` — **deprecated**, warns
4. `.env` file
5. real `process.env` (never overwritten by the file)
6. route controller `config` exports — unchanged, still last

`NODE_ENV` keeps working as the `mode` default; `CITIZEN_MODE` overrides it.

The root-level `host` key has no function left under env config — it existed
solely to select among JSON files. It stays readable at `app.config.host` for the
deprecated path and for `start()`, documented as deprecated, and disappears with
the JSON loader in 3.0.

### 8. Startup logging

Report *which* files were loaded and *how many* `CITIZEN_*` variables were
applied. **Never log values** — the current implementation's habit of echoing the
config file path is fine, echoing contents would not be.

## Evaluating the deprecated JSON fallback

**Verdict: low complexity. Keep it through 2.x.**

The fallback is cheap because config resolution is already fully encapsulated.
`getConfig()` survives essentially as written; the env layer becomes another
`helpers.extend()` call on top of its return value:

```js
const config = helpers.extend(
  helpers.extend(defaultConfig, getJsonConfig()),  // deprecated path, unchanged
  getEnvConfig()
)
```

What it costs:

| Item                                                        | Effort |
| ----------------------------------------------------------- | ------ |
| Retain `getConfig()` + `host` matching                       | ~0 — existing code, untouched |
| Deprecation warnings, JSON + `start({ citizen })`            | ~15 lines |
| Two extra `extend()` calls in the chain                      | 2 lines |
| README documents two conventions until 3.0                   | moderate, the real cost |
| Test matrix roughly doubles (json-only, env-only, both, +`start()`) | ~8 extra cases |

What makes it *not* free:

- **The precedence rule must be stated and defended.** Env wins over JSON. An
  app with both, where the JSON is the "real" config and a stray exported
  `CITIZEN_HTTP_PORT` overrides it, is a confusing afternoon. The dev-mode
  startup log listing applied env keys is the mitigation, not an optional nicety.
- **There are now two deprecated paths, not one** — the JSON file and
  `start({ citizen: … })` (§7). They share the removal date and the chain has
  room for both, so the marginal cost of the second is a warning and a test case.
  Both warnings should name the specific env variable that replaces what they
  saw, so the message is actionable rather than scolding.
- **The fallback is load-bearing, not vestigial.** Per §5, arbitrary app config
  (`app.config.db.*`) has no env equivalent by design. Until the docs fully
  establish `start()`-reads-`process.env` as the replacement, JSON files remain
  the only *declarative* way to get custom nodes into `app.config`. Frame the
  deprecation as "JSON config is deprecated; here is the replacement for each of
  its two jobs" — env vars for `citizen.*`, `start()` for everything else.
- **Two loaders means two failure modes** to keep tested: unparseable JSON
  (already handled, [config.js:166](../../init/config.js#L166)) and uncoercible
  env values (new).

The alternative — removing JSON in 2.0 — saves perhaps 40 lines and a README
section, and costs every existing app a migration in a release that is already
carrying a breaking view-syntax change. Not worth it. Deprecate in 2.0, warn
throughout 2.x, remove in 3.0.

## Work breakdown

| # | Change | Files | Size |
| - | ------ | ----- | ---- |
| 1 | Env key map generated from `defaultConfig`; coercion; `http`/`https` passthrough; collision assert | `init/config.js` | ~130 lines new |
| 2 | Upward `.env` discovery + `util.parseEnv` | `init/config.js` | ~30 lines |
| 3 | Deprecation warnings: JSON path, `start({ citizen })` | `init/config.js`, `lib/server.js` | ~15 lines |
| 4 | Startup log: resolved `.env` path, env key count, unknown-key warnings | `init/config.js` | ~15 lines |
| 5 | Scaffold emits `.env.example` + `.gitignore` (with `.env`) instead of `config/citizen.json`; generate `.env` from it | `util/scaffold.js`, `util/templates/` | moderate |
| 6 | `engines` bump to `>=22` (Node 20 is EOL; `util.parseEnv` needs ≥20.12) | `package.json`, `util/templates/package.json` | trivial |
| 7 | README: Configuration section (L111-310), config table (L310-1075) gains an env-var column, Quick Start + Utilities file trees, `start()` HTTPS example rewritten to env | `README.md` | **largest single item** |
| 8 | CHANGELOG 2.0 entry | `CHANGELOG.md` | small |
| 9 | Tests (see below) | new | ~150 lines |

Item 5 is worth doing properly: `.env.example` is what makes the
single-`.env` convention work. Scaffold should write both — a committed
`.env.example` documenting every `CITIZEN_*` key with its default (generatable
from `defaultConfig`, so it can't go stale) and a gitignored `.env` copied from
it — plus a `.gitignore`, which the scaffold doesn't currently produce at all.

### Tests

The repo has **no test infrastructure** — no `test/`, no `scripts` in
`package.json`. Config resolution is the ideal place to start one: it's pure
(inputs → object) once `getConfig()` takes its sources as arguments instead of
reading module-scope constants. Suggested minimal `node:test` suite:

- defaults only
- env-only, each coercion type incl. the failure cases
- `http`/`https` unknown-key passthrough and its reverse naming transform
- JSON-only (regression — 1.x behavior preserved, `host` matching included)
- both present → env wins
- `.env` file < real `process.env`
- upward discovery: `app/.env` preferred over `<root>/.env`; stops at the root
  boundary; no `.env` anywhere is not an error
- `start()` app nodes merge; `start({ citizen })` warns but still applies in 2.x

Requires one small refactor: `init/config.js` currently resolves at import time
as a module side effect. Export a `buildConfig({ env, files })` function and keep
the import-time call as a thin wrapper.

## Pre-existing bugs this work touches

Both were found while tracing the config path and should be fixed alongside it —
the env implementation walks the same merge code.

1. **`helpers.copy()` destroys RegExp values.** `copy(/re/)` returns `{}`
   ([helpers.js:20-25](../../lib/helpers.js#L20-L25) — a RegExp satisfies
   `Object(o) === o`, and `Object.assign({}, regex)` yields `{}` because
   `lastIndex` is non-enumerable). Verified. Consequence: any app that has a
   config file gets `helpers.extend(defaultConfig, appConfig)`, which silently
   turns `development.watcher.ignored` into `{}` — so the default dotfile-ignore
   for the dev watcher is not actually in effect for those apps. Fix `copy()` to
   pass RegExp (and `Date`, already handled) through by reference or clone.
   `CITIZEN_DEVELOPMENT_WATCHER_IGNORED` hits the identical path.
2. **Config values are logged into views.** Not a bug in itself, but §5's
   guidance should be paired with a README note under
   `development.debug.scope.config` that anything in `app.config` may be rendered
   in debug output.

## Resolved decisions

1. **No multi-file env convention.** One uncommitted `.env`, one committed
   `.env.example` (§6). The host-keyed multi-config idea doesn't survive contact
   with the fact that secrets had to be separated out of it anyway.
2. **Project root, found by upward traversal from `app/`** (§6). Startup-only, so
   the traversal costs nothing, and it beats deriving the root from citizen's own
   install path.
3. **Namespaces stay distinct** (§7): env sets `citizen.*`, `start()` sets app
   config. Overlap — and therefore the precedence question — is designed out.

## Remaining decision

**How hard to deprecate `start({ citizen: … })`.** The plan proposes warn-and-honor
through 2.x, removal in 3.0, matching the JSON file's treatment. The alternative
is ignoring it outright in 2.0: cleaner, enforces the split immediately, and
breaks the HTTPS setup of anyone following the current README example. Since 2.0
is already carrying a breaking view-syntax change, adding a second breaking
change has real cost — but if the split is meant to be a hard rule rather than a
convention, one deprecation cycle is the price.
