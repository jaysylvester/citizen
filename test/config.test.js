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
import { extendConfig, start }   from '../lib/server.js'


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
      expression: config.development?.watcher?.ignored?.source
    }))
  `,
      env = { ...process.env, ...options.env }

  delete env.APP_VALUE
  delete env.CITIZEN_APP_PATH
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


function request(port, pathname, origin) {
  return new Promise( (resolve, reject) => {
    let call = http.request({
      headers: {
        accept: 'text/html',
        origin: origin
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


function started(child) {
  return new Promise( (resolve, reject) => {
    let output = '',
        timer = setTimeout(() => reject(new Error('Timed out waiting for the scaffolded server to start.\n' + output)), 3000)

    child.stdout.on('data', chunk => {
      output += chunk
      if ( output.includes('HTTP server started') ) {
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

  assert.equal(defaults.mode, 'production')
  assert.equal(defaults.http.port, 80)
  assert.equal(defaults.development.watcher.interval, 100)
  assert.equal(defaults.directories.app, path.join(root, 'app'))
  assert.equal(defaults.directories.web, path.join(root, 'web'))
})


test('project config preserves typed values and does not mutate defaults', () => {
  let root = project(),
      app = path.join(root, 'app'),
      defaults = getDefaults({ appPath: app }),
      expression = /node_modules|cache/i,
      config = resolve({
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
      }, { appPath: app })

  assert.equal(config.connectionQueue, null)
  assert.deepEqual(config.contentTypes, ['application/json'])
  assert.equal(config.development.watcher.ignored, expression)
  assert.equal(config.development.watcher.usePolling, true)
  assert.deepEqual(config.http.headers, { nested: true })
  assert.equal(config.http.port, 3000)
  assert.equal(defaults.http.enabled, true)
  assert.equal(defaults.development.watcher.usePolling, undefined)
})


test('relative directories resolve from the project root and app cannot be relocated', () => {
  let root = project(),
      app = path.join(root, 'app'),
      config = resolve({
        directories: {
          app: '../wrong',
          logs: 'var/log',
          web: '/srv/web'
        }
      }, { appPath: app })

  assert.equal(config.directories.app, app)
  assert.equal(config.directories.logs, path.join(root, 'var/log'))
  assert.equal(config.directories.web, '/srv/web')
})


test('missing optional project files load defaults', () => {
  let root = project(),
      child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.mode, 'production')
  assert.match(child.stdout, /No project \.env loaded/)
  assert.match(child.stdout, /No citizen\.config\.js found/)
})


test('project .env loads application values without copying them into config', () => {
  let root = project()

  fs.writeFileSync(path.join(root, '.env'), 'NODE_ENV=development\nAPP_VALUE=from-file\n')
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.mode, 'development')
  assert.equal(output.env, 'from-file')
  assert.equal(output.config.APP_VALUE, undefined)
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
      development: { watcher: { ignored: /generated/ } },
      http: { port: Number(process.env.PORT) }
    }
  `)
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.http.port, 4321)
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
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default { directories: { app: "/wrong/from-config" } }')
  let child = configure(root),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.directories.app, path.join(root, 'app'))
  assert.match(child.stderr, /Ignored CITIZEN_APP_PATH from \.env/)
})


test('the process-only app directory selects another project', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-bootstrap-')),
      selected = path.join(root, 'selected'),
      app = path.join(selected, 'app')

  fs.mkdirSync(app, { recursive: true })
  fs.writeFileSync(path.join(selected, 'citizen.config.js'), 'export default { http: { port: 4567 } }')
  let child = configure(root, { env: { CITIZEN_APP_PATH: app } }),
      output = result(child)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(output.config.http.port, 4567)
  assert.equal(output.config.directories.app, app)
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


test('helpers.copy preserves regular expressions', () => {
  let expression = /(^|[/\\])\../

  assert.equal(helpers.copy(expression), expression)
  assert.equal(helpers.extend({ watcher: {} }, { watcher: { ignored: expression } }).watcher.ignored, expression)
})


test('controller and action config extend the flat request config', () => {
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
    let params = { config: { forms: { enabled: true, maxPayloadSize: 500 } } }

    extendConfig(params, 'index', 'submit')
    assert.deepEqual(params.config.forms, { enabled: false, maxPayloadSize: 1000 })
    assert.equal(params.config.citizen, undefined)
  } finally {
    global.CTZN = previous
  }
})


test('app.start rejects every supplied config argument', () => {
  assert.throws(() => start({}), /citizen\.config\.js/)
  assert.throws(() => start(undefined), /citizen\.config\.js/)
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


test('scaffolded project imports flat config and callable public exports', () => {
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
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default { http: { port: 0 } }\n')

  let script = `
        import app from 'citizen'
        console.log('PUBLIC_RESULT=' + JSON.stringify({
          cache: Object.fromEntries(Object.entries(app.cache).map(([key, value]) => [key, typeof value])),
          citizen: app.config.citizen,
          log: typeof app.log,
          mode: app.config.mode,
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
  assert.equal(output.citizen, undefined)
  assert.equal(output.log, 'function')
  assert.equal(output.mode, 'production')
  assert.equal(output.session, 'function')
  assert.equal(output.start, 'function')

  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      http: { enabled: false },
      https: { enabled: true }
    }
  `)
  let https = spawnSync(process.execPath, ['app/start.js'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(https.status, 1)
  assert.match(https.stdout + https.stderr, /HTTPS requires either https\.pfx or both https\.key and https\.cert/)
})


test('global CORS merges, overrides, and disables through a scaffolded server', async context => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-cors-')),
      port

  try {
    port = await getPort()
  } catch ( err ) {
    if ( err.code !== 'EPERM' ) throw err
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
      cors: {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Origin': 'https://global.example'
      },
      http: {
        keepAliveTimeout: 5000,
        port: ${port}
      },
      https: {
        enabled: false,
        pfx: '/does/not/exist.pfx'
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
    await started(child)
    let baseline = await request(port, '/', 'https://global.example'),
        override = await request(port, '/index/action/override', 'https://override.example'),
        disabled = await request(port, '/index/action/private', 'https://global.example')

    assert.equal(baseline.status, 200)
    assert.equal(baseline.headers['access-control-allow-origin'], 'https://global.example')
    assert.equal(override.status, 200)
    assert.equal(override.headers['access-control-allow-headers'], 'Content-Type')
    assert.equal(override.headers['access-control-allow-origin'], 'https://override.example')
    assert.equal(disabled.status, 403)
  } finally {
    if ( child.exitCode === null ) {
      child.kill()
      await once(child, 'exit')
    }
  }
})
