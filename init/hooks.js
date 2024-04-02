// initialize event hooks

// node
import fs          from 'node:fs'
import path        from 'node:path'
// citizen
import application from '../lib/hooks/application.js'
import request     from '../lib/hooks/request.js'
import response    from '../lib/hooks/response.js'
import session     from '../lib/hooks/session.js'


const getHooks = async (hookPath) => {
  let hooks    = {
        citizen: {
          application : application,
          request     : request,
          response    : response,
          session     : session
        },
        app: {}
      },
      files   = [],
      jsRegex = new RegExp(/.*\.(c|m)?(js)$/)

  console.log('\nImporting application event hooks:\n')

  try {
    files = fs.readdirSync(hookPath)
    if ( files.length ) {
      for ( const file of files ) {
        if ( jsRegex.test(file) ) {
          console.log('  ' + hookPath + '/' + file)
          hooks.app[path.basename(file, path.extname(file))] = await import(path.join(hookPath, '/', file))
        }
      }
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('   No event hooks found.')
        break
      default:
        console.log('   There was an error while attempting to traverse the event hooks directory (' + hookPath + ').\n')
        console.log(err)
        process.exit()
    }
  }
  
  console.log('\n')

  return hooks
}


export default { getHooks }
