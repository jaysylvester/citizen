// [pattern] controller

[useStrict]
module.exports = {
  handler: handler
};


// default action
function handler(params, context, emitter) {

  var content = [appName].models.[pattern].content();

  emitter.emit('ready', {
    content: content
  });

}
