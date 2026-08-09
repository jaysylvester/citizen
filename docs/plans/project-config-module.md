# Plan: project-root citizen config module

Status: **Draft replacement for the full `CITIZEN_*` env-mapping design**

Reference implementation: branch `2.0-env-file-config-revised`

## Objective

Use each configuration format for the job it represents naturally:

- Node loads one project-root `.env` into `process.env` for application values,
  deployment inputs, and secrets.
- An optional project-root `citizen.config.js` exports Citizen's typed framework
  configuration as an ordinary JavaScript object.
- Controller and action configuration continues to override the resolved
  framework configuration for individual requests.

This retains automatic `.env` loading and container-friendly process
configuration without flattening Citizen's entire nested config tree into
environment-variable names.

## Why replace the full env mapping

The env-mapping branch proved that the complete framework config is a poor fit
for a string-only key/value format. Supporting every setting required:

- generating reversible names for nested paths;
- coercing strings into booleans, numbers, arrays, objects, regular expressions,
  and nullable values;
- special maps for optional and whole-object settings;
- heuristic handling for Node HTTP and HTTPS options;
- path normalization after mapping;
- a generated env catalog and a large env-oriented config reference;
- increasingly subtle validation rules for blank and JSON-looking values.

Node's dotenv convention concerns how a process receives environment values. It
does not require a framework to represent its entire typed configuration tree as
environment variables. The translation layer made a previously direct object
API harder to implement, document, inspect, and migrate.

The project configuration module restores the direct object model while keeping
the useful conclusions from the env work:

- one application and one project environment per Citizen process;
- one conventional project-root `.env`, loaded automatically;
- application-owned values stay in `process.env` rather than being copied into
  `app.config`;
- framework config is exposed directly at `app.config.*`, without the redundant
  `citizen` wrapper;
- `app.start()` starts the app and accepts no configuration;
- legacy host-selected JSON files are removed rather than supported alongside
  the new convention.

## Conventional project layout

```text
.env                 # local application environment; gitignored
.env.example         # committed environment reference
citizen.config.js     # committed typed framework configuration
package.json
app/
  start.js
  controllers/
  helpers/
  models/
  views/
web/
```

There is no alternate config filename, hostname selection, upward traversal,
CLI config flag, or `CITIZEN_CONFIG_FILE` selector.

## Configuration boundary

### `.env` and `process.env`

Citizen loads exactly `<project>/.env` through Node's native
`process.loadEnvFile()`. Citizen does not parse dotenv syntax itself. A missing
file is normal; values already present in the process environment remain
authoritative.

The environment belongs to the application and may contain database
credentials, API keys, service URLs, or any other deployment values:

```bash
NODE_ENV=development
DB_SERVER=localhost
DB_PASSWORD=secret
```

Citizen does not infer types or property paths for these values and does not
copy them into `app.config`.

### `citizen.config.js`

The optional config module default-exports one plain object using the same shape
that the framework exposes at runtime:

```js
export default {
  cors: {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': 'https://example.com'
  },
  development: {
    watcher: {
      interval: 500,
      usePolling: true
    }
  },
  http: {
    port: 3000
  }
}
```

Because this is JavaScript, values retain their actual types. Arrays are arrays,
regular expressions are regular expressions, and free-form HTTP options remain
ordinary nested properties. Citizen performs no env-name mapping and no string
coercion for this object.

The module may read `process.env` when a framework value genuinely varies by
deployment:

```js
export default {
  http: {
    port: Number(process.env.PORT || 3000)
  },
  https: {
    pfx: process.env.TLS_PFX || ''
  }
}
```

That conversion is explicit, local, and limited to values the application
actually sources from its environment. Citizen should document that the module
must not copy application secrets into its export unless exposing those secrets
through `app.config` is intentional.

### Bootstrap app directory

Citizen needs the app directory before it can locate `.env` or
`citizen.config.js`. The default remains `<cwd>/app`. Starting elsewhere may use
`CITIZEN_DIRECTORIES__APP` as the one process-only Citizen bootstrap variable.
It must be present before import and cannot be set by `.env` or the config module.

Startup fails clearly when the selected app directory does not exist. The
project root is the selected app directory's parent.

`directories.app` in the resolved config is always the selected absolute app
path. The config module may override the other directory settings with absolute
paths or paths relative to the project root.

## Resolution and precedence

Framework configuration precedence, from lowest to highest, is:

1. Citizen defaults, with `NODE_ENV` supplying the default mode when present.
2. The object exported by `citizen.config.js`.
3. Route controller and action configuration.

`.env` and the deployment environment are not generic framework-config layers.
They populate `process.env` before the config module is imported; the module
decides explicitly which environment values affect its exported object.

This removes the need to explain precedence between hundreds of generated env
keys and object properties.

## Config module contract

- Missing `citizen.config.js` loads Citizen defaults.
- A present module must have a default export.
- The default export must be a plain object; reject `null`, arrays, functions,
  promises, and primitive values with an error naming the file.
