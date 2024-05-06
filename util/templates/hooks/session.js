// session events

// This module optionally exports the following methods:
// start(params, request, response, context) - Called at the start of every user session
// end(session, context) - Called when any user session expires

// If you have no use for this file, you can delete it.


export const start = (params, request, response, context) => {
  // Anything you want to happen when a new session starts
}

export const end = (session) => {
  // Anything you want to happen when a session ends. The "session" argument contains the properties of the expired session.
}
