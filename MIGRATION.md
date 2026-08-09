# Migrating citizen 1.x applications to 2.x

Status: **Draft.** This guide covers the 2.0 configuration changes currently
implemented. Add other breaking changes here as they land rather than relying
on the historical changelog as a migration checklist.

## Summary

citizen 2.x replaces JSON and startup-object configuration with one conventional
application environment. Framework configuration is exposed directly beneath
`app.config`, while application-owned values remain in `process.env`.

| 1.x | 2.x |
| --- | --- |
| Node.js 16 or newer | Node.js 22 or newer |
| `app/config/*.json` | Project-root `.env` or deployment environment variables |
| Framework settings beneath `citizen` | `CITIZEN_*` environment variables |
| Application settings in JSON or `app.start()` | Application variables in `.env` or the deployment environment |
| `app.config.citizen.forms` | `app.config.forms` |
| `params.config.citizen.forms` | `params.config.forms` |
| `app.start(options)` | `app.start()` |

Route controller and action configuration remains an object because it is a
per-request runtime override, not deployment configuration.

## 1. Prepare the application

Create a migration branch and make sure the application runs under its current
citizen 1.x version before changing it. Preserve a copy of every JSON config and
the existing start file until the migrated application has been verified.

Upgrade the application runtime declaration:

```json
{
  "engines": {
    "node": ">=22.0.0"
  }
}
```

When citizen 2.x is published, update the application dependency and lockfile
with the project's package manager, for example:

```bash
npm install citizen@2
```

Inventory the old configuration and its consumers:

```bash
rg -n "app\.start\(|config\.citizen|app\.config|params\.config" app
find app/config -type f -name '*.json' -print
```

Also search for aliases, destructuring, computed properties, or helpers that
receive config indirectly. Simple text searches will not find every use.

## 2. Convert framework configuration

Given this 1.x config:

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
    },
    "contentTypes": [
      "text/html",
      "application/json"
    ],
    "cors": {
      "Access-Control-Allow-Origin": "https://example.com",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    },
    "cache": {
      "control": {
        "/assets/*": "max-age=86400"
      }
    }
  },
  "db": {
    "server": "localhost"
  }
}
```

Create `.env` in the project root:

```bash
CITIZEN_MODE=development
CITIZEN_HTTP__PORT=8080
CITIZEN_FORMS__MAX_PAYLOAD_SIZE=1048576
CITIZEN_CONTENT_TYPES=text/html,application/json
CITIZEN_CACHE__CONTROL='{ "/assets/*": "max-age=86400" }'
CITIZEN_CORS='{ "Access-Control-Allow-Origin": "https://example.com", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }'

DB_SERVER=localhost
```

The `host` selector has no replacement. Use the deployment environment to
supply values that differ between hosts. If the application has multiple
host-selected JSON files, migrate each deployment independently; do not combine
their secrets into a committed file.

Framework names map directly to runtime paths:

```text
CITIZEN_FORMS__MAX_PAYLOAD_SIZE
app.config.forms.maxPayloadSize
```

After `CITIZEN_`, double underscores separate object properties and single
underscores separate words within a camel-cased property. Arrays accept either
a comma-delimited list or JSON:

```bash
CITIZEN_CONTENT_TYPES=text/html,application/json
# or
CITIZEN_CONTENT_TYPES='["text/html","application/json"]'
```

Free-form objects use JSON:

```bash
CITIZEN_CACHE__CONTROL='{ "/": "max-age=60" }'
CITIZEN_HTTP='{ "keepAliveTimeout": 5000 }'
```

Individual Node server options can also use the normal mapping convention:

```bash
CITIZEN_HTTP__KEEP_ALIVE_TIMEOUT=5000
```

`CITIZEN_DIRECTORIES__APP` is process-only because citizen needs it before it
can locate the project-root `.env`. Set it in the shell or deployment
environment, not inside the file. Other directory settings can use absolute
paths or paths relative to the project root; citizen exposes them as absolute
paths in `app.config.directories`.

Numeric and array settings cannot be blank. Use `[]` when an empty array is
intentional.

Configuration precedence, from lowest to highest, is:

1. citizen defaults
2. Project-root `.env`
3. Values already present in `process.env`
4. Route controller and action configuration

## 3. Convert application configuration

citizen no longer copies application-owned variables into `app.config`.
Choose explicit env names and read them from `process.env`:

```js
// 1.x
const connection = connect({
  server: app.config.db.server,
  port: app.config.db.port
})

