// router

// node
import fs from 'node:fs/promises'


const staticMimeTypes = JSON.parse(
  await fs.readFile(
    new URL('../config/mimetypes.json', import.meta.url)
  )
)


// pathname is necessary for citizen includes, which can be invoked using a URL-compliant route
const parseRoute = (request, protocol, pathname) => {
  const url = new URL( ( ( request.headers.forwardedParsed?.proto || request.headers['x-forwarded-proto'] || protocol ) + '://' ) + ( request.headers.forwardedParsed?.host || request.headers['x-forwarded-host'] || request.headers.host ) + ( pathname || request.url ) ),
        publicControllerRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
        directRequestRegex = /^\/_([A-Za-z0-9-_]+)\/?.*/,
        staticRegex = /^\/.*\.([A-Za-z0-9-_]+)$/
      
  let route = {}

  if ( !staticMimeTypes[url.pathname.replace(staticRegex, '$1')] ) {
    route = {
      url           : url.href,
      parsed        : url,
      base          : url.protocol + '//' + url.host,
      pathname      : url.pathname,
      protocol      : url.protocol.replace(':', ''),
      urlParams     : getUrlParams(url.pathname),
      chain         : {}
    }

    if ( publicControllerRegex.test(url.pathname) ) {
      route.controller = url.pathname.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1')
    } else {
      route.controller = 'index'
    }

    route.action     = route.urlParams.action || 'handler'
    route.descriptor = route.urlParams[route.controller] || ''
    route.direct     = directRequestRegex.test(url.pathname) || route.urlParams.direct || false
  } else {
    route = {
      url       : url.href,
      pathname  : url.pathname,
      filePath  : url.pathname,
      extension : url.pathname.replace(staticRegex, '$1'),
      isStatic  : true
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
