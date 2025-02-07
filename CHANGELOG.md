# 1.0.2
* Rewrote config init to accommodate an empty config directory error
* README updates and fixes

# 1.0.1
* Fixed an unhandled promise rejection caused by trying to set session variables when no session is present
* Minor README and development log tweaks

# 1.0.0

## New features:
* ES module support
* Route controllers and actions have their own config that extends the global config

## Enhancements/fixes:
* citizen checks for the `NODE_ENV` environment variable and sets its mode accordingly
  * If `NODE_ENV` is undefined, citizen defaults to production mode
  * Setting the mode manually in your citizen configuration overrides `NODE_ENV`
* Hot module replacement now works with the app cache enabled
  * Caching is now enabled by default to maintain consistency between development and production environments, but can still be disabled manually via the config for debugging purposes
* Log files are split into `access.log`, `error.log`, and `debug.log` and can be enabled independently
  * If running only a single citizen app server instance, access logs will likely affect performance
  * Debug logs mimic development mode console logs, thus are extremely verbose and peformance-intensive
  * Client (`400`) and server (`500`) error logs can be enabled/disabled independently
* citizen now uses the HTTP `Accept` header to determine the response format
  * Supported response types are `text/html`, `text/plain`, `application/json`, and `application/javascript` (JSON-P)
* `app.log()` will attempt to create the logs directory if it doesn't already exist
* Handling of 500 errors can be configured
  * `capture` (default) will write the error to the log, render an error view to the client, and keep the process/server running
  * `exit` will send a 500 to the client without rendering a view, write the error to the log, throw the error, then exit the process
* The previously required `x-citizen-uri` header for routing behind proxy servers is deprecated in favor of industry standard `Forwarded` headers
  * `X-Forwarded` header support has been deprecated and will be removed from future versions
* Previously reserved URL parameters (`type`, `ajax`, `show`, and `task`) have been released for dev use
* JSON requests now provide the local context of the entire controller chain and all includes in the response
* `app.cache.set()` now automatically expires/clears the specified cache key if it already exists and creates a new cache item rather than throwing an error
* The file watcher, which relies upon chokidar, now accepts all settings available in chokidar via a new options configuration
  * Please reference the chokidar documentation for available options if your environment requires customizations (`usePolling` for networked file systems, for example)
* The `next` directive (previously `handoff`) now accepts a route pathname similar to the include route pathname, which allows simulating a different route when handing off to the next controller in the chain
* Views no longer require subfolders
  * Old pattern (still supported): views for a given route controller go within a folder matching that controller name, with the default view also matching the controller name
  * New pattern: views can reside within the main views folder directly, with the default view for a controller matching the controller name, so controllers with a single view no longer require a subfolder
* Request and controller action caching are bypassed in the event of an application (500) error

