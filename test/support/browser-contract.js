/* global EventSource */
export const browserContract = async page => {
  let statuses = [], capture = response => {
    if ( response.url().includes('/events?reconnect=1') ) {
      statuses.push(response.status())
    }
  }
  page.on('response', capture)
  return page.evaluate(async () => {
    const check = (condition, message) => { if ( !condition ) { throw new Error(message) } }
    let result = {}
    await new Promise((resolve, reject) => {
      let source = new EventSource('/events?reconnect=1'), events = [], start = performance.now(),
          timer = setTimeout(() => { source.close(); reject(new Error('Reconnect timeout')) }, 4000)
      source.onmessage = event => events.push({ data: event.data, id: event.lastEventId })
      source.onerror = () => {
        if ( source.readyState === EventSource.CLOSED ) {
          clearTimeout(timer)
          result.reconnect = { events, elapsed: performance.now() - start }
          resolve()
        }
      }
    })
    check(result.reconnect.events.length === 1, '204 should stop reconnection after one event')
    check(result.reconnect.events[0].data === 'first\nsecond', 'Multiline SSE data')
    check(result.reconnect.events[0].id === '雪😀', 'Unicode SSE ID')
    check(result.reconnect.elapsed >= 40 && result.reconnect.elapsed < 2500, 'Server retry controls reconnection')
    await new Promise((resolve, reject) => {
      let source = new EventSource('/events?done=1&hold=100'),
          timer = setTimeout(() => { source.close(); reject(new Error('Completion timeout')) }, 4000)
      source.addEventListener('complete', event => {
        source.close()
        clearTimeout(timer)
        result.complete = JSON.parse(event.data).done && source.readyState === EventSource.CLOSED
        resolve()
      })
    })
    check(result.complete, 'Application completion event closes EventSource')
    let response = await fetch('/events?done=1', { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ x: '雪' }) })
    result.post = { status: response.status, type: response.headers.get('content-type'), body: await response.text() }
    check(result.post.status === 200 && result.post.body.includes('event: complete'), 'POST/fetch SSE')
    let failure = await fetch('/events?error=422', { headers: { Accept: 'text/event-stream' } })
    result.error = { status: failure.status, type: failure.headers.get('content-type'), body: await failure.json() }
    check(result.error.status === 422 && result.error.body.error.error.stack, 'Pre-commit JSON error diagnostics')
    return result
  }).then(result => {
    if ( String(statuses) !== '200,204' ) {
      throw new Error('Reconnect must stop with 204, not an error: ' + statuses)
    }
    return { ...result, reconnectStatuses: statuses }
  }).finally(() => page.off('response', capture))
}
