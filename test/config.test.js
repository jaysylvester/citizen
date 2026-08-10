import assert                    from 'node:assert/strict'
import { spawn, spawnSync }      from 'node:child_process'
import { once }                  from 'node:events'
import fs                        from 'node:fs'
import http                      from 'node:http'
import net                       from 'node:net'
import os                        from 'node:os'
import path                      from 'node:path'
import test                      from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import helpers                   from '../lib/helpers.js'
import { getDefaults, resolve }  from '../init/config.js'
import { extendAppConfig, extendConfig } from '../lib/server.js'


const projectPath = path.resolve(fileURLToPath(new URL('..', import.meta.url))),
      configPath  = pathToFileURL(path.join(projectPath, 'init/config.js')).href,
      scaffoldPath = path.join(projectPath, 'util/scaffold.js')


function project() {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-config-'))

  fs.mkdirSync(path.join(root, 'app'))
  return fs.realpathSync(root)
}


function configure(root, options = {}) {
  let script = `
    const configure = (await import(${JSON.stringify(configPath)})).default
    const config = await configure()
    console.log('CONFIG_RESULT=' + JSON.stringify({
      config,
      env: process.env.APP_VALUE,
      expression: config.citizen.development?.watcher?.ignored?.source
    }))
  `,
      env = { ...process.env, ...options.env }

  delete env.APP_VALUE
  delete env.CITIZEN_APP_PATH
  delete env.NODE_ENV
  Object.assign(env, options.env)

  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: root,
    encoding: 'utf8',
    env: env
  })
}


function result(child) {
  let line = child.stdout.split(/\r?\n/).find( line => line.startsWith('CONFIG_RESULT=') )

  return line ? JSON.parse(line.slice('CONFIG_RESULT='.length)) : null
}


async function getPort() {
  let server = net.createServer()

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let port = server.address().port

  server.close()
  await once(server, 'close')
  return port
}


function request(port, pathname, origin, headers = {}) {
  return new Promise( (resolve, reject) => {
    let call = http.request({
      headers: {
        accept: 'text/html',
        ...( origin ? { origin: origin } : {} ),
        ...headers
      },
      hostname: '127.0.0.1',
      path: pathname,
      port: port
    }, response => {
      response.resume()
      response.on('end', () => resolve({ headers: response.headers, status: response.statusCode }))
    })

    call.on('error', reject)
    call.end()
  })
}


function waitFor(child, expected) {
  return new Promise( (resolve, reject) => {
    let output = '',
        timer = setTimeout(() => reject(new Error('Timed out waiting for output: ' + expected + '\n' + output)), 3000)

    child.stdout.on('data', chunk => {
      output += chunk
      if ( output.includes(expected) ) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error('Scaffolded server exited with code ' + code + '.\n' + output))
    })
  })
}


test('defaults use the conventional project layout', () => {
  let root = project(),
      defaults = getDefaults({ appPath: path.join(root, 'app') })

  assert.equal(defaults.citizen.mode, 'production')
  assert.equal(defaults.citizen.http.port, 80)
  assert.equal(defaults.citizen.development.watcher.interval, 100)
  assert.equal(defaults.citizen.directories.app, path.join(root, 'app'))
  assert.equal(defaults.citizen.directories.web, path.join(root, 'web'))
})


test('project config preserves typed values and does not mutate defaults', () => {
  let root = project(),
      app = path.join(root, 'app'),
      defaults = getDefaults({ appPath: app }),
      expression = /node_modules|cache/i,
      config = resolve({
        citizen: {
          connectionQueue: null,
          contentTypes: ['application/json'],
          development: {
            watcher: {
              ignored: expression,
              usePolling: true
            }
          },
          http: {
            enabled: false,
            headers: { nested: true },
            port: 3000
          }
        },
        db: {
          max: 10,
          port: 5432
        }
      }, { appPath: app })

  assert.equal(config.citizen.connectionQueue, null)
  assert.deepEqual(config.citizen.contentTypes, ['application/json'])
  assert.equal(config.citizen.development.watcher.ignored, expression)
  assert.equal(config.citizen.development.watcher.usePolling, true)
  assert.deepEqual(config.citizen.http.headers, { nested: true })
  assert.equal(config.citizen.http.port, 3000)
  assert.deepEqual(config.db, { max: 10, port: 5432 })
  assert.equal(defaults.citizen.http.enabled, true)
  assert.equal(defaults.citizen.development.watcher.usePolling, undefined)
})


