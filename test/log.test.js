import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import { getDefaults } from '../init/config.js'
import helpers from '../lib/helpers.js'
import applicationHooks from '../lib/hooks/application.js'


const projectPath = fileURLToPath(new URL('..', import.meta.url))


function logger(context, destination = 'file', mode = 'production', writeError) {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'CTZN'),
      config = getDefaults(),
      stdout = [], stderr = [], files = []

  context.after(() => {
    if ( previous ) {
      Object.defineProperty(globalThis, 'CTZN', previous)
    } else {
      delete globalThis.CTZN
    }
  })
  config.citizen.mode = mode
  config.citizen.logs.destination = destination
  globalThis.CTZN = { config, controllers: { hooks: {} } }
  context.mock.method(console, 'log', content => stdout.push(content))
  context.mock.method(console, 'error', content => stderr.push(content))
  context.mock.method(fs, 'appendFile', (file, content, callback) => {
    files.push({ file, content })
    callback(writeError)
  })
  return { config: config.citizen, stdout, stderr, files }
}


function project(context, citizen = {}, hook = '') {
  let root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-log-'))),
      env = { ...process.env, NODE_ENV: 'production' },
      fixture = { root, env }

  delete env.CITIZEN_APP_PATH
  context.after(async () => {
    if ( fixture.child && fixture.child.exitCode === null && fixture.child.signalCode === null ) {
      let exited = once(fixture.child, 'exit')

      fixture.child.kill()
      await exited
    }
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [path.join(projectPath, 'util/scaffold.js'), 'skeleton', '--mode', 'production'], {
    cwd: root, env, encoding: 'utf8', timeout: 5000
  })

  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(projectPath, path.join(root, 'node_modules/citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default ' + JSON.stringify({ citizen: {
    http: { enabled: false },
    ...citizen,
    logs: { maxFileSize: 0, ...citizen.logs }
  } }) + '\n')
  fs.writeFileSync(path.join(root, 'app/controllers/hooks/application.js'), hook)
  return fixture
}


function run(project) {
  return spawnSync(process.execPath, ['app/start.js'], {
    cwd: project.root, env: project.env, encoding: 'utf8', timeout: 5000
  })
}


test('file destination preserves category selection, filenames, and console output', context => {
  let { config, stdout, stderr, files } = logger(context)

  helpers.log({ label: 'disabled debug' })
  helpers.log({ type: 'access', label: 'disabled access' })
  helpers.log({ type: 'status', label: 'custom type' })
  assert.equal(files.length, 0)
  assert.equal(stdout.length, 0)
  helpers.log({ type: 'error:client', label: 'client', content: 'missing', timestamp: false })
  helpers.log({ type: 'error:server', label: 'server', timestamp: false })
  config.logs.access = true
  config.logs.debug = true
  helpers.log({ type: 'access', label: 'access', file: false, timestamp: false })
  helpers.log({ label: 'debug', console: true, timestamp: false })
  assert.deepEqual(files.map(item => path.basename(item.file)), ['error.log', 'error.log', 'access.log', 'error.log'])
  assert.equal(files[0].content, 'client\n    missing\n')
  assert.deepEqual(stdout, ['\x1b[1mdebug\x1b[0m\n'])
  assert.deepEqual(stderr, [])
})


test('stdio routes enabled categories and forced console messages without duplicates or ANSI', context => {
  let { config, stdout, stderr, files } = logger(context, 'stdio')

  config.logs.access = true
  config.logs.debug = true
  for ( let type of ['access', 'debug', 'error:client', 'error:server'] ) {
    helpers.log({ type, label: type, content: { value: 'text' }, console: true, timestamp: false })
  }
  helpers.log({ type: 'status', label: 'forced status', console: true, timestamp: false })
  helpers.log({ type: 'error', label: 'forced error', console: true, timestamp: false })
  assert.deepEqual(stdout.map(item => item.split('\n')[0]), ['access', 'debug', 'forced status'])
  assert.deepEqual(stderr.map(item => item.split('\n')[0]), ['error:client', 'error:server', 'forced error'])
  assert.ok([...stdout, ...stderr].every(item => !item.includes('\x1b')))
  assert.deepEqual(files, [])
})


test('stdio respects category switches and keeps development console behavior', context => {
  let { config, stdout, stderr, files } = logger(context, 'stdio'),
      types = ['access', 'debug', 'error:client', 'error:server', 'error', 'status']

  config.logs.error = { client: false, server: false }
  for ( let type of types ) {
    helpers.log({ type, label: type, timestamp: false })
  }
  assert.deepEqual(stdout, [])
  assert.deepEqual(stderr, [])
  config.logs.error = false
  helpers.log({ type: 'error:server', label: 'still disabled' })
  assert.deepEqual(stderr, [])
  for ( let enabled of ['client', 'server'] ) {
    config.logs.error = { [enabled]: true }
    for ( let type of ['error:client', 'error:server'] ) {
      helpers.log({ type, label: type, timestamp: false })
    }
  }
  assert.deepEqual(stderr, ['error:client\n', 'error:server\n'])
  stderr.length = 0
  config.mode = 'development'
  config.logs.access = true
  config.logs.error = { client: true, server: true }
  for ( let type of types ) {
    helpers.log({ type, label: type, console: false, timestamp: false })
  }
  assert.deepEqual(stdout, ['access\n', 'debug\n', 'status\n'])
  assert.deepEqual(stderr, ['error:client\n', 'error:server\n', 'error\n'])
  assert.deepEqual(files, [])
})


test('stdio keeps labels, timestamps, dividers, and object inspection settings', context => {
  let { stdout } = logger(context, 'stdio'),
      content = Object.defineProperty({ nested: { value: { deep: 'hidden by depth' } } }, 'secret', { value: 'visible' })

  helpers.log({ label: 'record', content, console: true, depth: 1, showHidden: true, divider: { top: '<top>', bottom: '<bottom>' } })
  assert.match(stdout[0], /^<top>\[\d{4}-\d{2}-\d{2}T[^\]]+\] record\n/)
  assert.ok(stdout[0].includes('[secret]'))
  assert.ok(stdout[0].includes('[Object]'))
  assert.ok(stdout[0].endsWith('\n<bottom>'))
  assert.ok(!stdout[0].includes('\x1b'))
  helpers.log({ content: 42, console: true, timestamp: false, divider: { top: true, bottom: true } })
  assert.equal(stdout[1], '\n----------------------------------------------------------------------\n\n\n42\n\n----------------------------------------------------------------------\n\n')
})


test('explicit filenames keep file writes in stdio without duplicating configured stream output', context => {
  let { config, stdout, files } = logger(context, 'stdio')

  helpers.log({ label: 'file only', file: 'custom.log', timestamp: false })
  assert.deepEqual(stdout, [])
  config.logs.debug = true
  helpers.log({ label: 'both', file: 'custom.log', console: true, timestamp: false })
  assert.deepEqual(stdout, ['both\n'])
  assert.deepEqual(files.map(item => [path.basename(item.file), item.content]), [['custom.log', 'file only\n'], ['custom.log', 'both\n']])
})


for ( let destination of ['file', 'stdio'] ) {
  test(destination + ' accepts file: true as a forced default filename and false as no override', context => {
    let { config, stdout, stderr, files } = logger(context, destination),
        types = ['access', 'debug', 'error:client', 'error:server', 'error', 'status']

    config.logs.error = false
    for ( let type of types ) {
      helpers.log({ type, label: type, file: true, timestamp: false })
      helpers.log({ type, label: 'disabled', file: false })
      helpers.log({ type, label: 'disabled' })
    }
    assert.deepEqual(files.map(item => path.basename(item.file)), ['access.log', 'error.log', 'error.log', 'error.log', 'error.log', 'error.log'])
    assert.deepEqual(stdout, [])
    assert.deepEqual(stderr, [])
    config.logs.access = true
    helpers.log({ type: 'access', label: 'enabled', file: false, timestamp: false })
    assert.equal(files.length, destination === 'file' ? 7 : 6)
    assert.deepEqual(stdout, destination === 'stdio' ? ['enabled\n'] : [])
  })
}


for ( let code of ['ENOENT', 'EACCES'] ) {
  test('file write failure ' + code + ' reports to stderr without another file write', context => {
    let { stdout, stderr, files } = logger(context, 'stdio', 'production', Object.assign(new Error('write failed'), { code }))

    assert.doesNotThrow(() => helpers.log({ label: 'record', file: 'custom.log' }))
    assert.equal(files.length, 1)
    assert.deepEqual(stdout, [])
    assert.match(stderr[0], /Error in app.log\(\)/)
  })
}


test('public app.log and named log exports write to the configured process streams', context => {
  let fixture = project(context, { logs: { destination: 'stdio', access: true } }, `
    export const start = async () => {
      let { log } = await import('citizen')

      app.log({ type: 'access', label: 'PUBLIC_ACCESS' })
      log({ type: 'error:client', label: 'PUBLIC_CLIENT' })
      app.log({ type: 'error:server', label: 'PUBLIC_SERVER' })
      app.log({ label: 'DISABLED_DEBUG' })
    }
  `),
      child = run(fixture)

  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout.split('PUBLIC_ACCESS').length - 1, 1)
  for ( let label of ['PUBLIC_CLIENT', 'PUBLIC_SERVER'] ) {
    assert.equal(child.stderr.split(label).length - 1, 1)
    assert.ok(!child.stdout.includes(label))
  }
  assert.ok(!child.stderr.includes('PUBLIC_ACCESS'))
  assert.ok(!(child.stdout + child.stderr).includes('DISABLED_DEBUG'))
  assert.deepEqual(fs.readdirSync(path.join(fixture.root, 'logs')), [])
})