// 2.x
const connection = connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT)
})
```

citizen validates and coerces its own `CITIZEN_*` values only. Application code
is responsible for validating required values and coercing strings into
numbers, booleans, arrays, or objects.

Do not commit secrets to `.env` or `.env.example`. Put placeholders in
the example and supply real secrets locally or through the deployment platform.
Do not log `process.env`.

## 4. Simplify startup

Remove the configuration argument from the start file:

```js
// 1.x
app.start({
  citizen: {
    http: {
      port: 8080
    }
  },
  db: {
    server: process.env.DB_SERVER
  }
})

// 2.x
app.start()
```

citizen 2.x rejects every supplied argument, including an object containing
only application settings.

## 5. Flatten framework config references

Update framework reads throughout JavaScript, hooks, helpers, models, route
controllers, and views:

```js
// 1.x
app.config.citizen.forms.maxPayloadSize
params.config.citizen.forms.enabled
config.citizen.mode

// 2.x
app.config.forms.maxPayloadSize
params.config.forms.enabled
config.mode
```

Do not mechanically rewrite an application-owned path such as `app.config.db`.
It must become an explicit `process.env` read or an application module that
validates and groups environment values.

## 6. Review controller configuration and CORS

Use `CITIZEN_CORS` as the application-wide baseline when a 1.x configuration
contains `citizen.cors`. Controller configuration can extend or override the
global headers without repeating them:

```js
export const config = {
  controller: {
    contentTypes: ['application/json']
  },
  submit: {
    forms: {
      maxPayloadSize: 1000000
    },
    cors: {
      'Access-Control-Allow-Methods': 'OPTIONS, POST'
    }
  }
}
```

Set `cors: false` in controller or action configuration for routes that must not
inherit the global policy. Applications without a global policy can continue to
configure CORS exclusively at the controller or action level.

## 7. Remove the legacy files safely

Add the private env file to the project `.gitignore`:

```gitignore
.env
```

Commit `.env.example`, then archive or remove `app/config/*.json`. citizen
2.x deliberately refuses to start while those files remain, preventing an
application from silently booting with defaults after an incomplete migration.

Do not delete the old files until every value has been classified as one of:

- a `CITIZEN_*` framework setting;
- an application-owned environment variable;
- a controller/action override;
- obsolete and intentionally removed.

## 8. Verify the migration

The following searches should return no active 1.x configuration paths:

```bash
rg -n -U "app\.start\(\s*[^)]" app
rg -n "((app|params)\.config|config)\.citizen" app
find app/config -type f -name '*.json' -print
```

Then verify:

1. `.env` is ignored and `.env.example` is committed.
2. The application starts with no local env file using safe defaults.
3. The application starts with its development env.
4. Deployment values override matching values from `.env`.
5. Each route still receives its controller/action config.
6. CORS preflight requests work for every intended action.
7. HTTPS reads the configured PFX or key/cert files.
8. Logs and debug output contain no application secrets.
9. The application's normal test suite and representative endpoint smoke tests
   pass under Node.js 22.

## Changes that require manual review

These should not be rewritten without understanding the application:

- multiple host-selected JSON configs;
- arbitrary application config names and types;
- secrets committed in old config or startup files;
- computed values or function calls inside `app.start()`;
- route-specific CORS policies that cannot inherit the global baseline;
- config passed through aliases, destructuring, computed properties, or helper
  functions;
- deployment scripts that copy or select JSON config files.

See [the migration automation plan](docs/plans/migration-1-to-2.md) for the proposed
agent and codemod workflow.
