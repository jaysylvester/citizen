# Plan: project-root typed configuration

Status: **Implemented revised configuration contract**

Reference implementation: branch `2.0-project-config-module`

Implementation branch: `2.0-project-config-module-revised`

## Objective

Use each configuration format for the values it represents naturally:

- Node loads one optional project-root `.env` into `process.env` for secrets and
  values supplied by the deployment environment.
- One optional project-root `citizen.config.js` exports typed Citizen and
  application configuration.
- Citizen settings remain under the established `citizen` namespace.
- Typed application settings remain at top-level application-owned paths.
- `app.start(options)` may extend application configuration but cannot change
  Citizen settings after framework initialization.
- Controller and action config continues to override Citizen settings for an
  individual request.

## Rationale

The full `CITIZEN_*` environment mapping proved that a string-only key/value
format is a poor representation of Citizen's typed configuration tree. It
required generated names, coercers, special maps, JSON escape hatches, path
normalization, and increasingly subtle validation.

The first config-module replacement removed that mapping but also removed
application config. That overcorrected the boundary:

- non-secret application settings were forced into `.env`;
- values that were numbers and booleans in 1.x required new string coercion;
- invalid strings introduced states such as `NaN` that did not exist when the
  same values came from JSON;
- application settings could no longer be grouped and accessed through
  `app.config`;
- flattening Citizen settings created potential collisions with application
  properties such as `forms`.

Restoring the `citizen` namespace solves the collision problem and preserves the
useful 1.x object model. JavaScript replaces JSON as the typed source, while
`.env` remains available for values that genuinely cross the deployment
boundary.

## Conventional project layout

```text
.env                 # local secrets and deployment inputs; gitignored
.env.example         # committed environment reference
citizen.config.js     # committed typed Citizen and application config
package.json
app/                  # application source directory
  start.js
  controllers/
  helpers/
  models/
  views/
web/
```

The project root is the application root. `app/` is the application source
directory, not a separate package root.

There is no alternate config filename, hostname selection, upward traversal,
CLI config flag, or `CITIZEN_CONFIG_FILE` selector.

## Configuration boundary

### `.env` and `process.env`

Citizen loads exactly `<project>/.env` through Node's native
`process.loadEnvFile()`. A missing file is normal. Values already present in the
process environment remain authoritative.

Use the environment for:

- secrets;
- secret-file paths;
- container service discovery;
- values genuinely supplied by the deployment environment.

Citizen does not generate environment names, infer paths, coerce strings, or
copy environment values into `app.config` automatically.

### `citizen.config.js`

The module default-exports the complete typed project configuration:

```js
export default {
  citizen: {
    cors: {
      'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN
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
  },
  db: {
    connectionTimeoutMillis: 5000,
    host: process.env.DB_HOST || 'localhost',
    max: 10,
    port: 5432
  }
}
```

Arrays, objects, numbers, booleans, nulls, and regular expressions retain their
native types. Stable non-secret application settings should remain typed in the
module rather than being converted into environment variables.

The module loads after `.env`, so it may read deployment values. Conversion and
validation belongs at that explicit boundary. Secrets should generally be read
where consumed rather than exported through the publicly accessible
`app.config` object.

### Config module contract

- Missing `citizen.config.js` loads Citizen defaults and no application config.
- A present module must default-export a plain object.
- A present `citizen` property must also be a plain object.
- Reject nulls, arrays, functions, promises, and primitive module exports with
  an error naming the file.
- Import, syntax, and evaluation errors propagate with their original cause.
- Do not support environment-specific filenames or function exports.
- Do not echo the exported object or environment values in startup logs.
- Config changes require an application restart.

Avoid adding a schema engine as part of this work. Native JavaScript types
remove the generic coercion problem; applications can validate the external
values they actually consume.

## Runtime shape and precedence

The module shape matches the public runtime shape:

```text
citizen.config.js:        citizen.forms.maxPayloadSize
app.config:               citizen.forms.maxPayloadSize
params.config:            citizen.forms.maxPayloadSize
controller config:        forms.maxPayloadSize

citizen.config.js:        db.port
app.config:               db.port
params.config:            db.port
```

Citizen configuration precedence, lowest to highest:

1. Citizen defaults, with `NODE_ENV` supplying the default mode.
2. `citizen.config.js` → `citizen`.
3. Route controller config.
4. Controller action config.

Application configuration precedence, lowest to highest:

1. Top-level application properties in `citizen.config.js`.
2. Application properties passed to `app.start(options)`.

Controller/action config extends only `params.config.citizen`. It cannot mutate
application-owned properties that happen to share a name with Citizen settings.

Unsupported Citizen modes warn at startup and fall back to production. An
explicit `citizen.mode` overrides `NODE_ENV`.

## `app.start(options)`

Continue supporting optional application configuration:

```js
app.start({
  db: {
    max: 20
  }
})
```

The argument must be a plain object. Its application properties deep-extend the
module's application properties before the application-start hook and server
creation.

Reject a `citizen` property with an actionable message. Citizen configuration
must be available while directories and application modules are loaded, so
accepting only the subset that happens to be consumed at server startup would
create inconsistent behavior.

Do not pass secrets through `app.start()` because its resolved options become
available through `app.config`.

## Bootstrap app directory

