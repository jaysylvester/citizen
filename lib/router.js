// router

// node
import fs  from 'fs/promises'
import url from 'url'


const staticMimeTypes = JSON.parse(
  await fs.readFile(
    new URL('../config/mimetypes.json', import.meta.url)
  )
)


const getRoute = (urlToParse) => {
  var parsed = url.parse(urlToParse),
      pathToParse = url.parse(urlToParse).pathname.replace(/\/\//g, '/'),
      publicControllerRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
      staticRegex = /^\/.*\.([A-Za-z0-9-_]+)$/,
      route = {
        parsed        : parsed,
        url           : parsed.href,
        protocol      : parsed.protocol.replace(':', ''),
        pathname      : pathToParse,
        controller    : 'index',
        action        : 'handler',
        chain         : {},
        renderer      : 'index',
        descriptor    : '',
        view          : 'index',
        renderedView  : 'index',
        direct        : false,
        isStatic      : false
      }

  if ( !staticMimeTypes[pathToParse.replace(staticRegex, '$1')] ) {
    if ( CTZN.config.citizen.urlPaths.app !== '/' ) {
      pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '')
    }

    if ( publicControllerRegex.test(pathToParse) ) {
      route.controller = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1')
    }

    if ( !CTZN.patterns.controllers[route.controller] && CTZN.config.citizen.fallbackController.length ) {
      route.controller = CTZN.config.citizen.fallbackController
    }

    route.urlParams = getUrlParams(route.pathname)

    route.action = route.urlParams.action || route.action
    route.direct = route.urlParams.direct || route.direct

    route.chain[route.controller] = {
      controller : route.controller,
      action     : route.action,
      view       : route.controller
    }

    route.renderer            = route.controller
    route.view                = route.controller
    route.renderedView        = route.controller
    route.descriptor          = route.urlParams[route.controller] || ''
  } else {
    route = {
      url       : parsed.href,
      pathname  : pathToParse,
      filePath  : url.parse(urlToParse).pathname,
      extension : pathToParse.replace(staticRegex, '$1'),
      isStatic  : true
    }

    if ( CTZN.config.citizen.urlPaths.app !== '/' && route.filePath.indexOf(CTZN.config.citizen.urlPaths.app) === 0 ) {
      route.filePath = route.filePath.replace(CTZN.config.citizen.urlPaths.app, '')
    }
  }

  return route
}


const getUrlParams = (urlToParse) => {
  var pathToParse     = url.parse(urlToParse).pathname.replace(/\/\//g, '/'),
      paramsRegex     = /\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^/]+\/?$/,
      parameterNames  = [],
      parameterValues = [],
      urlParams       = {}

  if ( CTZN.config.citizen.urlPaths.app !== '/' ) {
    pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '')
  }

  while ( paramsRegex.test(pathToParse) ) {
    parameterNames.unshift(pathToParse.replace(/.*\/([A-Za-z-_]+[A-Za-z0-9-_]*)\/[^/]+\/?$/, '$1'))
    parameterValues.unshift(pathToParse.replace(/.*\/[A-Za-z-_]+[A-Za-z0-9-_]*\/([^/]+)\/?$/, '$1'))
    pathToParse = pathToParse.replace(/(.*)\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^/]+\/?$/, '$1')
  }

  for ( var i = 0; i < parameterNames.length; i++ ) {
    urlParams[parameterNames[i]] = parameterValues[i]
  }

  return urlParams
}


export default { getRoute, getUrlParams, staticMimeTypes }
