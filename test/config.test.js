import assert              from 'node:assert/strict'
import { spawnSync }       from 'node:child_process'
import fs                  from 'node:fs'
import os                  from 'node:os'
import path                from 'node:path'
import test                from 'node:test'
import { pathToFileURL }   from 'node:url'
import helpers             from '../lib/helpers.js'
import { extendConfig, start } from '../lib/server.js'
import {
  buildEnv,
  getConfig,
  getDefaults,
  getEnvConfig,
  getEnvMap
} from '../init/config.js'


const appPath   = '/project/app',
      configUrl = pathToFileURL(path.resolve('init/config.js')).href,
      indexUrl  = pathToFileURL(path.resolve('index.js')).href


const defaults = () => getDefaults({ appPath: appPath, nodeEnv: 'production' })


const childEnv = (env = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter( item => !item[0].startsWith('CITIZEN_') )),
  ...env
})


const runConfig = (app, env = {}) => {
  const script = `
    import configure from ${JSON.stringify(configUrl)}
    const config = configure({ appPath: ${JSON.stringify(app)} })
    console.log('CITIZEN_RESULT=' + JSON.stringify({ config, appValue: process.env.APP_VALUE }))
  `,
        result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
          encoding: 'utf8',
          env: childEnv(env)
        }),
        output = result.stdout.match(/^CITIZEN_RESULT=(.*)$/m)

  return {
    ...result,
    value: output ? JSON.parse(output[1]) : null
  }
}


const runProject = (root, env = {}) => {
  const script = `
    import configure from ${JSON.stringify(configUrl)}
    const config = configure()
    console.log('CITIZEN_RESULT=' + JSON.stringify({ config }))
  `,
        result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
          cwd: root,
          encoding: 'utf8',
          env: childEnv(env)
        }),
        output = result.stdout.match(/^CITIZEN_RESULT=(.*)$/m)

  return {
    ...result,
    value: output ? JSON.parse(output[1]) : null
  }
}


test('builds a flat default configuration', () => {
  const config = getConfig({ appPath: appPath })

  assert.equal(config.mode, 'production')
  assert.equal(config.http.port, 80)
  assert.equal(config.https.pfx, '')
  assert.equal(Object.hasOwn(config, 'cors'), false)
  assert.equal(config.citizen, undefined)
  assert.deepEqual(config.development.watcher.ignored, /(^|[/\\])\../)
  assert.equal(config.development.watcher.interval, 100)
  assert.equal(Object.hasOwn(config.development.watcher, 'usePolling'), false)
})


test('generates reversible env keys for default and optional settings', () => {
  const map = getEnvMap(defaults())

  assert.equal(map.get('CITIZEN_CACHE__APPLICATION__RESET_ON_ACCESS').path.join('.'), 'cache.application.resetOnAccess')
  assert.equal(map.get('CITIZEN_CACHE__CONTROL').path.join('.'), 'cache.control')
  assert.equal(map.get('CITIZEN_FORMS__MAX_PAYLOAD_SIZE').value, 524288)
  assert.equal(map.get('CITIZEN_DEVELOPMENT__WATCHER__USE_POLLING').path.join('.'), 'development.watcher.usePolling')
  assert.equal(map.has('CITIZEN_FORMS_MAX_PAYLOAD_SIZE'), false)
  assert.equal(new Set(map.keys()).size, map.size)
})


