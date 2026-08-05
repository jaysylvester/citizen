// application event hooks

// node
import fs                from 'node:fs'
import fsPromises        from 'node:fs/promises'
import path              from 'node:path'
import { createRequire } from 'node:module'
// citizen
import cache             from '../cache.js'
import helpers           from '../helpers.js'
// third-party
import chokidar          from 'chokidar'


const start = async () => {
  // If file logging is enabled and the specified log directory doesn't exist, create it.
  if ( CTZN.config.logs.access || CTZN.config.logs.error || CTZN.config.logs.debug ) {
    try {
      await fsPromises.stat(CTZN.config.directories.logs)
    } catch ( err ) {
      switch ( err.code ) {
        case 'ENOENT':
          try {
            await fsPromises.mkdir(CTZN.config.directories.logs)
            console.log('\nCreating log file directory:\n')
            console.log('  ' + CTZN.config.directories.logs + '\n')
          } catch ( err ) {
            console.log('\ncitizen attempted to create a log file directory, but encountered the following error. Try creating the directory manually and starting the app again.\n\n')
            console.log(err)
            console.log('\n\nExiting...\n\n')
            process.exit()
          }
          break
        default:
          console.log('\ncitizen encountered the following error when trying to read the log file directory:\n\n')
          console.log(err)
          console.log('\n\nExiting...\n\n')
          process.exit()
      }
    }
  }

  // If max log file size is specified, watch files and rename when they hit their limit.
  if ( CTZN.config.logs.maxFileSize ) {
    chokidar.watch(CTZN.config.directories.logs + '/**.log', CTZN.config.logs.watcher).on('change', file => {
      fs.stat(file, (err, stats) => {
        if ( stats.size >= CTZN.config.logs.maxFileSize * 1024 ) {
          fs.rename(file, file.replace('.log', '-' + stats.mtimeMs + '.log'), err => {
            if ( err ) {
              helpers.log({
                type    : 'error:server',
                label   : 'There was a problem archiving the following log file: ' + file,
                content : err
              })
            }
          })
        }
      })
    })
  }

  // Enable hot module reloading in development mode
  if ( CTZN.config.mode === 'development' ) {
    const require = createRequire(import.meta.url)
    
    console.log('\nStarting watcher for hot module replacement:\n')

    // Hooks
    console.log('  ' + CTZN.config.directories.controllers + '/hooks')
    const hookWatch = chokidar.watch(CTZN.config.directories.controllers + '/hooks', CTZN.config.development.watcher)

    hookWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        helpers.log({
          label: 'Hook reinitialized: ' + fileName,
          content: file
        })
        if ( CTZN.sessions && CTZN.config.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.controllers.hooks[fileName] = await import(file + '?v=' + cacheBuster)
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following module: \n\n' + file,
          content: err
        })
      }
    })
    
    // Route controllers
    console.log('  ' + CTZN.config.directories.controllers + '/routes')
    const controllerWatch = chokidar.watch(CTZN.config.directories.controllers + '/routes', CTZN.config.development.watcher)

    controllerWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        if ( CTZN.sessions && CTZN.config.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.controllers.routes[fileName] = await import(file + '?v=' + cacheBuster)
        helpers.log({
          label: 'Controller reinitialized: ' + fileName,
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following controller: \n\n' + file,
          content: err
        })
      }
    })

    // Helpers
    console.log('  ' + CTZN.config.directories.helpers)
    const helperWatch = chokidar.watch(CTZN.config.directories.helpers, CTZN.config.development.watcher)

    helperWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        helpers.log({
          label: 'Helper reinitialized: ' + fileName,
          content: file
        })
        if ( CTZN.sessions && CTZN.config.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.helpers[fileName] = await import(file + '?v=' + cacheBuster)
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following module: \n\n' + file,
          content: err
        })
      }
    })

    // Models
    console.log('  ' + CTZN.config.directories.models)
    const modelWatch = chokidar.watch(CTZN.config.directories.models, CTZN.config.development.watcher)

    modelWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        if ( CTZN.sessions && CTZN.config.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.models[fileName] = await import(file + '?v=' + cacheBuster)
        helpers.log({
          label: 'Model reinitialized: ' + fileName,
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following model: \n\n' + file,
          content: err
        })
      }
    })

    // Views
    console.log('  ' + CTZN.config.directories.views)
    const viewWatch = chokidar.watch(CTZN.config.directories.views, CTZN.config.development.watcher)

    viewWatch.on('change', async file => {
      try {
        let pattern = file.replace(/.+\/views\/([A-Za-z0-9-_+]+)\/[A-Za-z0-9-_+]+\.[A-Za-z]+$/g, '$1'),
            extension = path.extname(file),
            fileName = path.basename(file, extension)

        cache.clear()

        // If there's no matching pattern, it's a view file in the views directory.
        if ( pattern === file ) {
          CTZN.views[fileName] = {
            path: file
          }
        } else {
          CTZN.views[pattern][fileName] = {
            path: file
          }
        }

        if ( CTZN.config.templateEngine !== 'templateLiterals' ) {
          let consolidate = await import('@ladjs/consolidate')
          try {
            await consolidate[CTZN.config.templateEngine](CTZN.views[fileName]?.path || CTZN.views[pattern][fileName].path, { cache: false })
          } catch (err) {
            helpers.log({
              label: 'There was a problem reinitializing the following view: \n\n' + fileName,
              content: err
            })
          }
        }

        helpers.log({
          label: 'View reinitialized: ' + fileName,
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following view: \n\n' + file,
          content: err
        })
      }
    })

    // User modules
    CTZN.config.development.watcher.custom.forEach(item => {
      console.log('  ' + CTZN.config.directories.app + item.watch)
      const customWatch = chokidar.watch(CTZN.config.directories.app + item.watch, CTZN.config.development.watcher)

      customWatch.on('change', async file => {
        try {
          let extension = path.extname(file),
              fileName = path.basename(file, extension),
              cacheBuster = Date.now()

          cache.clear()
          helpers.log({
            label: 'Module reinitialized: ' + fileName,
            content: file
          })
          delete require.cache[require.resolve(file)]
          if ( CTZN.sessions && CTZN.config.development.watcher.killSession ) {
            CTZN.sessions = {}
          }
          delete require.cache[require.resolve(file)]
          if ( item.assign ) {
            let app = eval('global.' + item.assign)
            app[fileName] = await import(file + '?v=' + cacheBuster)
          }
        } catch (err) {
          helpers.log({
            label: 'There was a problem reinitializing the following module: \n\n' + file,
            content: err
          })
        }
      })
    })

    // Static assets
    if ( CTZN.config.cache.static.enabled ) {
      const staticWatch = chokidar.watch(CTZN.config.directories.web, CTZN.config.development.watcher)

      staticWatch.on('change', async file => {
        cache.clear({ file: file })
      })
    }

    console.log('')
  }

  // Fire the app's application start hook
  if ( CTZN.controllers.hooks.application?.start ) {
    await CTZN.controllers.hooks.application.start(CTZN.config)
  }
}


const error = async (err, params, request, response, context) => {
  if ( CTZN.controllers.hooks.application?.error ) {
    await CTZN.controllers.hooks.application.error(err, params, request, response, context)
  }
}


export default { start, error }
