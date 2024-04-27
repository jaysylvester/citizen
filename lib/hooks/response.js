// response event hooks

// citizen
import helpers from '../helpers.js'


const start = async (params, request, response, context) => {
  if ( CTZN.controllers.hooks.response?.start ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.response.start(params, request, response, context))
  }

  return context
}


const end = async (params, request, response, context) => {
  // Errors have alread been logged by the server error handler
  if ( response.statusCode < 400 ) {
    helpers.log({
      type: 'access',
      label: helpers.serverLogLabel(response.statusCode, params, request)
    })
  }

  // Log the response parameters for debugging
  if ( CTZN.config.citizen.mode === 'development' ) {
    let logContent = {}
    CTZN.config.citizen.development.debug.scope.config  ? logContent.config  = params.config  : false
    CTZN.config.citizen.development.debug.scope.cookie  ? logContent.cookie  = params.cookie  : false
    CTZN.config.citizen.development.debug.scope.form    ? logContent.form    = params.form    : false
    CTZN.config.citizen.development.debug.scope.payload ? logContent.payload = params.payload : false
    CTZN.config.citizen.development.debug.scope.route   ? logContent.route   = params.route   : false
    CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
    CTZN.config.citizen.development.debug.scope.url     ? logContent.url     = params.url     : false
    CTZN.config.citizen.development.debug.scope.context ? logContent.context = context        : false
  
    helpers.log({
      label     : 'Post-response parameters and context',
      content   : logContent,
      divider   : { bottom: true }
    })
  }

  if ( CTZN.controllers.hooks.response?.end ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.response.end(params, request, response, context))
  }

  return context
}


export default { start, end }
