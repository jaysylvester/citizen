// initialize controllers and models

// node
import fs from 'fs'
import path from 'path'

export const getPatterns = async (config) => {
  var patterns = {
        controllers : {},
        models      : {},
        views       : {}
      },
      controllers = [],
      models      = [],
      views       = [],
      jsRegex     = new RegExp(/.*\.(js)|(cjs)$/),
      viewRegex   = new RegExp(/.+\.(.+)/)

  try {
    controllers = fs.readdirSync(config.citizen.directories.controllers)
    models      = fs.readdirSync(config.citizen.directories.models)
    views       = fs.readdirSync(config.citizen.directories.views)
  } catch ( err ) {
    console.log('There was an error while attempting to traverse the pattern directories. Check your file structure and make sure you have all the required directories (controllers, models, and views).\n')
  }

  console.log('Importing controllers:\n')
  for ( const file of controllers ) {
    if ( jsRegex.test(file) ) {
      console.log('  ' + config.citizen.directories.controllers + '/' + file)
      patterns.controllers[path.basename(file, path.extname(file))] = await import(path.join(config.citizen.directories.controllers, '/', file))
    }
  }

  if ( models.length > 0 ) {
    console.log('\n\nImporting models:\n')
    for ( const file of models ) {
      if ( jsRegex.test(file) ) {
        console.log('  ' + config.citizen.directories.models + '/' + file)
        patterns.models[path.basename(file, path.extname(file))] = await import(path.join(config.citizen.directories.models, '/', file))
      }
    }
  } else {
    console.log('\nNo models found. Skipping...\n')
  }

  console.log('\n\nValidating views:\n')

  views.forEach( function (directory) {
    var viewFiles
    if ( fs.statSync(path.join(config.citizen.directories.views, '/', directory)).isDirectory() ) {
      viewFiles = fs.readdirSync(path.join(config.citizen.directories.views, '/', directory))
      patterns.views[directory] = {}
      viewFiles.forEach( function (file) {
        var filePath,
            fileExtension,
            viewName
        
        if ( viewRegex.test(file) ) {
          console.log('  ' + config.citizen.directories.views + '/' + directory + '/' + file)
          filePath = path.join(config.citizen.directories.views, '/', directory, '/', file)
          fileExtension = path.extname(file)
          viewName = path.basename(file, fileExtension)
          patterns.views[directory][viewName] = {
            path: filePath
          }
        }
      })
    }
  })

  console.log('')

  return patterns
}
