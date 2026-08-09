// request event hooks

// citizen
import helpers from '../helpers.js'


const start = async (params, request, response, context) => {
  helpers.log({
    label   : 'Requested: ' + params.route.url + ' | Remote host: ' + request.remoteAddress + ' | User agent: "' + request.headers['user-agent'] + '"',
    divider : { top: CTZN.config.mode === 'development' ? true : false }
  })

  // Fire the app's request start hook
  if ( CTZN.controllers.hooks.request?.start ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.request.start(params, request, response, context))
  }

  return context
}


const end = async (params, request, response, context) => {
  // Log the request parameters for debugging
  if ( CTZN.config.mode === 'development' ) {
    let logContent = {}

    CTZN.config.development.debug.scope.config  ? logContent.config  = params.config  : false
    CTZN.config.development.debug.scope.cookie  ? logContent.cookie  = params.cookie  : false
    CTZN.config.development.debug.scope.form    ? logContent.form    = params.form    : false
    CTZN.config.development.debug.scope.payload ? logContent.payload = params.payload : false
    CTZN.config.development.debug.scope.route   ? logContent.route   = params.route   : false
    CTZN.config.development.debug.scope.session ? logContent.session = params.session : false
    CTZN.config.development.debug.scope.url     ? logContent.url     = params.url     : false

    helpers.log({
      label   : 'Request parameters: ' + params.route.url + ' | Remote host: ' + request.remoteAddress + ' | User agent: "' + request.headers['user-agent'] + '"',
      content : logContent,
      // divider : { top: CTZN.config.mode === 'development' ? true : false }
    })
  }

  // Fire the app's request end hook
  if ( CTZN.controllers.hooks.request?.end ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.request.end(params, request, response, context))
  }

  return context
}


export default { start, end }