test('coerces every supported default type', () => {
  const result = getEnvConfig({
    CITIZEN_COMPRESSION__FORCE: 'gzip',
    CITIZEN_COMPRESSION__MIME_TYPES: '["text/plain"]',
    CITIZEN_CONNECTION_QUEUE: '100',
    CITIZEN_CONTENT_TYPES: 'text/html, application/json',
    CITIZEN_DEVELOPMENT__WATCHER__IGNORED: '[.]',
    CITIZEN_DEVELOPMENT__WATCHER__INTERVAL: '500',
    CITIZEN_DEVELOPMENT__WATCHER__USE_POLLING: 'true',
    CITIZEN_DIRECTORIES__WEB: '{"assets":true}',
    CITIZEN_HTTP__ENABLED: '0',
    CITIZEN_HTTP__PORT: '3000',
    CITIZEN_LAYOUT__CONTROLLER: '{}',
    CITIZEN_MODE: '[1,2]'
  }, defaults())

  assert.equal(result.config.compression.force, 'gzip')
  assert.deepEqual(result.config.compression.mimeTypes, ['text/plain'])
  assert.equal(result.config.connectionQueue, 100)
  assert.deepEqual(result.config.contentTypes, ['text/html', 'application/json'])
  assert.deepEqual(result.config.development.watcher.ignored, /[.]/)
  assert.equal(result.config.development.watcher.interval, 500)
  assert.equal(result.config.development.watcher.usePolling, true)
  assert.equal(result.config.directories.web, '{"assets":true}')
  assert.equal(result.config.http.enabled, false)
  assert.equal(result.config.http.port, 3000)
  assert.equal(result.config.layout.controller, '{}')
  assert.equal(result.config.mode, '[1,2]')

  assert.equal(getEnvConfig({ CITIZEN_CONNECTION_QUEUE: 'null' }, defaults()).config.connectionQueue, null)
})


test('rejects invalid typed values and identifies their env keys', () => {
  assert.throws(
    () => getEnvConfig({ CITIZEN_HTTP__ENABLED: 'yes' }, defaults()),
    /CITIZEN_HTTP__ENABLED/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_HTTP__PORT: 'eighty' }, defaults()),
    /CITIZEN_HTTP__PORT/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_CONTENT_TYPES: '{"bad":true}' }, defaults()),
    /CITIZEN_CONTENT_TYPES/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_CACHE__CONTROL: 'not-json' }, defaults()),
    /CITIZEN_CACHE__CONTROL/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_CORS: '[]' }, defaults()),
    /CITIZEN_CORS must be a JSON object/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_DEVELOPMENT__WATCHER__USE_POLLING: 'sometimes' }, defaults()),
    /CITIZEN_DEVELOPMENT__WATCHER__USE_POLLING/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_HTTP__PORT: '' }, defaults()),
    /CITIZEN_HTTP__PORT must be a number/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_SESSIONS__LIFESPAN: '  ' }, defaults()),
    /CITIZEN_SESSIONS__LIFESPAN must be a number/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_CONTENT_TYPES: '' }, defaults()),
    /CITIZEN_CONTENT_TYPES must be a JSON array or a comma-separated list/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_DIRECTORIES__LOGS: '' }, defaults()),
    /CITIZEN_DIRECTORIES__LOGS must be a path/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_HTTP__ENABLED: '[]' }, defaults()),
    /CITIZEN_HTTP__ENABLED must be true, false, 1, or 0/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_HTTP__PORT: '{}' }, defaults()),
    /CITIZEN_HTTP__PORT must be a number/
  )
  assert.throws(
    () => getEnvConfig({ CITIZEN_CONNECTION_QUEUE: '[]' }, defaults()),
    /CITIZEN_CONNECTION_QUEUE must be a number or null/
  )
})


test('maps free-form values and Node server options', () => {
  const result = getEnvConfig({
    CITIZEN_CACHE__CONTROL: '{"/":"max-age=86400"}',
    CITIZEN_CORS: '{"Access-Control-Allow-Origin":"https://example.com"}',
    CITIZEN_HTTP: '{"headersTimeout":1000}',
    CITIZEN_HTTP__KEEP_ALIVE_TIMEOUT: '5000',
    CITIZEN_HTTP__NESTED__OPTION: 'unsupported',
    CITIZEN_HTTP__PROT: '3001',
    CITIZEN_HTTPS__MAX_HEADER_SIZE: '16384',
    CITIZEN_HTTPS__PFX: '/run/secrets/site.pfx',
    CITIZEN_NOT_A_SETTING: 'ignored'
  }, defaults())

  assert.equal(result.config.cache.control['/'], 'max-age=86400')
  assert.equal(result.config.cors['Access-Control-Allow-Origin'], 'https://example.com')
  assert.equal(result.config.http.headersTimeout, 1000)
  assert.equal(result.config.http.keepAliveTimeout, 5000)
  assert.equal(result.config.http.prot, 3001)
  assert.equal(result.config.https.maxHeaderSize, 16384)
  assert.equal(result.config.https.pfx, '/run/secrets/site.pfx')
  assert.deepEqual(result.passthrough, [
    'CITIZEN_HTTPS__MAX_HEADER_SIZE',
    'CITIZEN_HTTP__KEEP_ALIVE_TIMEOUT',
    'CITIZEN_HTTP__PROT'
  ])
  assert.deepEqual(result.unknown, ['CITIZEN_HTTP__NESTED__OPTION', 'CITIZEN_NOT_A_SETTING'])
})