test('unsupported resolved modes fall back to production', () => {
  let root = project(),
      config = resolve({ citizen: { mode: 'test' } }, { appPath: path.join(root, 'app') })

  assert.equal(config.citizen.mode, 'production')
})


test('relative directories resolve from the project root and app cannot be relocated', () => {
  let root = project(),
      app = path.join(root, 'app'),
      config = resolve({
        citizen: {
          directories: {
            app: '../wrong',
            logs: 'var/log',
            web: '/srv/web'
          }
        }
      }, { appPath: app })

  assert.equal(config.citizen.directories.app, app)
  assert.equal(config.citizen.directories.logs, path.join(root, 'var/log'))
  assert.equal(config.citizen.directories.web, '/srv/web')
})


test('missing optional project files load defaults', () => {
  let root = project(),
      child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.mode, 'production')
  assert.match(child.stdout, /No project \.env loaded/)
  assert.match(child.stdout, /No citizen\.config\.js found/)
})


test('project .env loads values without automatically copying them into config', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'NODE_ENV=development\nAPP_VALUE=from-file\n')
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.mode, 'development')
  assert.equal(output.env, 'from-file')
  assert.equal(output.config.APP_VALUE, undefined)
})


test('unsupported NODE_ENV warns and falls back to production', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'NODE_ENV=test\n')
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.mode, 'production')
  assert.match(child.stderr, /Unsupported citizen mode "test"; using production/)
})


test('project mode overrides an unsupported NODE_ENV without warning', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'NODE_ENV=test\n')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default { citizen: { mode: "development" } }\n')
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.mode, 'development')
  assert.doesNotMatch(child.stderr, /Unsupported citizen mode/)
})


test('process values remain authoritative over .env', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'APP_VALUE=from-file\n')
  let child = configure(root, { env: { APP_VALUE: 'from-process' } }),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.env, 'from-process')
})


