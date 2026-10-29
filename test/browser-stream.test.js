import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { fixture } from './support/http-fixture.js'
import { files } from './support/stream-app.js'
import { browserContract } from './support/browser-contract.js'

test('native EventSource reconnect, retry, Unicode ID, 204, completion event, and POST/fetch', { skip: !process.env.PLAYWRIGHT_MODULE }, async t => {
  let { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),
      browser = await chromium.launch(), app = await fixture(t, files)
  t.after(() => browser.close())
  let page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + app.port)
  await browserContract(page)
  assert.ok(app.messages.some(message => message.type === 'setup' && message.id === '雪😀'))
  assert.ok(app.messages.some(message => message.payload?.x === '雪'))
})
