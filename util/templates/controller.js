// [pattern] controller

[useStrict]
module.exports = {
  handler: handler
}

// default action
async function handler(params, context) {
  let content = await [appName].models.[pattern].content()

  return {
    content: content
  }
}