test('citizen.config.js can read values loaded from .env', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'PORT=4321\n')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      citizen: {
        development: { watcher: { ignored: /generated/ } },
        http: { port: Number(process.env.PORT) }
      },
      db: { port: 5432 }
    }
  `)
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.http.port, 4321)
  assert.equal(output.config.db.port, 5432)
  assert.equal(output.expression, 'generated')
})


for ( const [name, source] of [
  ['a missing default export', 'export const config = {}'],
  ['null', 'export default null'],
  ['an array', 'export default []'],
  ['a function', 'export default () => ({})'],
  ['a promise', 'export default Promise.resolve({})'],
  ['a primitive', 'export default "invalid"']
] ) {
  test('config module rejects ' + name, () => {
    let root = project()

    fs.writeFileSync(path.join(root, 'citizen.config.js'), source)
    let child = configure(root)

    assert.notEqual(child.status, 0)
    assert.match(child.stderr, /citizen\.config\.js must default-export a plain object/)
  })
}


for ( const [name, source] of [
  ['null', 'export default { citizen: null }'],
  ['an array', 'export default { citizen: [] }'],
  ['a primitive', 'export default { citizen: "invalid" }']
] ) {
  test('config module rejects ' + name + ' citizen config', () => {
    let root = project()

    fs.writeFileSync(path.join(root, 'citizen.config.js'), source)
    let child = configure(root)

    assert.notEqual(child.status, 0)
    assert.match(child.stderr, /citizen configuration must be a plain object/)
  })
}


test('config module syntax and evaluation errors propagate', () => {
  let root = project()

  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'throw new Error("module failed")\nexport default {}')
  let child = configure(root)

  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /module failed/)
})


test('.env and citizen.config.js cannot relocate the bootstrap app directory', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'CITIZEN_APP_PATH=/wrong/from-env\n')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default { citizen: { directories: { app: "/wrong/from-config" } } }')
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.directories.app, path.join(root, 'app'))
  assert.match(child.stderr, /Ignored CITIZEN_APP_PATH from \.env/)
})


test('the process-only app directory selects another project', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-bootstrap-')),
      selected = path.join(root, 'selected'),
      app = path.join(selected, 'app')

  fs.mkdirSync(app, { recursive: true })
  fs.writeFileSync(path.join(selected, 'citizen.config.js'), 'export default { citizen: { http: { port: 4567 } } }')
  let child = configure(root, { env: { CITIZEN_APP_PATH: app } }),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.http.port, 4567)
  assert.equal(output.config.citizen.directories.app, app)
})


test('a blank process app path uses the conventional app directory', () => {
  let root = project(),
      child = configure(root, { env: { CITIZEN_APP_PATH: '' } }),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.citizen.directories.app, path.join(root, 'app'))
})


test('a missing selected app directory fails clearly', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-missing-')),
      child = configure(root)

  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /Application directory not found/)
})


test('legacy JSON fails without being parsed', () => {
  let root = project()

  fs.mkdirSync(path.join(root, 'app/config'))
  fs.writeFileSync(path.join(root, 'app/config/citizen.json'), '{not valid JSON')
  let child = configure(root)

  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /JSON configuration files are no longer supported/)
  assert.doesNotMatch(child.stderr, /Unexpected token/)
})


test('legacy JSON guard catches multi-dot and case-insensitive filenames but not directories', () => {
  let root = project()

  fs.mkdirSync(path.join(root, 'app/config'))
  fs.mkdirSync(path.join(root, 'app/config/archive.json'))
  fs.writeFileSync(path.join(root, 'app/config/web01.prod.JSON'), '{}')
  let child = configure(root)

  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /JSON configuration files are no longer supported/)
})


test('legacy JSON guard ignores directories ending in .json', () => {
  let root = project()

  fs.mkdirSync(path.join(root, 'app/config/archive.json'), { recursive: true })
  let child = configure(root)

  assert.equal(child.status, 0, child.stderr)
})


test('helpers.copy preserves regular expressions', () => {
  let expression = /(^|[/\\])\../

  assert.equal(helpers.copy(expression), expression)
  assert.equal(helpers.extend({ watcher: {} }, { watcher: { ignored: expression } }).watcher.ignored, expression)
})


test('controller and action config extend citizen request config without changing application config', () => {
  let previous = global.CTZN

  global.CTZN = {
    controllers: {
      routes: {
        index: {
          config: {
            controller: { forms: { enabled: false } },
            submit: { forms: { maxPayloadSize: 1000 } }
          }
        }
      }
    }
  }
  try {
    let params = {
      config: {
        citizen: { forms: { enabled: true, maxPayloadSize: 500 } },
        forms: { applicationSetting: true }
      }
    }

    extendConfig(params, 'index', 'submit')
    assert.deepEqual(params.config.citizen.forms, { enabled: false, maxPayloadSize: 1000 })
    assert.deepEqual(params.config.forms, { applicationSetting: true })
  } finally {
    global.CTZN = previous
  }
})


test('app.start config extends application settings and rejects citizen settings', () => {
  let config = resolve({
        citizen: { http: { enabled: false } },
        db: { host: 'localhost', max: 10 }
      }, { appPath: path.resolve('app') }),
      extended

  assert.throws(() => extendAppConfig(config, { citizen: {} }), /application configuration only/)
  assert.throws(() => extendAppConfig(config, []), /plain object/)
  extended = extendAppConfig(config, { db: { max: 20, port: 5432 } })
  assert.deepEqual(extended.db, { host: 'localhost', max: 20, port: 5432 })
  assert.equal(extended.citizen.http.enabled, false)
})


test('app.start exposes application overrides through app.config', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-start-config-'))

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [scaffoldPath, 'skeleton', '--mode', 'production'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(projectPath, path.join(root, 'node_modules/citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      citizen: {
        http: { enabled: false },
        logs: { access: false, debug: false, error: false, maxFileSize: 0 }
      },
      db: { host: 'localhost', max: 10 }
    }
  `)
  let script = `
        import app, { config } from 'citizen'
        global.app = app
        app.start({ db: { max: 20, port: 5432 } })
        console.log('START_RESULT=' + JSON.stringify({ app: app.config, named: config }))
      `,
      child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: root,
        encoding: 'utf8'
      }),
      line = child.stdout.split(/\r?\n/).find( item => item.startsWith('START_RESULT=') ),
      output = line && JSON.parse(line.slice('START_RESULT='.length))

  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(output.app.db, { host: 'localhost', max: 20, port: 5432 })
  assert.deepEqual(output.named.db, output.app.db)
  assert.equal(output.app.citizen.http.enabled, false)
})


