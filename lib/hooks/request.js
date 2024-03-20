// request event hooks

// citizen
import helpers from '../helpers.js'


const start = async () => {}


const end = async (params, request) => {
  // Log the request parameters for debugging
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
      label   : 'Requested: ' + params.route.url + ' | Remote host: ' + request.remoteAddress + ' | User agent: "' + request.headers['user-agent'] + '"',
      content : logContent,
      divider : { top: CTZN.config.citizen.mode === 'development' ? true : false }
    })
  }
}


export default { start, end }
