// router

// node
import fs  from 'fs/promises'
import url from 'url'


const staticMimeTypes = JSON.parse(
  await fs.readFile(
    new URL('../config/mimetypes.json', import.meta.url)
  )
)


const getRoute = (request, protocol, pathname) => {
  let urlToParse = ( ( request.headers['x-forwarded-proto'] || protocol ) + '://' ) + ( request.headers['x-forwarded-host'] || request.headers.host ) + ( pathname || request.url ),
      parsed = url.parse(urlToParse),
      pathToParse = url.parse(urlToParse).pathname.replace(/\/\//g, '/'),
      publicControllerRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
      staticRegex = /^\/.*\.([A-Za-z0-9-_]+)$/,
      route = {
        parsed        : parsed,
        base          : parsed.protocol + '//' + parsed.host,
        isStatic      : false,
        pathname      : pathToParse,
        protocol      : parsed.protocol.replace(':', ''),
        url           : parsed.href
      }

  if ( !staticMimeTypes[pathToParse.replace(staticRegex, '$1')] ) {
    if ( publicControllerRegex.test(pathToParse) ) {
      route.controller = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1')
    } else {
      route.controller = 'index'
    }

    if ( !CTZN.patterns.controllers[route.controller] && CTZN.config.citizen.fallbackController ) {
      route.controller = CTZN.config.citizen.fallbackController
    }

    route.urlParams  = getUrlParams(route.pathname)
    route.action     = route.urlParams.action || 'handler'
    route.descriptor = route.urlParams[route.controller] || ''
    route.direct     = route.urlParams.direct || false

    route.chain = {}
    route.chain[route.controller] = {
      controller : route.controller,
      action     : route.action
    }
  } else {
    route = {
      extension : pathToParse.replace(staticRegex, '$1'),
      filePath  : url.parse(urlToParse).pathname,
      isStatic  : true,
      pathname  : pathToParse,
      url       : parsed.href
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