test('scaffold writes project config and env files without an app package', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-scaffold-')),
      packagePath = path.join(root, 'package.json')

  fs.writeFileSync(packagePath, '{"name":"fixture","private":true}\n')
  fs.writeFileSync(path.join(root, '.gitignore'), 'coverage\n')
  let child = spawnSync(process.execPath, [scaffoldPath, 'skeleton', '--mode', 'production', '--network-port', '3456'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(child.status, 0, child.stderr)
  assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /NODE_ENV=production/)
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), fs.readFileSync(path.join(root, '.env.example'), 'utf8'))
  assert.match(fs.readFileSync(path.join(root, 'citizen.config.js'), 'utf8'), /port: 3456/)
  assert.equal(fs.existsSync(path.join(root, 'app/package.json')), false)
  assert.equal(fs.existsSync(path.join(root, 'app/config')), false)
  assert.equal(JSON.parse(fs.readFileSync(packagePath)).type, 'module')
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'coverage\n.env\n')
})


test('scaffold fails clearly outside a project', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-scaffold-')),
      child = spawnSync(process.execPath, [scaffoldPath, 'skeleton'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /project root containing package\.json/)
  assert.equal(fs.existsSync(path.join(root, 'app')), false)
})


test('scaffold preserves existing project config files and rejects repeat runs', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-existing-')),
      files = {
        '.env': 'NODE_ENV=production\nDB_PASSWORD=secret\n',
        '.env.example': 'NODE_ENV=production\nDB_PASSWORD=replace-me\n',
        'citizen.config.js': 'export default { citizen: { http: { port: 9999 } } }\n'
      }

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true}\n')
  Object.entries(files).forEach( file => fs.writeFileSync(path.join(root, file[0]), file[1]) )
  fs.mkdirSync(path.join(root, 'web'))
  fs.writeFileSync(path.join(root, 'web/existing.txt'), 'keep me\n')
  let child = spawnSync(process.execPath, [scaffoldPath, 'skeleton'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.equal(child.status, 0, child.stderr)
  Object.entries(files).forEach( file => assert.equal(fs.readFileSync(path.join(root, file[0]), 'utf8'), file[1]) )
  assert.match(child.stdout, /Keeping existing project file: .*\.env/)
  assert.match(child.stdout, /Keeping existing project file: .*\.env\.example/)
  assert.match(child.stdout, /Keeping existing project file: .*citizen\.config\.js/)
  assert.match(child.stdout, /Keeping existing project directory: .*web/)
  assert.equal(fs.readFileSync(path.join(root, 'web/existing.txt'), 'utf8'), 'keep me\n')

  let packageJSON = fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
      repeat = spawnSync(process.execPath, [scaffoldPath, 'skeleton'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.notEqual(repeat.status, 0)
  assert.match(repeat.stderr, /app directory already exists/)
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), packageJSON)
  Object.entries(files).forEach( file => assert.equal(fs.readFileSync(path.join(root, file[0]), 'utf8'), file[1]) )
})