Citizen needs the app directory before it can locate `.env` or
`citizen.config.js`. The default is `<cwd>/app`. Starting elsewhere may use
`CITIZEN_APP_PATH` as the one process-only Citizen bootstrap variable.

It must be absolute and present before import. A blank value behaves as unset.
It cannot be supplied by `.env` or changed through `citizen.config.js`.

The selected app directory's parent is the project root.
`citizen.directories.app` is always the selected absolute path. Other directory
settings may be absolute or project-root-relative.

## Loading sequence

```text
resolve app and project paths
  -> verify app directory
  -> reject legacy app/config/*.json
  -> load optional project .env through Node
  -> import optional citizen.config.js
  -> merge Citizen defaults into projectConfig.citizen
  -> preserve typed application properties
  -> normalize Citizen directory paths
  -> import app patterns
  -> merge optional app.start() application overrides
  -> start app
```

Keep pure helpers for defaults, project-object resolution, and startup-option
resolution so the boundaries can be tested without process-global leakage.

## Legacy migration guard

If `app/config` contains JSON files, fail startup and direct the user to
`MIGRATION.md`. Match every case-insensitive `.json` filename, including names
with multiple dots, but ignore directories ending in `.json`. Do not parse,
merge, or select legacy files.

The migration preserves the object shape:

```js
// 1.x app/config/citizen.json
{
  "citizen": {
    "forms": { "maxPayloadSize": 1000000 }
  },
  "db": {
    "port": 5432
  }
}
```

```js
// 2.x citizen.config.js
export default {
  citizen: {
    forms: { maxPayloadSize: 1000000 }
  },
  db: {
    port: 5432
  }
}
```

Only secrets and true deployment inputs need to move into `.env`.

## Reuse from the reference branch

Retain:

- automatic project-root `.env` loading through Node;
- project-root config-module loading and validation;
- the legacy JSON guard;
- cwd-based app discovery and `CITIZEN_APP_PATH` bootstrap behavior;
- project-root scaffold behavior and existing-package updates;
- `.env` Git ignore handling;
- application-wide CORS with controller/action extension and route disable;
- exact CORS origin and method comparisons;
- RegExp-safe config copying;
- watcher polling as ordinary typed config;
- Node HTTP/HTTPS options and HTTPS credential guards;
- public export fixes and contract tests;
- package publication allowlist and Node engine update;
- scaffold preservation and package tests;
- error-template backslash fixes;
- unsupported-mode production fallback and warning;
- the permanent ESLint `curly` rule.

Replace:

- flat framework paths with `config.citizen.*`;
- environment-only application configuration with typed top-level properties;
- rejected `app.start()` arguments with application-only overrides;
- migration guidance that moves every application value into `.env`.

Discard:

- generated `CITIZEN_*` maps and reversible path naming;
- generic default-type and HTTP-option env coercers;
- optional/JSON env maps;
- applied/unknown/passthrough env-key logging;
- generated framework `.env.example` catalogs;
- any Citizen-owned dotenv parser or stricter dotenv grammar.

## Scaffold

The scaffold should:

- run from the project root containing the existing `package.json`;
- update that package rather than creating `app/package.json`;
- create a nested `citizen.config.js` with the selected HTTP port as a number;
- create `.env` and `.env.example` containing the selected `NODE_ENV` and room
  for deployment inputs;
- preserve existing `.env`, `.env.example`, `citizen.config.js`, and `web/`;
- fail before mutation when `app/` already exists;
- ensure `.env` is ignored without replacing existing Git ignore rules;
- create no `app/config` directory;
- retain `node app/start.js` as the no-flag startup command.

## Tests

Configuration and runtime:

- defaults with neither optional project file;
- Node `.env` loading and process-environment precedence;
- config-module access to environment values;
- preservation of typed Citizen and application settings;
- invalid module and invalid `citizen` exports;
- mode precedence, warning, and production fallback;
- relative directory resolution and immutable bootstrap app path;
- missing app and legacy JSON failures;
- application-only `app.start()` deep extension and Citizen rejection;
- controller/action extension limited to `params.config.citizen`;
- global CORS merge, override, disable, and exact matching;
- HTTP/HTTPS options reaching Node;
- watcher polling reaching Chokidar;
- public cache, log, session, start, config, and pattern exports.

Scaffold and packaging:

- root env and nested config files are generated;
- existing project files are preserved;
- repeat scaffold fails before package mutation;
- no app package or legacy config directory is created;
- scaffolded app boots with namespaced Citizen and typed app config;
- `npm pack --dry-run` contains public docs/templates and excludes internal files.

## Acceptance criteria

- Citizen delegates dotenv grammar to Node and reads exactly one project file.
- No generic framework env-key generator or coercion system remains.
- `citizen.config.js` retains typed Citizen and application values.
- `app.config.citizen` and `params.config.citizen` remain intuitive and
  collision-free.
- `app.start(options)` extends application config and rejects Citizen config.
- Secrets are not automatically copied into public config.
- Missing optional files load defaults; missing app directories and legacy JSON
  fail clearly.
- Global CORS, Node server options, watcher settings, directories, arrays, and
  regular expressions need no env-specific encoding.
- The scaffold produces one project package, one typed config module, and one
  conventional environment.
- README, migration guide, changelog, TODOs, and tests describe the same model.
- Full tests, ESLint, diff checks, scaffold boot, and package-content checks pass.
