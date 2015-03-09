// response events

// This module optionally exports the following methods:
// start(params, context, emitter) - Called at the beginning of every response
// end(params, context, emitter) - Called at the end of every response (after the response has been sent to the client)

// If you have no use for this file, you can delete it.

[useStrict]
module.exports = {
  start: start,
  end: end
};


function start(params, context, emitter) {
  emitter.emit('ready');
}


function end(params, context, emitter) {
  emitter.emit('ready');
}