for ( let destination of ['file', 'stdio'] ) {
  for ( let existing of [false, true] ) {
    test(destination + ' startup prepares ' + (existing ? 'an existing' : 'a missing') + ' directory with all categories disabled', context => {
      let fixture = project(context, { logs: { destination, access: false, error: false, debug: false } }, `
        export const start = async () => {
          app.log({ label: 'CUSTOM_FILE', file: 'custom.log', timestamp: false })
          app.log({ type: 'access', label: 'BOOLEAN_ACCESS', file: true, timestamp: false })
          app.log({ label: 'BOOLEAN_DEBUG', file: true, timestamp: false })
        }
      `)

      if ( existing ) {
        fs.mkdirSync(path.join(fixture.root, 'logs'))
        fs.writeFileSync(path.join(fixture.root, 'logs/keep.log'), 'keep\n')
      }
      let child = run(fixture)

      assert.equal(child.status, 0, child.stderr)
      assert.equal(child.stderr, '')
      assert.equal(fs.readFileSync(path.join(fixture.root, 'logs/custom.log'), 'utf8'), 'CUSTOM_FILE\n')
      assert.equal(fs.readFileSync(path.join(fixture.root, 'logs/access.log'), 'utf8'), 'BOOLEAN_ACCESS\n')
      assert.equal(fs.readFileSync(path.join(fixture.root, 'logs/error.log'), 'utf8'), 'BOOLEAN_DEBUG\n')
      assert.equal(fs.existsSync(path.join(fixture.root, 'logs/true')), false)
      assert.ok(!child.stdout.includes('CUSTOM_FILE'))
      if ( existing ) {
        assert.equal(fs.readFileSync(path.join(fixture.root, 'logs/keep.log'), 'utf8'), 'keep\n')
      }
    })
  }
}


