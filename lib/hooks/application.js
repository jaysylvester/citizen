// application event hooks

// node
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'
// citizen
import * as cache from '../cache.js'
import * as helpers from '../helpers.js'
// third-party
import chokidar from 'chokidar'

export const start = async () => {
  // Use file system events on OS X, polling on others
  const options = { usePolling  : true,
                    interval    : CTZN.config.citizen.development.watcher.interval,
                    useFsEvents : true }

  // If file logging is enabled and the specified log directory doesn't exist, create it.
  if ( CTZN.config.citizen.log.file.error || CTZN.config.citizen.log.file.request || CTZN.config.citizen.log.file.status ) {
    try {
      await fsPromises.stat(CTZN.config.citizen.directories.logs)
    } catch ( err ) {
      switch ( err.code ) {
        case 'ENOENT':
          try {
            await fsPromises.mkdir(CTZN.config.citizen.directories.logs)
            console.log('\nCreating log file directory:\n')
            console.log('  ' + CTZN.config.citizen.directories.logs + '\n')
          } catch ( err ) {
            console.log('\ncitizen attempted to create a log file directory, but encountered the following error. Try creating the directory manually and starting the app again.\n')
            console.log(err)
            process.exit()
          }
          break
        default:
          console.log('\ncitizen encountered the following error when trying to read the log file directory:\n')
          console.log(err)
          process.exit()
      }
    }
  }
  // If max log file size is specified, watch files and rename when they hit their limit.
  if ( CTZN.config.citizen.log.file.maxFileSize ) {
    let logOptions = {
      usePolling  : true,
      interval    : CTZN.config.citizen.log.file.watcher.interval,
      useFsEvents : true
    }
    chokidar.watch(CTZN.config.citizen.directories.logs + '/**.log', logOptions).on('change', file => {
      fs.stat(file, (err, stats) => {
        if ( stats.size >= CTZN.config.citizen.log.file.maxFileSize * 1024 ) {
          fs.rename(file, file.replace('.log', '-' + stats.mtimeMs + '.log'), err => {
            if ( err ) {
              helpers.log({
                label: 'There was a problem archiving this log file:',
                content: err
              })
            }
          })
        }
      })
    })
  }

  // Enable hot module reloading in development mode
  if ( CTZN.config.citizen.mode === 'development' ) {
    console.log('\nStarting watcher for hot module reloading:\n')

    const require = createRequire(import.meta.url)
          
    chokidar.watch([
      CTZN.config.citizen.directories.controllers + '/**.js',
      CTZN.config.citizen.directories.controllers + '/**.cjs' ], options).on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension)
        helpers.log({
          label: 'Reinitializing ' + fileName + ' controller\n',
          content: file
        })
        cache.clear({ controller: fileName })
        cache.clear({ scope: 'routes' })
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        if ( extension === '.cjs' ) {
          delete require.cache[require.resolve(file)]
        }
        CTZN.patterns.controllers[fileName] = await import(file + '?v=' + Math.random())
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing this controller:',
          content: err
        })
      }
    })
    chokidar.watch([
      CTZN.config.citizen.directories.models + '/**.js',
      CTZN.config.citizen.directories.models + '/**.cjs'], options).on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension)
        helpers.log({
          label: 'Reinitializing ' + fileName + ' model\n',
          content: file
        })
        cache.clear()
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        if ( extension === '.cjs' ) {
          delete require.cache[require.resolve(file)]
        }
        CTZN.patterns.controllers[fileName] = await import(file + '?v=' + Math.random())
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing this model:',
          content: err
        })
      }
    })
    chokidar.watch([
      CTZN.config.citizen.directories.hooks + '/**.js',
      CTZN.config.citizen.directories.hooks + '/**.js'], options).on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension)
        helpers.log({
          label: 'Reinitializing ' + fileName + ' module\n',
          content: file
        })
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        if ( extension === '.cjs' ) {
          delete require.cache[require.resolve(file)]
        }
        CTZN.appOn[fileName] = await import(file + '?v=' + Math.random())
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing this module:',
          content: err
        })
      }
    })

    console.log('  ' + CTZN.config.citizen.directories.controllers)
    console.log('  ' + CTZN.config.citizen.directories.models)
    console.log('  ' + CTZN.config.citizen.directories.hooks)

    // User-specified watchers
    CTZN.config.citizen.development.watcher.custom.forEach(item => {
      console.log('  ' + CTZN.config.citizen.directories.app + item.watch)
      chokidar.watch([
        CTZN.config.citizen.directories.app + item.watch + '/**.js',
        CTZN.config.citizen.directories.app + item.watch + '/**.cjs'], options).on('change', async file => {
        try {
          let extension = path.extname(file),
              fileName = path.basename(file, extension)
          helpers.log({
            label: 'Reinitializing ' + fileName + ' module\n',
            content: file
          })
          delete require.cache[require.resolve(file)]
          if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
            CTZN.sessions = {}
          }
          if ( extension === '.cjs' ) {
            delete require.cache[require.resolve(file)]
          }
          if ( item.assign ) {
            let app = eval('global.' + item.assign)
            app[fileName] = await import(file + '?v=' + Math.random())
          }
        } catch (err) {
          helpers.log({
            label: 'There was a problem initializing this module:',
            content: err
          })
        }
      })
    })

    console.log('')
  }
}


export const error = async () => {

}
