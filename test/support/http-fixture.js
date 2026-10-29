import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../..', import.meta.url))

export async function until(check, message = 'Condition was not reached', timeout = 4000) {
  let deadline = Date.now() + timeout
  while ( !check() ) {
    assert.ok(Date.now() < deadline, message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return check()
}

export async function fixture(t, files, config = {}) {
  let listener = net.createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  let port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  let root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-stream-test-'))), child,
      messages = [], output = '', env = { ...process.env, NODE_ENV: 'production' }
  delete env.CITIZEN_APP_PATH
  t.after(async () => {
    if ( child && child.exitCode === null && child.signalCode === null ) {
      let exited = once(child, 'exit')
      child.kill()
      await exited
    }
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [path.join(project, 'util/scaffold.js'), 'skeleton', '--mode', 'production'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(project, path.join(root, 'node_modules/citizen'), 'dir')
  let settings = { http: { port }, logs: { destination: 'stdio', access: true, error: { client: true, server: true }, debug: false, maxFileSize: 0 }, ...config }
  fs.writeFileSync(path.join(root, 'citizen.config.js'), 'export default ' + JSON.stringify({ citizen: settings }))
  files = {
    'app/controllers/hooks/application.js': 'export const error = async (params, request, response, context, err) => { process.send?.({ type: \'error\', message: err.message, status: err.statusCode || 500 }) }',
    'app/controllers/hooks/response.js': 'export const end = async (params, request, response, context) => { process.send?.({ type: \'end\', url: request.url, outcome: response.completion, aborted: request.signal?.aborted, context }) }',
    ...files
  }
  for ( let [name, content] of Object.entries(files) ) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), content)
  }
  child = spawn(process.execPath, ['app/start.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  child.on('message', message => messages.push(message))
  await until(() => output.includes('HTTP server started'), 'Fixture startup failed: ' + output)
  return { port, root, child, messages, get output() { return output } }
}

export function open(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    let call = http.request({ hostname: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers: options.headers || {} }, response => {
      let chunks = [], ended = false,
          body = new Promise(done => {
            response.on('data', chunk => chunks.push(chunk))
            response.on('end', () => { ended = true })
            response.on('error', () => {})
            response.on('close', () => done({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks), body: Buffer.concat(chunks).toString(), aborted: !ended }))
          })
      resolve({ call, response, body, chunks })
    })
    call.on('error', reject)
    call.setTimeout(4000, () => call.destroy(new Error('Fixture HTTP timeout')))
    if ( options.chunks ) {
      void (async () => {
        for ( let chunk of options.chunks ) {
          if ( call.destroyed ) { break }
          call.write(chunk)
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        call.end()
      })()
    } else {
      call.end(options.body)
    }
  })
}

export async function request(port, pathname, options) {
  return (await open(port, pathname, options)).body
}