for ( let destination of ['file', 'stdio'] ) {
  for ( let failure of ['regular file', 'missing parent'] ) {
    test(destination + ' startup handles log-directory failure: ' + failure, context => {
      let fixture = project(context, {
        directories: { logs: failure === 'regular file' ? 'logs' : 'missing-parent/logs' },
        logs: { destination, error: false, maxFileSize: 10000 }
      }, `
        export const start = async () => {
          app.log({ label: 'APPLICATION_STARTED', console: true })
          app.log({ label: 'FILE_WRITE_ATTEMPT', file: 'custom.log' })
        }
      `)

      if ( failure === 'regular file' ) {
        fs.writeFileSync(path.join(fixture.root, 'logs'), 'not a directory')
      }
      let child = run(fixture)

      // With HTTP disabled, natural exit also verifies that no rotation watcher remains open.
      assert.equal(child.status, destination === 'stdio' ? 0 : 1, child.stderr)
      assert.match(child.stderr, /citizen could not prepare the log directory/)
      assert.doesNotMatch(child.stdout, /could not prepare the log directory/)
      assert.match(child.stderr, failure === 'regular file' ? /Log path is not a directory/ : /ENOENT/)
      assert.equal(child.stdout.includes('APPLICATION_STARTED'), destination === 'stdio')
      if ( destination === 'stdio' ) {
        assert.equal(child.stderr.split('Warning:').length - 1, 1)
        assert.match(child.stderr, /Continuing with stdio logging; log rotation is disabled/)
        assert.match(child.stderr, /Error in app.log\(\)/)
        assert.doesNotMatch(child.stderr, /Exiting/)
      } else {
        assert.match(child.stderr, /Exiting/)
        assert.doesNotMatch(child.stderr, /Error in app.log\(\)/)
      }
    })
  }
}


