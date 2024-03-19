// router

// node
import fs  from 'fs/promises'


const staticMimeTypes = JSON.parse(
  await fs.readFile(
    new URL('../config/mimetypes.json', import.meta.url)
  )
)


// pathname is necessary for citizen includes, which can be invoked using a URL-compliant route
const parseRoute = (request, protocol, pathname) => {
  const url = new URL( ( ( request.headers['x-forwarded-proto'] || protocol ) + '://' ) + ( request.headers['x-forwarded-host'] || request.headers.host ) + ( pathname || request.url ) ),
        publicControllerRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
        staticRegex = /^\/.*\.([A-Za-z0-9-_]+)$/
      
  let route = {}

  if ( !staticMimeTypes[url.pathname.replace(staticRegex, '$1')] ) {
    route = {
      parsed        : url,
      base          : url.protocol + '//' + url.host,
      isStatic      : false,
      pathname      : url.pathname,
      protocol      : url.protocol.replace(':', ''),
      url           : url.href
    }

    if ( publicControllerRegex.test(url.pathname) ) {
      route.controller = url.pathname.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1')
    } else {
      route.controller = 'index'
    }

    if ( !CTZN.patterns.controllers[route.controller] && CTZN.config.citizen.fallbackController ) {
      route.controller = CTZN.config.citizen.fallbackController
    }

    route.urlParams  = getUrlParams(url.pathname)
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
      extension : url.pathname.replace(staticRegex, '$1'),
      filePath  : url.pathname,
      isStatic  : true,
      pathname  : url.pathname,
      url       : url.href
    }
  }

  return route
}


const getUrlParams = (pathName) => {
  var paramsRegex     = /\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^/]+\/?$/,
      parameterNames  = [],
      parameterValues = [],
      urlParams       = {}

  while ( paramsRegex.test(pathName) ) {
    parameterNames.unshift(pathName.replace(/.*\/([A-Za-z-_]+[A-Za-z0-9-_]*)\/[^/]+\/?$/, '$1'))
    parameterValues.unshift(pathName.replace(/.*\/[A-Za-z-_]+[A-Za-z0-9-_]*\/([^/]+)\/?$/, '$1'))
    pathName = pathName.replace(/(.*)\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^/]+\/?$/, '$1')
  }

  for ( var i = 0; i < parameterNames.length; i++ ) {
    urlParams[parameterNames[i]] = parameterValues[i]
  }

  return urlParams
}


export default { parseRoute, getUrlParams, staticMimeTypes }
