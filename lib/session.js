// session management

// citizen
import helpers from './helpers.js'


const create = (params) => {
  var sessionID = '',
      started = Date.now(),
      expires = started + CTZN.config.citizen.sessionTimeout

  while ( !CTZN.sessions[sessionID] ) {
    sessionID = generateSessionID()
    if ( !CTZN.sessions[sessionID] ) {
      CTZN.sessions[sessionID] = {
        id: sessionID,
        started: started,
        expires: expires,
        cors: params.request.cors,
        timer: setTimeout( function () {
          checkExpiration(sessionID)
        }, CTZN.config.citizen.sessionTimeout)
      }

      helpers.log({
        label: 'Session started',
        content: CTZN.sessions[sessionID]
      })
    }
  }

  return sessionID
}


const checkExpiration = (sessionID) => {
  var now = Date.now()

  if ( CTZN.sessions[sessionID] ) {
    if ( CTZN.sessions[sessionID].expires < now ) {
      onEnd(sessionID)
    } else {
      CTZN.sessions[sessionID].timer = setTimeout( function () {
        checkExpiration(sessionID)
      }, CTZN.sessions[sessionID].expires - now)
    }
  }
}


const end = (session) => {
  if ( typeof session === 'string' ) {
    if ( CTZN.sessions[session] ) {
      clearTimeout(CTZN.sessions[session].timer)
      onEnd(session)
    }
  } else {
    Object.keys(CTZN.sessions).forEach( item => {
      if ( CTZN.sessions[item][session.key] && CTZN.sessions[item][session.key] === session.value ) {
        clearTimeout(CTZN.sessions[item].timer)
        onEnd(item)
        return false
      }
    })
  }
}


const onEnd = async (sessionID) => {
  let expiredSession

  delete CTZN.sessions[sessionID].timer
  expiredSession = helpers.copy(CTZN.sessions[sessionID])
  delete CTZN.sessions[sessionID]

  try {
    let context = await CTZN.hooks.citizen.session.end(expiredSession)
    if ( CTZN.hooks.app.session && CTZN.hooks.app.session.end ) {
      CTZN.hooks.app.session.end(expiredSession, context)
    }

    helpers.log({
      label: 'Session ended',
      content: expiredSession
    })
  } catch ( err ) {
    err.message = 'An error occurred while processing session end'
    throw err
  }
}


const extend = (sessionID) => {
  if ( CTZN.sessions[sessionID] ) {
    CTZN.sessions[sessionID].expires = Date.now() + CTZN.config.citizen.sessionTimeout
  }
}


const generateSessionID = () => {
  return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '')
}


export default { create, end, extend }
export { end }