## Breaking changes
* New default directory structure, but you can keep the old structure by editing the directory config
* The default rendering engine is now based on template literals, and [consolidate](https://github.com/ladjs/consolidate) is no longer included as a dependency by default
  * To use another template engine, install [consolidate](https://github.com/ladjs/consolidate) and your preferred package (handlebars, pug, etc.), then update `config.citizen.templateEngine` with the package name
* The `handoff` directive has been renamed to `next`
* The `route` property has been removed from the `include` directive
  * Route controller includes now accept a pathname string as shorthand for an included route
* Controller and request cache directives have changed in format and functionality
  * Cache directive properties are now `action` (formerly `controller`) and `request` (formerly `route`)
  * Cache `request` only applies if the controller action in which it's called is the action specified in the original request; subsequent controllers in the chain can no longer prompt a request cache
* The `/type/direct` URL parameter used to bypass controller handoff has been replaced with `/direct/true`
* The `/direct/true` URL parameter is no longer required to bypass the controller chain
  * Follow the partial naming convention by putting an underscore (`_`) at the beginning of the controller file name, and when requested from the client it will be rendered directly
  * `/direct/true` is still available to force controllers to bypass the chain
* The server `request.start()` event now fires before checking if the controller exists
  * This is logically consistent with the intention behind `request.start()` (i.e., it fires at the start of the request)
  * This allows you to incorporate logic into `request.start()` even if the requested controller doesn't exist (custom 404 handling, for example)
  * This is considered a breaking change because the `request.start()` context won't inherit the controller config like it did previously, so if you depend on anything in your controller config within the `request.start()` event, that functionality should be moved to the controller action itself, which fires after `request.start()`
* All instances of the `enable` property in the config have been renamed to `enabled`
* The `sessions` configuration setting is now an object that takes two arguments:
  * `enabled` (boolean)
  * `lifespan` (integer) - Reflects session timeout in minutes and replaces the old `sessionTimeout` property, which has been removed
* `session.end()` now requires an object containing `key` and `value` properties to end a session
* The `form` configuration setting has been renamed to `forms`
  * The dependency on formidable has been removed and replaced with basic native form parsing, see the docs for settings/options
  * Third-party form processors can still be used within hooks and controllers by accessing Node's native request object, which is passed to each hook and controller as an argument
* The `log` configuration setting has been renamed to `logs`
  * It now only applies to file logging, which can be enabled in development or production mode
  * Console debug logging is automatically enabled in development mode
* The `urlPaths` configuration option has been removed
  * It never worked reliably, and this sort of thing should really be handled by a proxy anyway
* The `content` directive, which contains all data local to the controller/view, has been renamed to `local`
  * Local variables within views should reference the local namespace (local.myVar)
* The `legalFormat` config option is now `contentTypes`
  * `contentTypes` is an array that lists available output MIME types ("text/html", "text/plain", "application/json", "application/javascript")
* The `legalFormat` directive has been removed
  * The new controller config mentioned above accepts the `contentTypes` option for setting available formats within a controller/action
* The `format` URL parameter (/format/json, etc.) has been removed
  * To request different output formats, the client must set the HTTP `Accept` request header to the desired content type (currently supported: `text/html`, `text/plain`, `application/json`, `application/javascript`)
* The request and response objects have been separated from the params object and are now passed into controllers as separate arguments
* `params.route` no longer contains the view, but it was wrong half the time anyway
  * You can reference `params.route.chain` for all controllers in the chain, including their actions, views, and context
* `params.route.parsed.path` is now `params.route.parsed.pathname` or `params.route.pathname`
* Controller action CORS configuration has been incorporated into the new controller/action configuration feature
* The `output` URL parameter for JSON requests has been removed
  * It added processing time and made view rendering more complex
  * The solutions to the problem solved by `output` include accessing controllers directly (underscore naming convention or `/direct/true`) and better API design in the first place
* JSON requests are now namespaced using the route controller name
  * A request that would have returned { "foo": "bar" } previously will now return { "index" : { "foo": "bar" } }
* The cache.set() overwrite option has been removed, as has the error/warning that occurred when attempting to overwrite existing cache items
* The file watcher options have changed to match chokidar's options, so adjust accordingly
* The `ctzn_debug` URL parameter is now a boolean that enables debug output in the view
  * Use the `ctzn_inspect` URL parameter to specify the variable you want to dump to the view
* The undocumented `fallbackController` option has been removed because there are better ways to handle a nonexistent controller in the app itself (citizen now returns a 404 by default)

# 0.9.2
* Moved commander to dependencies

# 0.9.1
* Added SameSite cookie attribute to the cookie directive (defaults to "Lax" as recommended by the spec)
* Fixed broken debug output
* Removed public helper methods that were deprecated in 0.8.0 and supposed to have been removed in 0.9.0
* Fixed typos in README
* Better handling of connections closed by client

# 0.9.0
  New features:
* async-await support in controller actions
* Hot module reloading for controllers and models in development mode

  BREAKING CHANGES (see readme for details)
* Controller actions are now called as async functions, so you should use async-await syntax
* Thanks to the above, the manual passing of event emitters to return results and errors is no longer supported and has been removed (simple return and throw statements do the job now). This is a major breaking change that will require you to rewrite all your controllers and any function calls to which you pass the emitter. While this could be a massive headache depending on the size of your app, it's unquestionably an improvement, with simpler syntax and no clunky emitter handling.
* All helpers deprecated in 0.8.0 have been removed
* The syntax for the formats directive has been simplified and it has been renamed to "legalFormat" to distinguish it from the format url parameter
* The urlDelimiter option has been removed from JSON output (the delimiter is now a comma, because if you use a comma in a JSON key, you're insane)
* The headers directive has been renamed to "header", keeping the grammar consistent with other directives (cookie, session, etc.)
* Form configuration now has both a global config (set within your config file) and controller-action config (a new `config` object set within the controller module exports); syntax has changed from the previous global setting and maxFieldSize is now specified in kilobytes rather than megabytes
* CORS controller settings are under the new `config` module export
* Functionality previously under the debug mode has been moved to development mode and debug has been removed
* Log configuration has been streamlined and consolidated, with some log settings previously under the debug settings now moved to logs
* Invalid URL parameters in controller and route caches now always throw an error, but don't prevent rendering
* The directory for app event handlers has been renamed from "/on" to "/hooks".

# 0.8.8
* Fixed another bug in route cache retrieval

# 0.8.7
* Fixed a bug in route cache retrieval
* Tweaked readme

# 0.8.6
* Added request context to console output in the event of an error to assist with debugging
* Relaxed requirements on the route descriptor to allow dot (.) and tilde (~) characters
* Added event handler for connections closed by the client

# 0.8.5
* Added custom header check (x-citizen-uri) to provide the original requested URL to citizen when behind a proxy (nginx, apache, etc.), which fixes issues with ctzn_referer and secure cookies

# 0.8.4
* Fixed a bug in static file serving that caused initial requests for compressed static files to fail

# 0.8.3
* Removed unnecessary copy() on file cache retrieval, which was causing static file serving to bomb out

# 0.8.2
* Preserve dates when copying objects

# 0.8.1
* Further fixes to copy() and extend(). Circular references are no longer supported, however.
* Removed a lot of unnecessary and complex copy() and extend() calls for a noticeable performance boost. There's less protection now against bad behavior (modifying param.session directly within controllers, for example), so if you access the params argument directly...test thoroughly :)

# 0.8.0
* BREAKING CHANGES (see readme for details):
  * Updated dependencies to latest versions
  * The built-in Jade and Handlebars template engines have been replaced with consolidate.js (https://github.com/tj/consolidate.js). Simply install your preferred engine, add it to your dependencies, and set the "templateEngine" config setting. Handlebars is included by default.
  * Config change: the server "hostname" setting has been changed to "host" so as to avoid confusion with the HTTP/HTTPS server hostname settings
  * The copy() and extend() helpers have been updated for improved accuracy within the framework, which means some bad behavior that was tolerated previously will no longer work. Please test any code that relies on these methods to ensure it still behaves as expected.
  * CORS support has been enhanced to provide unique attributes to each controller action, so the notation in the controller has changed
  * Cache-Control settings for cached routes should now be handled using the new HTTP Header directive rather than route.cache.control
* Deprecations
  * All helpers except for cache() and log() have been deprecated and will be removed from the public app scope in 0.9.0. Any of the deprecated helpers can be replaced by native functionality (Promises in place of listen() for example) or a third-party library. cache() and log() are still pretty nice though (imho), so I'm keeping them public.

# 0.7.19
* Deprecations (these items will no longer be supported by citizen as of v0.8.0):
  * The "access" module export that enables CORS support at the controller level will be replaced with a "headers" directive that works at the controller action level.
  * The developers of Jade have renamed the project to Pug with all new updates being performed under the Pug name. citizen will drop support for Jade and replace it with the new Pug engine. There are a few breaking changes in Pug: https://github.com/pugjs/pug/issues/2305
* Fixed an issue where "Accept-Encoding: gzip;q=0" would still provide gzip encoding because it was the only encoding specified (encoding now defaults to identity)
* Official minimum node version has been bumped to 6.11.x

# 0.7.18
* Opinion: See 0.7.17.

# 0.7.17
* Opinion: requiring minor version bumps because of readme updates is stupid.

# 0.7.16
* The accepting-encoding parser has been rewritten to be conformant
* The compression engine has been rewritten to support deflate
* A potentially breaking change: The default configuration has been changed to disable JSON and JSONP global output by default, which is safer. You can enable each one individually in the global config, causing all controllers to allow output in those formats, or enable JSON or JSONP output at the controller level using the new "formats" parameter.
* HTML output can now be disabled completely at the global config level or controller level
* Pretty output for HTML and JSON is now driven by the framework mode rather than config values. In debug and development modes, output is pretty. In production mode, output is ugly (minified).

# 0.7.15
* Added referrer ("referer") to error log, because it's helpful

# 0.7.14
* Fixed app crashes caused by non-request related errors (packages running in the background, for example)

# 0.7.13
* Added the session scope to the beginning of the request chain, making it available within the application request event

# 0.7.12
* Fixed a bug masked by the previous cache bug, which caused a timer to be set even if lifespan was set to "application"

# 0.7.11
* Fixed a bug that caused a cache error when lifespan is set to "application" and tweaked the readme to reflect new cache defaults

# 0.7.10
* Fixed a bug in the previous update that caused it not to work at all :)

# 0.7.9
* The server requestStart event now fires before the sessionStart event, which is a more logical execution order. A 404 (missing controller and/or action) initiated by a third party referrer will no longer create an orphaned session, for example. This also allows custom handling of missing controllers and actions in the request.js start() action (like issuing a permanent redirect to a different controller or action, for example).

# 0.7.8
* Cache-Control headers specified in the config (cache.control) now support regular expressions. You can provide either an exact match to the resource's pathname (the previous functionality) or a regex that matches many assets. You can mix the two. Also corrected the readme, which had an incorrect example for route Cache-Control.
* Server errors now include the remote host

# 0.7.7
* The server now throws an error if the view specified in a controller handoff doesn't exist. Previously, it failed silently and rendered the final view without the handoff view contents.

# 0.7.6
* Fixed a bug that always enabled the static cache (introduced in 0.7.4 with the new cache config defaults)

# 0.7.5
* Improved cache and session performance by getting rid of the creation of new timers with every request or cache hit and using a lastAccessed attribute for the existing timer to validate against (see https://github.com/jaysylvester/citizen/issues/31)

# 0.7.4
* BREAKING CHANGE: Added default cache config options for both application and static asset caches, breaking previous config settings. The new defaults enable a reasonable cache lifespan (15 minutes), preventing issues like cached static assets from growing over time and taking up memory even if they're not being accessed regularly. Previously, enabling the static cache kept all static assets in memory for the life of the application. Consult the readme for details.
* Improved server error handling, making apps more resilient to fatal errors and avoiding app crashes

# 0.7.3
* BREAKING CHANGES (These were intended for 0.7.0, but were lost in the merge and I missed it. Sorry for the breakage in a point release.):
  * All config options can now be overwritten at app startup, including config settings in your own namespaces. This breaks the HTTP and HTTPS overwrite options that were available previously.
  * By default, app.start() starts an HTTP server. To start an HTTPS server, you must enable it manually inline or via a config file and provide key/cert/pfx files. You can disable HTTP entirely via config as well. Consult the readme for details.
  * HTTPS key/cert/pfx files should now be passed as a string representing the path to the file, not the contents of the files themselves. citizen reads these files itself now.

# 0.7.2
* Removed errant console.log() from the server module

# 0.7.1
* Fixed a bug in the cache module that caused an error when attempting to clear the file cache

# 0.7.0
* Cache methods have been renamed and moved to their own namespace (app.cache). The old calls and their new equivalents are:
  * app.cache()    -> app.cache.set()
  * app.retrieve() -> app.cache.get()
  * app.exists()   -> app.cache.exists()
  * app.clear()    -> app.cache.clear()
* Fixe a bug in cache.get() that returned the parent of the specified scope rather than the scope itself when requesting an entire scope. This will break existing calls to cache.get({ scope: 'myScopeName' })
* Cache lifespan should now be specified in minutes instead of milliseconds -> app.cache.set({ key: 'myKey', lifespan: 15 })
* Config settings for sessionTimeout and requestTimeout should now be specified in minutes instead of milliseconds -> sessionTimeout: 20
* Cookie expiration should now be specified in minutes instead of milliseconds
* Added global cache setting to enable/disable cache in any mode
* Added layout pattern setting to the config, which allows you to specify a default controller/view pairing as a layout controller and skip the handoff directive in the requested controller
* Added per-controller form settings in the config, which breaks the previous form config method.
* Added individual settings for application and static asset error and status logging. For example, you can now log application error messages in production mode without also logging static errors (404) or the typically verbose framework status messages.
* listen() now accepts a single argument consisting of an object containing functions (flow and callback are optional)
* Added ability to end a specific user session based on a session property key/value pair using app.session.end('key', 'value')
* Specifying { view: false } in a controller's emitter during a handoff skips rendering of that controller's default view
* All citizen-scoped cookie and session variables (starting with "ctzn") have been changed to "ctzn_camelCase" format (ctznReferer is now ctzn_referer).
* dashes(), isInteger(), and isFloat() have been removed from helpers. There are libraries better suited for this.

# 0.6.9
* Added listen() skip and end events to the readme.
* Methods skipped in listen() by a previous method throwing an error now have their statuses correctly set to "skipped" in output.listen.status

# 0.6.8
* The listen() error event has been returned to its previous behavior of throwing its own error. Without this, debugging is pretty much impossible. citizen's behavior remains the same, however (errors are not allowed to bubble up to the node process, so the app doesn't crash). You should still be using listen.success and listen.status to handle errors properly though.
* BREAKING CHANGE: All URL parameters are now cast as strings, including numeric values. There are too many complicating factors in JavaScript's handling of numbers (floats, large integers) for citizen to make assumptions regarding the desired type. For example, "0123" is numeric and would have been stored as "123" under the previous convention; if your app was expecting the leading zero to remain intact, that would be bad. New convenience functions have been added (isInteger and isFloat) to assist in dealing with numbers.
* The dashes() helper has been deprecated. It's still there, but will be gone in version 0.7.0. There are much more fully-featured URL slug packages available, and since citizen doesn't use this helper internally, there's no sense in keeping it.

# 0.6.7
* Further stabilization of the error API.

# 0.6.6
* Error handling has been further improved. See "Handling Errors" in the readme. Changes include:
  * Error response formats now match the requested route format (HTML, JSON, or JSONP), which is potentially a breaking change depending on how you've been handling errors up to this point.
  * The listen() error and timeout events no longer throw errors themselves, which is potentially a breaking change if you were relying on these thrown errors previously. You should now use the listen() status output (output.listen) for dealing with the results of these events.

# 0.6.5
* Added an error event to the listen() emitter. Any methods that rely on emitters (including your controllers) can now emit errors with HTTP status codes and error messages. See "Controllers" and "listen()" in the readme.
* listen() now reports status in its output (output.listen) for individual methods. Combine this with the emitter's error event to help track and recover from errors in asynchronous function calls. See "listen()" in the readme.
* The redirect directive now accepts a URL string as shorthand for a temporary redirect using the Location header

# 0.6.4
* BREAKING CHANGE: The JSON/JSONP output parameter can now return nodes more than one level deep. See "JSON" in the readme for details. The breakage occurs due to how the JSON is returned; if you specify only the first top-level node, just the value of that node is returned within an envelope. Previously, the envelope contained a single key (the top-level node name) containing the value of the node.
* JSON/JSONP output is now pretty by default. Remove whitespace by setting "pretty" to false in the config.
* Fixed PUT/PATCH/DELETE methods to process payloads consisting of JSON or form data
* Controller includes can now be specified via a "route" option, making it possible to call includes with different parameters than the parent controller. See "Including Controllers" in the readme.

# 0.6.3
* Fixed another bug in controller caching. Dur.

# 0.6.2
* Fixed a bug in controller caching that threw a server error
* Updated the readme to reflect breaking changes introduced in 0.6.0 that I somehow missed.

# 0.6.1
* Added ETag and Cache-Control headers to cached routes and static files. See "Client-Side Caching" in the readme.
* Minor breaking change due to a bug fix: the app's urlPath (config.urlPaths.app) is now removed from params.route.filePath for static resources to provide an accurate file path from your public web root. The appropriate replacement is params.route.pathname, which includes the entire path after your site's domain.

# 0.6.0
* BREAKING CHANGE: The nesting syntax for the cache directive has changed slightly, but updating your code will be easy (mostly copy/paste of your existing cache directives). See "Caching Routes and Controllers" in the readme.
* BREAKING CHANGE: File cache retrieval syntax has changed. You must now specify the file attribute rather than the key attribute:
    app.exists({ file: '/path/to/file.txt' });
    app.retrieve({ file: '/path/to/file.txt' });
    app.exists({ file: 'myCustomKey' });
    app.retrieve({ file: 'myCustomKey' });
* gzip support added for both dynamic and static resources. See configuration options in the readme.
* Static asset caching added. See configuration options in the readme.

# 0.5.10
* You can now specify a node name in the URL to return a specific top-level JSON node (/format/json/output/nodename). Works for JSONP also. See JSON in the readme for instructions.
* Added Forms section to readme to provide some tips on working with form data and creating progressively enhanced forms
* citizen's reserved URL parameters no longer need to be added to cache.directives manually
* Added an option to log a warning about invalid cache URL parameters instead of throwing an error. If citizen encounters a URL parameter not present in cache.urlParams, the route will be processed and displayed, but not cached. This is now the default behavior. Use "cache": { "invalidUrlParams" : "throw" } in your config to throw an error instead.
* The server now throws an error if you try to assign values to any reserved directive names that will cause problems in your application; scopes include url, session, content, and others. I'd label this a breaking change, but if you're doing this, your application is probably already broken.

# 0.5.9
* app.listen() has been enhanced to perform asynchronous parallel, series, or waterfall processing. This is a non-breaking change because the default behavior (parallel) is the same as the original behavior. See listen() in the readme for details.
* Replaced POST body parsing with formidable. I hate adding dependencies, but formidable is the standard and it works very well, so it seems silly to write a multipart form parser from scratch.
* Fixed default debug rendering (defaults to console, view is optional)
* Errors now have their own views determined by the JS error code or HTTP status code, with a catch-all default error view. These views are optional and have no matching controller or model. See readme for details.
* Added example error views to scaffold

# 0.5.8
* Small performance tweaks and debug additions in the server and router
* Readme updates

# 0.5.7
* Fixed a bug in the view directive when used within an include controller. Note that the view directive still can't (and never will) work within a cached include controller. You need to specify the include controller's view in the include directive of the calling controller if you intend to cache the result.
* Improved error messages by throwing proper Error objects, allowing more useful trace logs
* Cleaned up server.js and helpers.js a bit

# 0.5.6
* Fixed a bug in view rendering caused by controllers that have includes but no content directive in the emitter
* Improvements to format parameter handling

# 0.5.5
* Bug fixes for JSON and JSONP output

# 0.5.4
* Readme fixes related to cache syntax changes

# 0.5.3
* Fixed a bug in https.secureCookies that prevented the cookie directive from overriding it. You can now tell citizen to intentionally set an insecure cookie in a secure environment.
* Changed the default cookie path to urlPaths.app (cookies were being set to the root path "/" by default previously). This is technically a breaking change, but the worst that will happen is that cookies set prior to this change will no longer be accessible if your app path is something other than "/".

# 0.5.2
* Added "secureCookies" option to "https" config. By default, all cookies set during an HTTPS request are secure. Setting this option to false allows non-secure cookies to be set by secure pages.

# 0.5.1
* Forgot to update the config builder in util/scaffold.js with the new HTTP config

# 0.5.0
* BREAKING CHANGE: Secure server support (HTTPS) has been added, resulting in minor changes to the way default hostnames and ports are stored in the config file. See "Configuration" and "HTTPS" in the readme for details.
* BREAKING CHANGE (potentially): The default setting for citizen.urlPaths.app has been changed to "/" (previously an empty string). If you're referencing this variable within your own app to build URLs, it might cause problems.
* Added a "path" option under "log" in the config so you can specify an alternate location for log files
* Fixed a bug in error handling caused by the addition of helpers.public

# 0.4.1
* Seems silly to change version numbers just for a readme fix, but that's the world we live in.

# 0.4.0
* BREAKING CHANGE: Views rendered in a controller chain using handoff are now stored in the route.chain scope instead of the include scope (details in the readme under the "Controller Handoff" section)
* BREAKING CHANGE: The syntax for the cache directive has been changed to make it a bit easier to understand. See the "Caching Routes and Controllers" section in the readme.
* Fixed a bug in controller caching that threw an error when trying to cache a controller that also used the include directive
* The "includeThisView" attribute within the handoff directive has been deprecated. If a controller in a handoff chain has a matching view, it's rendered automatically. If you leave this attribute in place, it won't break anything, but it will be ignored.
* Added an error handler for EADDRNOTAVAIL at server startup (hostname unavailable/already in use)
* Moved hasOwnProperty check in app.extend() to outer if statement so it covers both conditions
* Added clearTimeout to session.end() so timers are cleared when a session is ended manually

# 0.3.8
* app.copy() and app.extend() bug fixes and performance improvements
* Made startup messaging consistent with actual settings

# 0.3.7
* Fixed a bug in log()
* app.config.hostname can be set to an empty string, allowing responses from any host
* Switched object "deletions" to use null instead of undefined
* Added config descriptions to readme
* Removed index entry point (redundant)

# 0.3.6
* Added another error scenario for HTTP port availability

# 0.3.5
* Added httpPort to the skeleton app config because it's easier on new users to modify that setting if it's already there

# 0.3.4
* Fixed a major bug in app.log() that pretty much broke logging entirely
* Added a timestamp option to app.log() that lets you disable the timestamp in the log output
* Added error handling for some common server startup problems and friendly messaging to aid in troubleshooting
* Improved formatting for startup logs

# 0.3.3
* Readme fixes

# 0.3.2
* Added a util directory with a scaffolding CLI. You can now create an app skeleton and generate MVC patterns automagically. See the readme for instructions.

# 0.3.1
* Readme fixes

# 0.3.0
* BREAKING CHANGE: citizen includes are now self-contained and only play in their own sandbox. They no longer receive updated context from the calling controller, and they no longer pass their own content and directives into the request context. This just makes more sense and avoids a lot of pitfalls I was experiencing in my own projects.
* BREAKING CHANGE: Completely rewrote caching, fixing bugs and making additions such as a custom scope option, allowing for easy deletion of groups of cached items. Please see the readme for changes to app.cache(), app.exists(), app.retrieve(), and app.clear(), which now all take options objects instead of a list of arguments.
* BREAKING CHANGE: app.size() now throws an error if the provided argument isn't an object literal
* Fixed several bugs in server.js that broke controller caching, route cache expiration, and cache URL params validation
* Added app.log() helper to make it easier to log application events to the console or files based on application mode (production, debug, etc.)
* Added prettyHTML config setting for Jade templates in production mode (default is true, setting it to false removes all whitespace between tags)
* Fixed the default action in params.route.chain ('handler')
* Rewrote app.dashes(), fixing a few bugs and adding a fallback option that gets returned if the parsed string ends up being empty

# 0.2.14
* The ctznRedirect session variable now has a cookie fallback if sessions aren't enabled
* Fixed a bug in direct cookie assignments

# 0.2.13
  This is the beginning of the change log. I think citizen is "complete" enough to warrant it.

* BREAKING CHANGE: Changed params.route.pathName to params.route.pathname
* Enhanced redirect functionality
