// initialize routes and models

// node
import fs   from 'node:fs'
import path from 'node:path'


const getHooks = async (hookPath) => {
  let models = {},
      modelFiles = [],
      regex = new RegExp(/.*\.(c|m)?(js)$/)

  console.log('Importing event hooks:\n')

  try {
    modelFiles = fs.readdirSync(hookPath)
    if ( modelFiles.length ) {
      let count = 0
      for ( const file of modelFiles ) {
        if ( regex.test(file) ) {
          count++
          console.log('  ' + hookPath + '/' + file)
          models[path.basename(file, path.extname(file))] = await import(path.join(hookPath, '/', file))
        }
      }
      if ( !count ) {
        console.log('  No event hooks found.')
      }
    } else {
      console.log('  No event hooks found.')
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('  No event hooks found.')
        break
      default:
        console.log('  There was an error while attempting to traverse the event hooks directory (' + hookPath + ').\n')
        console.log(err)
        process.exit()
    }
  }

  return models
}


const getRoutes = async (routePath) => {
  let routes = {},
      routeFiles = [],
      regex = new RegExp(/.*\.(c|m)?(js)$/)
      
  console.log('\n\nImporting routes:\n')

  try {
    routeFiles = fs.readdirSync(routePath)
    if ( routeFiles.length ) {
      let count = 0
      for ( const file of routeFiles ) {
        if ( regex.test(file) ) {
          count++
          console.log('  ' + routePath + '/' + file)
          routes[path.basename(file, path.extname(file))] = await import(path.join(routePath, '/', file))
        }
      }
      if ( !count ) {
        console.log('  No routes found. citizen requires at least one route in the route directory (' + routePath + ').\n')
        process.exit()
      }
    } else {
      console.log('  No routes found. citizen requires at least one route in the route directory (' + routePath + ').\n')
      process.exit()
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('  No routes found. citizen requires at least one route in the route directory (' + routePath + ').\n')
        process.exit()
        break
      default:
        console.log('  There was an error while attempting to traverse the route directory (' + routePath + ').\n')
        console.log(err)
        console.log('/n')
        process.exit()
    }
  }

  return routes
}


const getHelpers = async (helperPath) => {
  let helpers = {},
      helperFiles = [],
      regex = new RegExp(/.*\.(c|m)?(js)$/)

  console.log('\n\nImporting helpers:\n')

  try {
    helperFiles = fs.readdirSync(helperPath)
    if ( helperFiles.length ) {
      let count = 0
      for ( const file of helperFiles ) {
        if ( regex.test(file) ) {
          count++
          console.log('  ' + helperPath + '/' + file)
          helpers[path.basename(file, path.extname(file))] = await import(path.join(helperPath, '/', file))
        }
      }
      if ( !count ) {
        console.log('  No helpers found.')
      }
    } else {
      console.log('  No helpers found.')
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('  No helpers found.')
        break
      default:
        console.log('  There was an error while attempting to traverse the helpers directory (' + helperPath + ').\n')
        console.log(err)
        process.exit()
    }
  }

  return helpers
}


const getModels = async (modelPath) => {
  let models = {},
      modelFiles = [],
      regex = new RegExp(/.*\.(c|m)?(js)$/)

  console.log('\n\nImporting models:\n')

  try {
    modelFiles = fs.readdirSync(modelPath)
    if ( modelFiles.length ) {
      let count = 0
      for ( const file of modelFiles ) {
        if ( regex.test(file) ) {
          count++
          console.log('  ' + modelPath + '/' + file)
          models[path.basename(file, path.extname(file))] = await import(path.join(modelPath, '/', file))
        }
      }
      if ( !count ) {
        console.log('  No models found.')
      }
    } else {
      console.log('  No models found.')
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('  No models found.')
        break
      default:
        console.log('  There was an error while attempting to traverse the model directory (' + modelPath + ').\n')
        console.log(err)
        process.exit()
    }
  }

  return models
}


const getViews = async (viewPath) => {
  let views = {},
      viewFiles = [],
      regex = new RegExp(/.+\.(.+)/)
  
  console.log('\n\nValidating views:\n')

  try {
    viewFiles = fs.readdirSync(viewPath)
    if ( viewFiles.length ) {
      for ( const itemPath of viewFiles ) {
        let viewFiles, filePath, fileExtension, viewName
        if ( fs.statSync(path.join(viewPath, '/', itemPath)).isDirectory() ) {
          viewFiles = fs.readdirSync(path.join(viewPath, '/', itemPath))
          views[itemPath] = {}
          for ( const file of viewFiles ) {
            let filePath,
                fileExtension,
                viewName
            
            if ( regex.test(file) ) {
              console.log('  ' + viewPath + '/' + itemPath + '/' + file)
              filePath = path.join(viewPath, '/', itemPath, '/', file)
              fileExtension = path.extname(file)
              viewName = path.basename(file, fileExtension)
              views[itemPath][viewName] = {
                path: filePath
              }
            }
          }
        } else if ( regex.test(itemPath) ) {
          console.log('  ' + viewPath + '/' + itemPath)
          filePath = path.join(viewPath, '/', itemPath)
          fileExtension = path.extname(itemPath)
          viewName = path.basename(itemPath, fileExtension)
          views[viewName] = {
            path: filePath
          }
        }
      }
    } else {
      console.log('  No views found.')
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('  No views found.')
        break
      default:
        console.log('  There was an error while attempting to traverse the view directory (' + viewPath + ').\n')
        console.log(err)
        process.exit()
    }
  }

  console.log('')

  return views
}


export default { getHelpers, getHooks, getModels, getRoutes, getViews }