- Do not support environment-specific filenames or a function export.
- Import, syntax, and evaluation errors propagate with their original cause.
- Do not echo the exported object or environment values in startup logs.
- Config changes require an application restart; do not add config hot reload.

Avoid building a schema engine as part of this change. Native JavaScript types
remove the coercion problem. Existing server guards should provide actionable
errors for critical invalid combinations, while broader config validation can
be evaluated separately if real applications demonstrate a need.

## Runtime config shape

Retain the flat framework namespace established by the env work:

```text
citizen.config.js:  forms.maxPayloadSize
app.config:         forms.maxPayloadSize
params.config:      forms.maxPayloadSize
controller config: forms.maxPayloadSize
```

Do not restore `app.config.citizen.*`. Application-owned environment values stay
in `process.env`, so there is no competing application config object requiring a
wrapper around the framework settings.

`app.start()` accepts no configuration. Passing an argument throws the existing
actionable migration error.

## Loading sequence

Production startup should remain a thin wrapper around testable pieces:

```text
resolve app and project paths
  -> verify app directory
  -> reject legacy app/config/*.json
  -> load optional project .env through Node
  -> import optional citizen.config.js
  -> merge defaults and project object
  -> normalize resolved directory paths
  -> import app patterns
  -> start app
```

The config module must be imported after `.env` so it can read file-backed
application environment values. This likely makes the production configurator
async; `index.js` already uses top-level await and can await configuration before
importing patterns.

Keep pure helpers for defaults and object resolution. Do not retain generic
multi-source APIs, generated env maps, or exports used only by abandoned tests.

## Legacy migration guard

Retain the small guard from the env branch: if `app/config` contains JSON files,
fail startup and direct the user to the 2.0 migration guide. Do not parse, merge,
or select those files.

The migration target changes from generated `CITIZEN_*` variables to the typed
config module:

```js
// 1.x app/config/citizen.json
{
  "citizen": {
    "forms": {
      "maxPayloadSize": 1000000
    }
  }
}
```

becomes:

```js
// 2.x citizen.config.js
export default {
  forms: {
    maxPayloadSize: 1000000
  }
}
```

For host-selected files, the user still chooses the applicable deployment
values. Framework settings move into the module; application-owned settings and
secrets move into `.env` or the deployment environment.

## Global CORS and Node server options

Retain the optional global CORS baseline, but configure it directly:

```js
export default {
  cors: {
    'Access-Control-Allow-Origin': 'https://example.com'
  }
}
```

Controller and action objects continue to extend the baseline, and
`cors: false` disables it for a route.

HTTP and HTTPS options are also direct objects, so there is no passthrough name
conversion or whole-object JSON escape hatch:

```js
export default {
  http: {
    keepAliveTimeout: 5000,
    maxHeaderSize: 16384
  }
}
```

Retain HTTPS credential-path loading and server guards from the reference branch.

## Scaffold

The scaffold should:

- run from and write to the project root;
- update the existing project `package.json` rather than creating `app/package.json`;
- create `citizen.config.js` with the selected HTTP port as a number;
- create `.env` and `.env.example` with `NODE_ENV` and a clearly marked section
  for application-owned variables;
- ensure `.env` is ignored without overwriting existing Git ignore rules;
- create no `app/config` directory;
- keep `node app/start.js` as the no-flag startup command.

The scaffold's `--mode` option writes `NODE_ENV` in the env files. Its
`--network-port` option writes the numeric `http.port` value in
`citizen.config.js`.

The scaffold should fail with an actionable message when the current directory
does not contain the expected project `package.json`.

## Documentation changes

README:

- explain `.env` as the application/deployment environment, not the complete
  Citizen config;
- introduce the project-root `citizen.config.js` object with a short example;
- restore the config reference to runtime object paths and typed defaults rather
  than generated env names;
- document `NODE_ENV` and the process-only app-directory escape hatch;
- show explicit `process.env` use only for settings that vary by deployment;
- retain flat `app.config.*` and controller/action override examples;
- remove the generated env naming, coercion, whole-object JSON, and HTTP
  passthrough conventions.

Migration guide and automation plan:

- convert the legacy `citizen` object directly into `citizen.config.js`;
- move legacy application-owned roots and secrets to application env variables;
- remove JSON `host` after the user selects the deployment source;
- rewrite `app.config.citizen.*` and `params.config.citizen.*` to their flat forms;
- stop generating a large `CITIZEN_*` mapping or coercion report.

Changelog:

- describe the split between the application environment and the typed Citizen
  config module;
- identify removal of legacy JSON and `app.start()` config as breaking changes;
- avoid presenting every framework setting as an environment variable.

## Reuse from `2.0-env-file-config-revised`

Reimplement or selectively port these outcomes:

