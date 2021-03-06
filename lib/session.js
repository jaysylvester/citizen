// session management

'use strict'

const helpers = require('./helpers')

module.exports = {
  public: {
    end: end
  },
  citizen: {
    create: create,
    extend: extend
  }
}


function create() {
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


function checkExpiration(sessionID) {
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


function end(key, value) {
  if ( arguments.length === 1 ) {
    if ( CTZN.sessions[key] ) {
      clearTimeout(CTZN.sessions[key].timer)
      onEnd(key)
    }
  } else {
    for ( var property in CTZN.sessions ) {
      if ( CTZN.sessions[property][key] && CTZN.sessions[property][key] === value ) {
        clearTimeout(CTZN.sessions[property].timer)
        onEnd(property)
        break
      }
    }
  }
}


async function onEnd(sessionID) {
  let expiredSession

  delete CTZN.sessions[sessionID].timer
  expiredSession = helpers.copy(CTZN.sessions[sessionID])
  delete CTZN.sessions[sessionID]

  try {
    let context = await CTZN.on.session.end(expiredSession)
    if ( CTZN.appOn.session && CTZN.appOn.session.end ) {
      CTZN.appOn.session.end(expiredSession, context)
    }

    helpers.log({
      label: 'Session ended',
      content: expiredSession
    })
  } catch (err) {
    throw new Error('An error occurred while processing session end')
  }
}


function extend(sessionID) {
  if ( CTZN.sessions[sessionID] ) {
    CTZN.sessions[sessionID].expires = Date.now() + CTZN.config.citizen.sessionTimeout
  }
}


function generateSessionID() {
  return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '')
}