test('uses NODE_ENV as the mode default and lets CITIZEN_MODE override it', () => {
  assert.equal(getConfig({ appPath: appPath, env: { NODE_ENV: 'development' } }).mode, 'development')
  assert.equal(getConfig({ appPath: appPath, env: { CITIZEN_MODE: 'test', NODE_ENV: 'production' } }).mode, 'test')
})


test('resolves directory overrides against the selected project root', () => {
  const config = getConfig({
    appPath: appPath,
    env: {
      CITIZEN_DIRECTORIES__APP: './wrong-app',
      CITIZEN_DIRECTORIES__CONTROLLERS: 'app/custom-controllers',
      CITIZEN_DIRECTORIES__LOGS: 'var/log',
      CITIZEN_DIRECTORIES__WEB: '{"assets":true}'
    }
  })

  assert.equal(config.directories.app, appPath)
  assert.equal(config.directories.controllers, '/project/app/custom-controllers')
  assert.equal(config.directories.logs, '/project/var/log')
  assert.equal(config.directories.web, '/project/{"assets":true}')
})


test('loads only the project-root .env and exposes application variables through process.env', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-app-env-')),
        app = path.join(root, 'app')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(app)
  fs.writeFileSync(path.join(app, '.env'), 'CITIZEN_HTTP__PORT=2000\n')

  let result = runConfig(app)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.config.http.port, 80)

  fs.writeFileSync(path.join(root, '.env'), 'CITIZEN_HTTP__PORT=3000\nAPP_VALUE=from-file\n')
  result = runConfig(app)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.config.http.port, 3000)
  assert.equal(result.value.config.APP_VALUE, undefined)
  assert.equal(result.value.appValue, 'from-file')
})


test('keeps process values above project-root .env values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-process-env-')),
        app = path.join(root, 'app')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(app)
  fs.writeFileSync(path.join(root, '.env'), 'CITIZEN_HTTP__PORT=3000\nAPP_VALUE=from-file\n')

  const result = runConfig(app, {
    APP_VALUE: 'from-process',
    CITIZEN_HTTP__PORT: '4000'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.config.http.port, 4000)
  assert.equal(result.value.appValue, 'from-process')
})


test('does not let .env relocate its own app directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-app-path-')),
        app = path.join(root, 'app')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(app)
  fs.writeFileSync(path.join(root, '.env'), 'CITIZEN_DIRECTORIES__APP=/another/app\n')

  const result = runConfig(app)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.config.directories.app, app)
})


test('normalizes a relative process app path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-relative-app-')),
        app = path.join(root, 'app')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(app)

  const result = runProject(root, { CITIZEN_DIRECTORIES__APP: './app' }),
        realApp = fs.realpathSync(app),
        realRoot = fs.realpathSync(root)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.config.directories.app, realApp)
  assert.equal(result.value.config.directories.controllers, path.join(realApp, 'controllers'))
  assert.equal(result.value.config.directories.logs, path.join(realRoot, 'logs'))
})


test('fails when the selected app directory does not exist', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-missing-app-'))

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const result = runProject(root)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Application directory not found:/)
  assert.match(result.stderr, /Run citizen from the project root/)
})