for ( let operation of ['stat', 'mkdir'] ) {
  test('stdio continues without rotation after ' + operation + ' permission failure', async context => {
    let { config, stderr } = logger(context, 'stdio'),
        started = false

    context.mock.method(fsPromises, 'stat', async () => {
      throw Object.assign(new Error('Directory lookup failed'), { code: operation === 'stat' ? 'EACCES' : 'ENOENT' })
    })
    context.mock.method(fsPromises, 'mkdir', async () => {
      assert.equal(operation, 'mkdir')
      throw Object.assign(new Error('Read-only filesystem'), { code: 'EROFS' })
    })
    context.mock.method(chokidar, 'watch', () => assert.fail('Rotation must not start after directory preparation fails'))
    context.mock.method(process, 'exit', () => assert.fail('Stdio startup must not exit on directory errors'))
    CTZN.controllers.hooks.application = { start: async () => { started = true } }
    assert.ok(config.logs.maxFileSize)
    await applicationHooks.start()
    assert.equal(started, true)
    assert.equal(stderr.length, 1)
    assert.match(stderr[0], /Warning: citizen could not prepare the log directory/)
  })
}


test('stdio preserves rotation configuration and prepares the directory before watchers and application hooks', async context => {
  let { config } = logger(context, 'stdio'),
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-log-watcher-')),
      watched = [], started = false

  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  config.directories.logs = path.join(root, 'logs')
  config.logs.error = false
  context.mock.method(chokidar, 'watch', (file, options) => {
    assert.ok(fs.statSync(config.directories.logs).isDirectory())
    watched.push({ file, options })
    return { on: () => {} }
  })
  CTZN.controllers.hooks.application = { start: async () => {
    assert.ok(fs.statSync(config.directories.logs).isDirectory())
    started = true
  } }
  await applicationHooks.start()
  assert.equal(started, true)
  assert.deepEqual(watched, [{ file: config.directories.logs + '/**.log', options: config.logs.watcher }])
  config.logs.maxFileSize = 0
  await applicationHooks.start()
  assert.equal(watched.length, 1)
})


