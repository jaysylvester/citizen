// application events

// This module optionally exports the following methods:
// start(context, emitter) - Called when the application starts
// error(err, context, emitter) - Called on every application error

// If you have no use for this file, you can delete it.

[useStrict]
module.exports = {
  start: start,
  error: error
}

async function start(context) {
  return
}

async function error(err, params, context) {
  return
}
