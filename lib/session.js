// session management

'use strict';

module.exports = {
  create: create,
  end: end,
  reset: reset
};

function create() {
  var sessionID = 0,
      started = Date.now(),
      expires = started + CTZN.config.citizen.sessionTimeout;

  while ( !CTZN.sessions[sessionID] ) {
    sessionID = generateSessionID();
    if ( !CTZN.sessions[sessionID] ) {
      CTZN.sessions[sessionID] = {
        id: sessionID,
        started: started,
        expires: expires,
        timer: setTimeout( function () {
          end(sessionID);
        }, CTZN.config.citizen.sessionTimeout)
      };
    }
  }

  return sessionID;
}

function end(sessionID) {
  if ( CTZN.sessions[sessionID] ) {
    clearTimeout(CTZN.sessions[sessionID].timer);
    CTZN.sessions[sessionID] = null;
  }
}

function reset(sessionID) {
  if ( CTZN.sessions[sessionID] ) {
    CTZN.sessions[sessionID].expires = Date.now() + CTZN.config.citizen.sessionTimeout;
    clearTimeout(CTZN.sessions[sessionID].timer);
    CTZN.sessions[sessionID].timer = setTimeout( function () {
      end(sessionID);
    }, CTZN.config.citizen.sessionTimeout);
  }
}

function generateSessionID() {
  return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '');
}