for ( let destination of ['file', 'stdio'] ) {
  test(destination + ' rotation survives failed stats and still rotates subsequent files', async context => {
    let { config, stderr, files } = logger(context, destination),
        file = path.join(config.directories.logs, 'access.log'),
        renamed = [], change, statCallback

    context.mock.method(fsPromises, 'stat', async () => ({ isDirectory: () => true }))
    context.mock.method(chokidar, 'watch', () => ({ on: (event, callback) => {
      assert.equal(event, 'change')
      change = callback
    } }))
    context.mock.method(fs, 'stat', (target, callback) => {
      assert.equal(target, file)
      statCallback = callback
    })
    context.mock.method(fs, 'rename', (source, target, callback) => {
      renamed.push({ source, target })
      callback(null)
    })
    await applicationHooks.start()

    change(file)
    assert.doesNotThrow(() => statCallback(Object.assign(new Error('File disappeared'), { code: 'ENOENT' })))
    assert.deepEqual(renamed, [])
    assert.deepEqual(stderr, [])

    change(file)
    assert.doesNotThrow(() => statCallback(Object.assign(new Error('Permission denied'), { code: 'EACCES' })))
    assert.deepEqual(renamed, [])
    assert.equal(stderr.length, 1)
    assert.ok(stderr[0].includes(file))
    assert.match(stderr[0], /Unable to inspect/)
    assert.deepEqual(files, []) // Rotation diagnostics must not trigger more file logging.

    change(file)
    statCallback(null, { size: config.logs.maxFileSize * 1024 - 1, mtimeMs: 123 })
    assert.deepEqual(renamed, [])
    change(file)
    statCallback(null, { size: config.logs.maxFileSize * 1024, mtimeMs: 456 })
    assert.deepEqual(renamed, [{ source: file, target: path.join(config.directories.logs, 'access-456.log') }])
  })
}


test('stdio HTTPS startup failures reach stderr', context => {
  let fixture = project(context, { https: { enabled: true }, logs: { destination: 'stdio' } }),
      child = run(fixture)

  assert.equal(child.status, 1)
  assert.match(child.stderr, /HTTPS server startup failed/)
  assert.doesNotMatch(child.stdout, /HTTPS server startup failed/)
})


test('HTTP access, client errors, and server errors reach their configured streams', { timeout: 10000 }, async context => {
  let listener = net.createServer()

  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  let port = listener.address().port

  listener.close()
  await once(listener, 'close')
  let fixture = project(context, { http: { enabled: true, port }, logs: { destination: 'stdio', access: true } }),
      stdout = '', stderr = ''

  fs.writeFileSync(path.join(fixture.root, 'app/controllers/routes/failure.js'), 'export const handler = async () => { throw new Error(\'HTTP_LOG_FAILURE\') }\n')
  let child = spawn(process.execPath, ['app/start.js'], { cwd: fixture.root, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe'] })

  fixture.child = child
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  async function waitFor(check) {
    let deadline = Date.now() + 3000

    while ( !check() ) {
      assert.ok(child.exitCode === null && child.signalCode === null, stdout + stderr)
      assert.ok(Date.now() < deadline, stdout + stderr)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  await waitFor(() => stdout.includes('HTTP server started'))
  for ( let [pathname, expected] of [['/', 200], ['/missing', 404], ['/failure', 500]] ) {
    let status = await new Promise((resolve, reject) => {
      let call = http.get({ hostname: '127.0.0.1', port, path: pathname, headers: { accept: 'text/html' } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })

      call.on('error', reject)
      call.setTimeout(3000, () => call.destroy(new Error('HTTP request timed out')))
    })

    assert.equal(status, expected)
  }
  await waitFor(() => stdout.includes('200 OK GET') && stderr.includes('404 Not Found GET') && stderr.includes('HTTP_LOG_FAILURE'))
  assert.equal(stdout.split('200 OK GET').length - 1, 1)
  assert.equal(stderr.split('404 Not Found GET').length - 1, 1)
  assert.equal(stderr.split('500 Internal Server Error GET').length - 1, 1)
  assert.doesNotMatch(stdout, /404 Not Found GET|500 Internal Server Error GET|HTTP_LOG_FAILURE/)
  assert.doesNotMatch(stderr, /200 OK GET/)
  assert.deepEqual(fs.readdirSync(path.join(fixture.root, 'logs')), [])
})
