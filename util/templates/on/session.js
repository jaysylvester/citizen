// session events

// This module optionally exports the following methods:
// start(params, context, emitter) - Called at the beginning of every user session
// end(params, context, emitter) - Called at the end of every user session

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
