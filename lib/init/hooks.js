// initialize event hooks

// node
import fs   from 'fs'
import path from 'path'
import * as application from '../hooks/application.js'
import * as request     from '../hooks/request.js'
import * as response    from '../hooks/response.js'
import * as session     from '../hooks/session.js'

export const getHooks = async (config) => {
  var hooks    = {},
      files    = [],
      jsRegex  = new RegExp(/.*\.(js)|(cjs)$/)

  // If there isn't a hooks directory, return an empty object
  try {
    files = fs.readdirSync(config.citizen.directories.hooks)
  } catch ( err ) {
    console.log(err)
    console.log('\nNo valid app event hooks found. Skipping...\n')
  }

  console.log('\nImporting event hooks:\n')

  for ( const file of files ) {
    if ( jsRegex.test(file) ) {
      console.log('  ' + config.citizen.directories.hooks + '/' + file)
      hooks[path.basename(file, path.extname(file))] = await import(path.join(config.citizen.directories.hooks, '/', file))
    }
  }

  console.log('\n')

  return {
    citizen: {
      application: application,
      request: request,
      response: response,
      session: session
    },
    app: hooks
  }
}