test('loads project env with Node dotenv syntax', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-env-syntax-')),
        app = path.join(root, 'app')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(app)
  fs.writeFileSync(path.join(root, '.env'), [
    'export CITIZEN_HTTP__PORT = 3000 # development port',
    'CITIZEN_CORS=\'{"Access-Control-Allow-Origin":"https://example.com"}\'',
    'CITIZEN_HTTPS__CERT="line 1',
    'line 2"'
  ].join('\n'))

  const result = runConfig(app)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.config.http.port, 3000)
  assert.equal(result.value.config.cors['Access-Control-Allow-Origin'], 'https://example.com')
  assert.equal(result.value.config.https.cert, 'line 1\nline 2')
})


test('rejects legacy JSON config without parsing it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-legacy-config-')),
        app = path.join(root, 'app'),
        config = path.join(app, 'config')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(config, { recursive: true })
  fs.writeFileSync(path.join(config, 'citizen.json'), '{ definitely not JSON')

  const result = runConfig(app)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /JSON configuration files are no longer supported/)
  assert.doesNotMatch(result.stderr, /Unexpected token/)
})


test('renders a complete scaffold env reference with selected active values', () => {
  const example = buildEnv(defaults(), {
    CITIZEN_HTTP__PORT: 3000,
    CITIZEN_MODE: 'development'
  })

  assert.match(example, /^CITIZEN_MODE=development$/m)
  assert.match(example, /^CITIZEN_HTTP__PORT=3000$/m)
  assert.match(example, /^# CITIZEN_FORMS__MAX_PAYLOAD_SIZE=524288$/m)
  assert.match(example, /^# CITIZEN_HTTPS__PFX=""$/m)
  assert.match(example, /^# CITIZEN_CORS=/m)
  assert.match(example, /^# Valid values: true, false, gzip, deflate$/m)
  assert.match(example, /^# CITIZEN_DIRECTORIES__CONTROLLERS=app\/controllers$/m)
  assert.match(example, /^# CITIZEN_DIRECTORIES__LOGS=logs$/m)
  assert.match(example, /^# Application configuration:$/m)
  assert.doesNotMatch(example, /CITIZEN_DIRECTORIES__APP=/)
  assert.doesNotMatch(example, /\/project\//)
})


test('scaffolds project-root env files and ignores the private file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-scaffold-')),
        modules = path.join(root, 'node_modules'),
        citizen = path.resolve('.'),
        scaffold = path.join(modules, 'citizen/util/scaffold.js')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(modules)
  fs.symlinkSync(citizen, path.join(modules, 'citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: {
      citizen: '^2.0.0'
    },
    name: 'citizen-scaffold-test'
  }, null, 2) + '\n')

  let result = spawnSync(process.execPath, [
          scaffold,
          'skeleton',
          '--mode',
          'production',
          '--network-port',
          '3100'
        ], {
          cwd: root,
          encoding: 'utf8'
        })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '.env\n')
  assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /^CITIZEN_HTTP__PORT=3100$/m)
  assert.match(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), /^# CITIZEN_FORMS__MAX_PAYLOAD_SIZE=524288$/m)
  assert.equal(fs.existsSync(path.join(root, 'app/config')), false)
  assert.equal(fs.existsSync(path.join(root, 'app/package.json')), false)

  const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  assert.equal(packageJSON.dependencies.citizen, '^2.0.0')
  assert.equal(packageJSON.engines.node, '>=22.0.0')
  assert.equal(packageJSON.name, 'citizen-scaffold-test')
  assert.equal(packageJSON.type, 'module')

  let childEnv = Object.fromEntries(Object.entries(process.env).filter( item => !item[0].startsWith('CITIZEN_') ))

  childEnv.CITIZEN_HTTP__ENABLED = 'false'
  childEnv.CITIZEN_LOGS__MAX_FILE_SIZE = '0'
  result = spawnSync(process.execPath, [path.join(root, 'app/start.js')], {
    cwd: root,
    encoding: 'utf8',
    env: childEnv
  })

  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes('Loaded project environment: ' + path.join(fs.realpathSync(root), '.env')), result.stdout)
})


test('adds the private env file to an existing scaffold gitignore', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-scaffold-ignore-')),
        modules = path.join(root, 'node_modules'),
        scaffold = path.join(modules, 'citizen/util/scaffold.js')

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(modules)
  fs.symlinkSync(path.resolve('.'), path.join(modules, 'citizen'), 'dir')
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nlogs/')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"citizen-scaffold-ignore"}\n')

  const result = spawnSync(process.execPath, [scaffold, 'skeleton'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules/\nlogs/\n.env\n')
})


