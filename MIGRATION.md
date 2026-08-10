# Migrating Citizen 1.x applications to 2.x

Citizen 2.x replaces host-selected JSON and startup-object configuration with a project environment and a typed Citizen config module.

| 1.x | 2.x |
| --- | --- |
| Node.js 16 or newer | Node.js 22 or newer |
| `app/config/*.json` | Project-root `.env` and `citizen.config.js` |
| Framework settings under `citizen` | Direct properties in `citizen.config.js` |
| Application settings in JSON or `app.start()` | `.env` or the deployment environment |
| `app.config.citizen.forms` | `app.config.forms` |
| `params.config.citizen.forms` | `params.config.forms` |
| `app.start(options)` | `app.start()` |

Controller and action configuration remains a typed object and continues to override project framework settings for a request.

## 1. Prepare the project

Create a migration branch and verify that the application runs on its current Citizen version. Preserve every legacy config file until the migrated application has been tested.

Update the application runtime declaration and dependency:

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

Inventory config sources and consumers:

```bash
find app/config -type f -name '*.json' -print
rg -n "app\.start\(|config\.citizen|app\.config|params\.config" app
```

Search for aliases, destructuring, computed properties, templates, and deployment scripts as well; simple member-expression searches will not find every use.

## 2. Split framework and application settings

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
    "password": "secret",
    "server": "localhost"
  }
}
```

move the `citizen` object, without its wrapper, into a project-root module:

```js
// citizen.config.js
export default {
  forms: {
    maxPayloadSize: 1048576
  },
  http: {
    port: 8080
  },
  mode: 'development'
}
```

Move application-owned values to the project environment:

```bash
# .env
DB_PASSWORD=secret
DB_SERVER=localhost
```

Application code reads and validates those values explicitly:

```js
const connection = connect({
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER
})
```

Citizen does not copy application variables into `app.config` and does not coerce their string values. Keep secrets out of `citizen.config.js`, `.env.example`, logs, and version control.

The legacy `host` selector has no replacement. Select the applicable source for each deployment, commit stable framework behavior to `citizen.config.js`, and provide deployment-specific application values through its environment. If a framework setting must vary, read and convert that one value explicitly in the config module:

```js
export default {
  http: {
    port: Number(process.env.PORT || 3000)
  }
}
```

## 3. Simplify startup

Remove every configuration argument:

```js
// 1.x
app.start({
  citizen: {
    http: { port: 8080 }
  }
})

// 2.x
app.start()
```

Citizen 2.x rejects any supplied argument, including `undefined` or an object containing only application settings.

Run from the project root so Citizen finds `<cwd>/app`, `.env`, and `citizen.config.js`. A process that must start elsewhere can set `CITIZEN_APP_PATH` to an absolute path before importing Citizen. This bootstrap variable cannot be placed in `.env`.

## 4. Flatten framework config references

Update framework reads throughout JavaScript, hooks, helpers, models, controllers, and views:

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

Do not mechanically flatten application-owned paths such as `app.config.db`. Replace them with explicit environment reads or an application module that groups and validates those values.

## 5. Review controller config and CORS

Move a legacy global `citizen.cors` object to the root config module. Controller and action policies now extend that baseline:

```js
// citizen.config.js
export default {
  cors: {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': 'https://example.com'
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

Retest every preflight and credentialed request after consolidating repeated controller policies.

## 6. Remove legacy files safely

Add `.env` to `.gitignore` and commit a safe `.env.example`. After every old value has been classified, archive or remove `app/config/*.json`. Citizen deliberately refuses to start while JSON config files remain so an incomplete migration cannot silently use defaults.

Each old value should be classified as one of:

- a framework setting in `citizen.config.js`;
- an application-owned environment value;
- a controller/action override;
- obsolete and intentionally removed.

## 7. Verify

These searches should return no active 1.x config paths:

```bash
rg -n -U "app\.start\(\s*[^)]" app
rg -n "((app|params)\.config|config)\.citizen" app
find app/config -type f -name '*.json' -print
```

Then verify that:

1. `.env` is ignored and `.env.example` contains no secret values.
2. The app starts with and without a local `.env` as appropriate.
3. Deployment environment values remain authoritative over `.env`.
4. `citizen.config.js` types and relative directory paths resolve as expected.
5. Controller/action overrides, CORS, HTTP/HTTPS, sessions, caching, logs, and watcher behavior still work.
6. The normal test suite and representative endpoint smoke tests pass under Node.js 22.

Cases requiring manual review include multiple host configs, arbitrary application nodes, computed startup values, config aliases, dynamic property access, and secret-bearing tracked files.