- flat `app.config.*` and `params.config.*` consumers;
- application variables remaining only in `process.env`;
- no-argument `app.start()`;
- the legacy JSON migration guard;
- automatic project-root `.env` loading through Node;
- cwd-based app discovery with fail-fast validation;
- project-root scaffold behavior and existing-package updates;
- `.env` Git ignore handling;
- global CORS baseline and route-level disable behavior;
- RegExp-safe `helpers.copy()`;
- watcher polling support as ordinary typed config;
- HTTPS credential paths and server guards;
- public export smoke tests and the default-export fix;
- package publication allowlist and Node engine update;
- independent error-template backslash fixes.

Discard rather than port:

- generated `CITIZEN_*` maps and reversible path naming;
- default-type and HTTP-option env coercers;
- optional/JSON env maps;
- applied/unknown/passthrough env-key logging;
- generated full framework `.env.example` content;
- env-oriented config tables and migration transforms;
- any Citizen-owned dotenv parser or stricter dotenv grammar.

Do not cherry-pick the large env implementation commits wholesale. Use the
reference branch to recover focused behavior and tests, then implement the new
config boundary directly.

## Tests

Configuration:

- defaults with neither `.env` nor `citizen.config.js`;
- `.env` loads through Node and exposes application values through `process.env`;
- process values remain above file values;
- the config module can read values loaded from `.env`;
- a typed config object preserves numbers, booleans, arrays, regular expressions,
  nulls, and free-form nested objects without coercion;
- missing config module is allowed;
- missing default export and non-object exports fail with the config path;
- module syntax/evaluation errors propagate;
- project config extends defaults without mutating the default object;
- relative directory overrides resolve against the project root;
- `.env` and the config module cannot relocate the bootstrap app directory;
- a missing selected app directory fails before pattern imports;
- legacy JSON triggers the migration error without being parsed.

Runtime:

- index import returns usable flat config and public collections/functions;
- `app.start()` rejects supplied configuration;
- controller and action config merge directly into `params.config`;
- global CORS merges, overrides, and disables correctly through the request path;
- HTTP/HTTPS typed options reach Node server creation;
- HTTPS credentials load only when the applicable server is enabled;
- watcher polling options reach Chokidar unchanged.

Scaffold and packaging:

- env and config files are created at the project root;
- `.env` contains the selected mode and `citizen.config.js` contains the numeric
  HTTP port;
- existing `.gitignore` content is preserved and `.env` is added once;
- the existing project package is updated and no app package is created;
- scaffold fails clearly without a project package;
- the scaffolded app boots once;
- `npm pack --dry-run` contains runtime templates and README while excluding
  internal docs.

Tests that load `.env`, import temporary config modules, or mutate `process.env`
should use isolated child processes to avoid module caching and global leakage.

## Work order

1. Start from the clean 2.0 planning base described below.
2. Write config-loader tests for the conventional paths and module contract.
3. Replace the legacy loader with Node env loading plus async config-module import.
4. Flatten runtime consumers and keep application values out of `app.config`.
5. Port server guards, RegExp-safe merging, global CORS, watcher settings, and
   public exports selectively from the reference branch.
6. Rewrite the scaffold around `.env`, `.env.example`, and `citizen.config.js`.
7. Rewrite README, changelog, migration guide, and migration automation plan.
8. Run syntax checks, the full suite, scaffold in a temporary project, boot the
   scaffold, and inspect `npm pack --dry-run`.

## Branch strategy

Use a clean branch and retain `2.0-env-file-config-revised` as a reference.

The best starting point is the existing `2.0` branch at `61f1029`, not current
`main` and not the env implementation tip. That commit already contains the 2.0
planning files and npm publication allowlist but predates the full env-config
implementation.

Before switching, preserve the current dirty worktree in a commit on
`2.0-env-file-config-revised`. Then create a new branch from `2.0`, for example:

```text
2.0-project-config
```

Keep the reference branch intact until the new implementation passes all tests
and its diff has been compared for reusable bug fixes. The error-template
backslash commit is independently scoped and may be cherry-picked after review;
the mixed env commits should be treated as reference material and reimplemented
selectively.

## Acceptance criteria

- Citizen contains no generic framework env-key generator or known-setting env
  coercer.
- Citizen delegates dotenv grammar entirely to Node and reads the file once.
- Application and secret values remain in `process.env` unless deliberately
  exported by `citizen.config.js`.
- Framework configuration uses a typed object whose paths match `app.config.*`
  and controller config directly.
- Missing optional files load defaults; missing app directories and legacy JSON
  fail clearly.
- No host-selected config, startup config object, alternate config filename, or
  CLI config selector remains.
- Global CORS, HTTP/HTTPS options, watcher options, directories, arrays, and
  regular expressions require no env-specific encoding.
- The scaffold produces one project package, one typed Citizen config module,
  and one conventional application environment.
- Documentation can explain the full configuration convention without a
  generated env mapping catalog.
- The full suite, scaffold boot, and package-content checks pass.
