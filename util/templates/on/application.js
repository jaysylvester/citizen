// application events

// This module optionally exports the following methods:
// start(context, emitter) - Called when the application starts
// end(context, emitter) - Called when the application shuts down (not functional yet)
// error(e, context, emitter) - Called on every application error

// If you have no use for this file, you can delete it.

[useStrict]
module.exports = {
  start: start,
  end: end,
  error: error
};


function start(context, emitter) {
  emitter.emit('ready');
}


function end(context, emitter) {
  emitter.emit('ready');
}


function error(e, params, context, emitter) {
  emitter.emit('ready');
}
