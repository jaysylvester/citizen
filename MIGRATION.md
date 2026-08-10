# Migrating Citizen 1.x applications to 2.x

Citizen 2.x replaces host-selected JSON files with a project-root JavaScript
configuration module and an optional project environment. The established
`citizen` namespace remains intact, and typed application configuration can
remain alongside it.

| 1.x | 2.x |
| --- | --- |
| Node.js 16 or newer | Node.js 22 or newer |
| `app/config/*.json` | Project-root `citizen.config.js` |
| Hostname-selected config files | One config module per project/deployment |
| Secrets mixed into JSON config | Project `.env`, process environment, or secret files |
| `app.config.citizen.forms` | `app.config.citizen.forms` |
| Typed application config such as `app.config.db` | Typed application config such as `app.config.db` |
| Citizen settings passed to `app.start()` | `citizen` in `citizen.config.js` |
| Application settings passed to `app.start()` | Still supported as optional application overrides |

Controller and action configuration remains a typed object and continues to
override Citizen settings for an individual request.

## 1. Prepare the project

Create a migration branch and verify that the application runs on its current
Citizen version. Preserve every legacy config file until the migrated
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

Citizen loads `.env` before importing `citizen.config.js`, so the module may
read deployment values. Environment values remain strings; convert and validate
only values that genuinely cross that boundary. Stable numbers, booleans,
arrays, and objects should remain typed values in the module.

The legacy `host` selector has no replacement. Select the applicable settings
for the deployment or use explicit environment inputs where a value truly
varies.

## 3. Review `app.start()` options

Citizen settings must be available before controllers, models, views, and
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

Do not flatten Citizen paths. Application properties remain at the top level,
so an application-owned `forms` object cannot collide with
`app.config.citizen.forms`.

Controller and action config remains relative to the Citizen namespace:

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

Run from the project root so Citizen finds `<cwd>/app`, `.env`, and
`citizen.config.js`. A process that must start elsewhere can set
`CITIZEN_APP_PATH` to an absolute app path before importing Citizen. This
bootstrap value cannot be placed in `.env` or changed by the config module.

Add `.env` to `.gitignore` and commit a safe `.env.example`. After every old
value has been classified, archive or remove `app/config/*.json`. Citizen
deliberately refuses to start while JSON config files remain so an incomplete
migration cannot silently use defaults.

Classify each old value as one of:

- a Citizen setting under `citizen` in `citizen.config.js`;
- a typed, non-secret application setting in `citizen.config.js`;
- a deployment input or secret in the environment;
- a controller/action override;
- obsolete and intentionally removed.

## 7. Verify

Confirm that no active JSON configuration or startup Citizen settings remain:

```bash
find app/config -type f -name '*.json' -print
rg -n -U "app\.start\([\s\S]*?citizen" app
```

Then verify that:

1. `.env` is ignored and `.env.example` contains no secrets.
2. The app starts with and without a local `.env` as appropriate.
3. Deployment environment values remain authoritative over `.env`.
4. Typed Citizen and application settings appear under the expected `app.config` paths.
5. `app.start()` application overrides merge without changing `app.config.citizen`.
6. Controller/action overrides, CORS, HTTP/HTTPS, sessions, caching, logs, and watchers behave as expected.
7. The normal test suite and representative endpoint smoke tests pass under Node.js 22.

Cases requiring manual review include multiple host configs, computed startup
values, config aliases, dynamic property access, and secret-bearing tracked
files.