test('merges controller and action config directly into params.config', () => {
  global.CTZN = {
    controllers: {
      routes: {
        private: {
          config: {
            controller: { cors: false }
          }
        },
        submit: {
          config: {
            controller: {
              cors: { 'Access-Control-Allow-Methods': 'OPTIONS, POST' },
              forms: { enabled: false }
            },
            save: {
              cors: { 'Access-Control-Allow-Headers': 'Content-Type' },
              forms: { maxPayloadSize: 1000000 }
            }
          }
        }
      }
    }
  }

  const config = getConfig({
          appPath: appPath,
          env: {
            CITIZEN_CORS: JSON.stringify({
              'Access-Control-Allow-Methods': 'OPTIONS, GET',
              'Access-Control-Allow-Origin': 'https://example.com'
            })
          }
        }),
        params = { config: config },
        privateParams = { config: config }

  extendConfig(params, 'submit', 'save')
  extendConfig(privateParams, 'private', 'handler')

  assert.equal(params.config.cors['Access-Control-Allow-Headers'], 'Content-Type')
  assert.equal(params.config.cors['Access-Control-Allow-Methods'], 'OPTIONS, POST')
  assert.equal(params.config.cors['Access-Control-Allow-Origin'], 'https://example.com')
  assert.equal(params.config.forms.enabled, false)
  assert.equal(params.config.forms.maxPayloadSize, 1000000)
  assert.equal(params.config.citizen, undefined)
  assert.equal(privateParams.config.cors, false)
})


test('app.start rejects supplied configuration', () => {
  assert.throws(
    () => start({ forms: { enabled: false } }),
    /app\.start\(\) no longer accepts configuration/
  )
})


test('imports the public module with usable flat config and app collections', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-index-')),
        app = path.join(root, 'app'),
        directories = [
          'controllers/hooks',
          'controllers/routes',
          'helpers',
          'models',
          'views'
        ]

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  directories.forEach( directory => fs.mkdirSync(path.join(app, directory), { recursive: true }) )
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n')
  fs.writeFileSync(path.join(root, '.env'), [
    'CITIZEN_HTTP__ENABLED=false',
    'CITIZEN_HTTP__PORT=3456',
    'CITIZEN_LOGS__MAX_FILE_SIZE=0'
  ].join('\n'))
  fs.writeFileSync(path.join(app, 'controllers/routes/index.js'), 'export const index = () => ({})\n')

  let childEnv = Object.fromEntries(Object.entries(process.env).filter( item => !item[0].startsWith('CITIZEN_') ))

  childEnv.CITIZEN_DIRECTORIES__APP = app

  const script = `
          const citizen = await import(${JSON.stringify(indexUrl)})
          citizen.default.start()
          await new Promise(resolve => setImmediate(resolve))
          console.log('CITIZEN_RESULT=' + JSON.stringify({
            config: citizen.config,
            controllers: Object.keys(citizen.controllers),
            helpers: citizen.helpers,
            models: citizen.models,
            views: citizen.views
          }))
        `,
        result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
          encoding: 'utf8',
          env: childEnv
        }),
        output = result.stdout.match(/^CITIZEN_RESULT=(.*)$/m)

  assert.equal(result.status, 0, result.stderr)
  assert.ok(output, result.stdout)

  const citizen = JSON.parse(output[1])

  assert.equal(citizen.config.http.port, 3456)
  assert.equal(citizen.config.citizen, undefined)
  assert.deepEqual(citizen.controllers, ['hooks', 'routes'])
  assert.deepEqual(citizen.helpers, {})
  assert.deepEqual(citizen.models, {})
  assert.deepEqual(citizen.views, {})
})


test('helpers.copy preserves regular expressions through config merges', () => {
  const source = { watcher: { ignored: /dotfiles/ } },
        merged = helpers.extend({}, source)

  assert.ok(merged.watcher.ignored instanceof RegExp)
  assert.equal(merged.watcher.ignored.source, 'dotfiles')
})
