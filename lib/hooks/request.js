// request event hooks

// citizen
import helpers from '../helpers.js'


const start = async (params, request) => {
  // Log the request parameters for debugging
  let remoteHost = ( params ? request.headers['x-forwarded-for'] || request.connection.remoteAddress || request.socket.remoteAddress || ( request.connection.socket ? request.connection.socket.remoteAddress : 'undefined' ) : 'undefined' ).replace('::ffff:', '')
  helpers.log({
    type      : 'request',
    label     : 'Remote host ' + remoteHost + ' requested ' + params.route.url,
    divider   : { top: CTZN.config.citizen.mode === 'development' ? true : false }
  })
  if ( CTZN.config.citizen.mode === 'development' ) {
    let logContent = {}
    CTZN.config.citizen.development.debug.scope.config  ? logContent.config  = params.config  : false
    CTZN.config.citizen.development.debug.scope.cookie  ? logContent.cookie  = params.cookie  : false
    CTZN.config.citizen.development.debug.scope.form    ? logContent.form    = params.form    : false
    CTZN.config.citizen.development.debug.scope.payload ? logContent.payload = params.payload : false
    CTZN.config.citizen.development.debug.scope.route   ? logContent.route   = params.route   : false
    CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
    CTZN.config.citizen.development.debug.scope.url     ? logContent.url     = params.url     : false
    helpers.log({
      label     : 'Request parameters',
      content   : logContent,
      timestamp : false
    })
  }
}


const end = async () => {
  
}


export default { start, end }
