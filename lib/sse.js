// SSE wire encoding; event names, replay, and completion semantics belong to applications.

const fields = new Set(['data', 'event', 'id', 'retry', 'comment'])


function retryValue(value) {
  if ( !Number.isSafeInteger(value) || value < 0 ) {
    throw new TypeError('SSE retry must be a nonnegative safe integer in milliseconds.')
  }
  return value
}


export function sseOptions(descriptor, defaults = {}) {
  let heartbeat = Object.hasOwn(descriptor, 'heartbeat') ? descriptor.heartbeat : defaults.heartbeat ?? 15000,
      retry = Object.hasOwn(descriptor, 'retry') ? descriptor.retry : defaults.retry ?? false
  if ( heartbeat !== false && (!Number.isInteger(heartbeat) || heartbeat <= 0 || heartbeat > 2147483647) ) {
    throw new TypeError('SSE heartbeat must be false or a positive timer interval in milliseconds.')
  }
  if ( retry !== false ) {
    retryValue(retry)
  }
  if ( Object.hasOwn(descriptor, 'serialize') && typeof descriptor.serialize !== 'function' ) {
    throw new TypeError('SSE serialize must be a function.')
  }
  return { heartbeat, retry: retry === false ? undefined : retry, serialize: descriptor.serialize }
}


export function encodeEvent(record, serialize) {
  if ( !record || Object.getPrototypeOf(record) !== Object.prototype || !Object.keys(record).length || Object.keys(record).some(key => !fields.has(key)) ) {
    throw new TypeError('SSE events must be records containing data, event, id, retry, or comment.')
  }
  let lines = []
  for ( let field of ['comment', 'event', 'id', 'retry', 'data'] ) {
    if ( !Object.hasOwn(record, field) ) {
      continue
    }
    let value = record[field]
    if ( field === 'retry' ) {
      lines.push('retry: ' + retryValue(value))
      continue
    }
    if ( field === 'data' ) {
      if ( value === undefined ) {
        throw new TypeError('SSE data must not be undefined.')
      }
      value = serialize ? serialize(value) : typeof value === 'string' ? value : JSON.stringify(value)
    }
    if ( typeof value !== 'string' ) {
      throw new TypeError('SSE ' + field + ' must encode to a string.')
    }
    if ( (field === 'event' || field === 'id') && /[\r\n]/.test(value) || field === 'id' && value.includes('\0') ) {
      throw new TypeError('Invalid SSE ' + field + ' field.')
    }
    for ( let line of value.split(/\r\n|\r|\n/) ) {
      lines.push((field === 'comment' ? '' : field) + ': ' + line)
    }
  }
  return Buffer.from(lines.join('\n') + '\n\n')
}


export function lastEventId(header) {
  if ( header === undefined ) {
    return null
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(header, 'latin1'))
  } catch {
    throw Object.assign(new Error('Last-Event-ID must contain valid UTF-8.'), { statusCode: 400 })
  }
}