test('scaffolded project imports namespaced citizen and typed application config', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-public-')),
      packagePath = path.join(root, 'package.json')

  fs.writeFileSync(packagePath, '{"name":"fixture","private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [scaffoldPath, 'skeleton', '--mode', 'production'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(projectPath, path.join(root, 'node_modules/citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default { citizen: { http: { port: 0 } }, db: { port: 5432 } }\n')

  let script = `
        import app from 'citizen'
        console.log('PUBLIC_RESULT=' + JSON.stringify({
          cache: Object.fromEntries(Object.entries(app.cache).map(([key, value]) => [key, typeof value])),
          db: app.config.db,
          log: typeof app.log,
          mode: app.config.citizen.mode,
          session: typeof app.session.end,
          start: typeof app.start
        }))
      `,
      child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: root,
        encoding: 'utf8'
      }),
      line = child.stdout.split(/\r?\n/).find( item => item.startsWith('PUBLIC_RESULT=') ),
      output = line && JSON.parse(line.slice('PUBLIC_RESULT='.length))

  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(output.cache, { clear: 'function', exists: 'function', get: 'function', set: 'function' })
  assert.deepEqual(output.db, { port: 5432 })
  assert.equal(output.log, 'function')
  assert.equal(output.mode, 'production')
  assert.equal(output.session, 'function')
  assert.equal(output.start, 'function')

  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      citizen: {
        http: { enabled: false },
        https: { enabled: true }
      }
    }
  `)
  let https = spawnSync(process.execPath, ['app/start.js'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(https.status, 1)
  assert.match(https.stdout + https.stderr, /HTTPS requires either citizen\.https\.pfx or both citizen\.https\.key and citizen\.https\.cert/)
})


test('package allowlist includes public docs and templates but excludes internal files', () => {
  let cache = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-npm-cache-')),
      child = spawnSync('npm', ['pack', '--dry-run', '--json', '--cache', cache], {
        cwd: projectPath,
        encoding: 'utf8'
      }),
      pack = child.status === 0 && JSON.parse(child.stdout)[0],
      files = pack && pack.files.map( file => file.path )

  assert.equal(child.status, 0, child.stderr)
  assert.ok(files.includes('README.md'))
  assert.ok(files.includes('MIGRATION.md'))
  assert.ok(files.includes('util/templates/citizen.config.js'))
  assert.ok(files.includes('util/templates/env'))
  assert.equal(files.some( file => file.startsWith('docs/') ), false)
  assert.equal(files.some( file => file.startsWith('test/') ), false)
  assert.equal(files.includes('eslint.config.js'), false)
})


test('development watcher polling options reach Chokidar', async () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-watcher-'))

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [scaffoldPath, 'skeleton', '--mode', 'development'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(projectPath, path.join(root, 'node_modules/citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      citizen: {
        development: {
          watcher: {
            interval: 25,
            usePolling: true
          }
        },
        http: { enabled: false }
      }
    }
  `)

  let child = spawn(process.execPath, ['app/start.js'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  try {
    await waitFor(child, 'Starting watcher for hot module replacement')
    await new Promise( resolve => setTimeout(resolve, 250) )
    let reloaded = waitFor(child, 'Model reinitialized: index')

    fs.appendFileSync(path.join(root, 'app/models/index.js'), '\n// watcher test\n')
    await reloaded
  } finally {
    if ( child.exitCode === null ) {
      child.kill()
      await once(child, 'exit')
    }
  }
})


test('global CORS merges, overrides, and disables through a scaffolded server', async context => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-cors-')),
      port

  try {
    port = await getPort()
  } catch ( err ) {
    if ( err.code !== 'EPERM' ) {
      throw err
    }
    context.skip('This environment does not permit listening on a local port.')
    return
  }

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [scaffoldPath, 'skeleton', '--mode', 'production'], {
        cwd: root,
        encoding: 'utf8'
      })

  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(projectPath, path.join(root, 'node_modules/citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      citizen: {
        cors: {
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Origin': 'https://global.example'
        },
        http: {
          keepAliveTimeout: 5000,
          maxHeaderSize: 1024,
          port: ${port}
        },
        https: {
          enabled: false,
          pfx: '/does/not/exist.pfx'
        }
      }
    }
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/routes/index.js'), `
    export const config = {
      override: {
        cors: { 'Access-Control-Allow-Origin': 'https://override.example' }
      },
      private: { cors: false }
    }

    export const handler = async () => ({ local: app.models.index.content() })
    export const override = handler
    export const privateRoute = handler
    export { privateRoute as private }
  `)

  let child = spawn(process.execPath, ['app/start.js'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  try {
    await waitFor(child, 'HTTP server started')
    let baseline = await request(port, '/', 'https://global.example'),
        override = await request(port, '/index/action/override', 'https://override.example'),
        disabled = await request(port, '/index/action/private', 'https://global.example'),
        oversized = await request(port, '/', null, { 'x-oversized': 'x'.repeat(2048) })

    assert.equal(baseline.status, 200)
    assert.equal(baseline.headers['access-control-allow-origin'], 'https://global.example')
    assert.equal(override.status, 200)
    assert.equal(override.headers['access-control-allow-headers'], 'Content-Type')
    assert.equal(override.headers['access-control-allow-origin'], 'https://override.example')
    assert.equal(disabled.status, 403)
    assert.equal(oversized.status, 431)
  } finally {
    if ( child.exitCode === null ) {
      child.kill()
      await once(child, 'exit')
    }
  }
})
