citizen
=======

citizen is an event-driven MVC framework for Node.js web applications. Its goal is to handle serving, routing, and event emitter creation, while providing some useful helpers to get you on your way. The nuts and bolts of your application are up to you, but citizen's helpers are designed to work with certain patterns and conventions, which are covered throughout this guide.

citizen is in beta. Your comments, criticisms, and requests are welcome.

citizen's static file serving is just a hack to get your dev environment up and running quickly. I recommend something like [nginx](http://nginx.org) as a front end for static file serving in your production environment.

### Windows compatibility

I developed citizen using Mac and Linux environments. Windows support is first on my list of testing/fixes.



Installing citizen
------------------

    npm install citizen

I had some issues because of the Handlebars dependency, but installing with the `--no-bin-links` flag worked:

    npm install citizen --no-bin-links



Configuring and Initializing citizen
------------------------------------

The following assignment will initialize your citizen app:

    app = require('citizen');


### Application Directory Structure

Here's the most basic directory structure of a citizen web app:

    app/
      patterns/
        controllers/
          index.js
        models/
          index.js
        views/
          index/
            index.js
      start.js // Entry point --> app = require('citizen');
    public/

Here's a more complex app example (more about `config` and `on` directories below):

    app/
      config/
        citizen.json
        db.json
      logs/
      on/
        application.js
        request.js
        response.js
        session.js
      patterns/
        controllers/
          index.js
        models/
          index.js
        views/
          index/
            index.hbs
            index-alt.hbs
      start.js
    public/


### Configuration

The `config` directory is optional and is used to store your app's configuration files in JSON format. You can have multiple JSON files within this directory, allowing different configurations based on environment. citizen retrieves its configuration file from this directory based on the following logic:

1. citizen parses each JSON file looking for a "hostname" key that matches the machine's hostname. If it finds one, it loads that configuration.
2. If it can't find a matching hostname key, it looks for a file named citizen.json and loads that configuration.
3. If it can't find citizen.json, it runs under its default configuration.

citizen also parses any other files it finds in this directory and stores the resulting configuration within `app.config`. Using the file structure above, you'd end up with `app.config.citizen` and `app.config.db`.

The following represents citizen's default configuration.

    {
      mode: 'production',
      directories:  {
        app: process.cwd(),
        logs: process.cwd() + '/logs',
        on: process.cwd() + '/on',
        patterns: process.cwd() + '/patterns',
        public: path.resolve(process.cwd(), '../public')
      },
      urlPaths:  {
        app:   '/'
      },
      httpPort: 80,
      sessions: false,
      sessionTimeout: 1200000, // 20 minutes
      requestTimeout: 30000, // 30 seconds
      mimeTypes: JSON.parse(fs.readFileSync(path.join(__dirname, '../config/mimetypes.json'))),
      debug: {
        output: 'console',
        depth: 2
      }
    }

Objects returned by citizen:

- `app.config`      Includes the configuration settings you supplied at startup
- `app.helper`      Functions citizen uses internally that you might find helpful in your own app
- `app.patterns`    Controllers, models, and views (both raw and compiled) from your supplied patterns, which you can use instead of `require`
- `app.start()`     The function used to start the web server
- `app.listen()`    citizen's event listener for one or many asynchronous functions
- `app.handlebars`  A pointer to the citizen Handlebars global, allowing you full access to Handlebars methods such as registerHelper
- `app.jade`        A pointer to the citizen Jade global
- `CTZN`            A global namespace used by citizen for session storage, among other things

You should not access or modify the `CTZN` namespace directly; anything you might need in your application will be exposed by the server to your controllers through local scopes.



Starting the web server
-----------------------

    app.start();



Routing and URLs
----------------

Apps using citizen have a simple URL structure that determines which controller to fire, passes URL parameters, and makes a bit of room for SEO-friendly content. The structure looks like this:

    http://www.site.com/controller-name/SEO-content-here/parameter/value/parameter2/value2

For example, let's say your site's base URL is:

    http://www.cleverna.me

Requesting that URL will cause the `index` controller to fire, because the index pattern is the default pattern. The following URL will also cause the index controller to fire:

    http://www.cleverna.me/index

If you have an `article` pattern, you'd request it like this:

    http://www.cleverna.me/article

Instead of query strings, citizen uses an SEO-friendly method of passing URL parameters consisting of name/value pairs. If you had to pass an article ID of 237 and a page number of 2, you'd append name/value pairs to the URL:

    http://www.cleverna.me/article/id/237/page/2

Valid parameter names must start with a letter or underscore and may contain numbers.

citizen also lets you optionally insert relevant content into your URLs, like so:

    http://www.cleverna.me/article/My-clever-article-title/id/237/page/2

This SEO content must always follow the pattern name and precede any name/value pairs. You can access it via a URL parameter called `descriptor`, which means you can use it as a unique identifier (more on URL parameters below).



MVC Patterns
------------

citizen relies on a predefined model-view-controller pattern that has a few strict requirements. The article pattern mentioned above would require the following structure:

    app/
      patterns/
        controllers/
          article.js
        models/
          article.js
        views/
          article/
            article.hbs

### handler(params, context, emitter)

Each controller requires at least one public function named `handler()`. The citizen server calls `handler()` after it processes the initial request and passes it 3 arguments: an object containing the parameters of the request, the current request's context generated by the app up to this point, and an emitter for the controller to emit when it's done.

The `params` object contains the following objects:

- `request` The request object generated by the server
- `response` The response object generated by the server
- `route` Details of the route, such as the requested URL and the name of the route (controller)
- `url` Any URL parameters that were passed including the descriptor, if provided
- `form` Data collected from a POST
- `payload` Data collected from a PUT
- `cookie` An object containing any cookies that were sent with the request
- `session` An object containing any session variables, if sessions are enabled

In addition to having access to these objects within your controller, they are also passed to your view context automatically so you can use them within your view templates (more details in the Views section).

Based on the previous example URL...

    http://www.cleverna.me/article/My-clever-article-title/id/237/page/2

...you'll have the following `params.url` object passed to your controller:

    {
      id: 237,
      page: 2,
      descriptor: 'My-clever-article-title'
    }

Using these parameters, I can retrieve the article content from the model, append it to the view context, and pass the context back to the server:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      // Get the article content
      var content = {
        article: app.patterns.models.article.getArticle(params.url.id, params.url.page)
      };

      // Emit the 'ready' event and pass the view context back to the server for rendering.
      emitter.emit('ready', {
        content: content
      });
    };

The emitter should emit a "ready" event when the controller has accomplished its task. This lets the server know it's time to send the response.

The second argument in the emitter is an object containing any data you want to pass back to citizen, including the view context. All the content you want to render in your view should be passed to citizen within an object called `content`, as shown above. Additional objects can be passed to citizen to perform other functions, which are described later in this document.

We haven't discussed the `context` argument yet. This argument contains any output that's been generated by the request up to this point. There are various events that can populate this argument, which is then passed to your controller so you can access it. More on this later.

Here's a simple model:

    // article model

    exports.getArticle = getArticle;

    function getArticle(id, page) {
      var articles = {
        '236': {
          title: 'I <3 Node.js',
          summary: 'Things I love about Node',
          pages: {
            '1': 'First page content',
            '2': 'Second page content'
          }
        },
        '237': {
          title: 'What\'s in room 237?',
          summary: 'Nothin\'. There\'s nothin\' in room 237.',
          pages: {
            '1': 'Nothing to see here.',
            '2': 'Actually, yeah, there is.'
          }
        }
      };

      return {
        title: articles[id]['title'],
        summary: articles[id]['summary'],
        text: articles[id]['pages'][page]
      };
    };

In `article.hbs`, you can now reference objects you placed within the `content` object passed by the emitter:

    <!DOCTYPE html>
    <html>
    <body>
      <h1>
        {{article.title}}
      </h1>
      <p id="summary">
        {{article.summary}}
      </p>
      <div id="text">
        {{article.text}}
      </div>
    </body>
    </html>



listen()
----------

The previous example has simple methods that return static content immediately, but things are rarely that simple. The `listen()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listen()` functions for very powerful asynchronous function calls.

`listen()` takes two arguments: an object containing one or more methods you want to call, and a callback to handle the output. `listen()` requires that your functions be written to accept an `emitter` argument, which is how your function notifies listen() that it's ready.

Let's say our article model has two methods that need to be called before returning the results to the controller. One is called getArticle() and the other is getViewers(). Assume that both methods make an asynchronous call to a database and won't be able to return their output immediately, so we have to listen for when they're ready and then react.

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        // The property contains the action you want to listen for, which is
        // wrapped in an anonymous function in order to pass the emitter
        article: function (emitter) {
            app.patterns.models.article.getArticle({ id: params.url.id, page: params.url.page }, emitter);
        },
        viewers: function (emitter) {
          app.patterns.models.article.getViewers(params.url.id, emitter);
        }
      }, function (output) {
        // The property name you assign to the methods above becomes the
        // name of the output object
        var content = {
              article: output.article,
              viewers: output.viewers
            };

        // Emit `ready` now that we have the handler output and pass the
        // context back to the server
        emitter.emit('ready', {
          content: content
        });
      });
    }

And the model:

    // article model

    module.exports = {
      getArticle: getArticle,
      getViewers: getViewers
    };

    function getArticle(args, emitter) {
      app.db.article(args.id, function (data) {
        // When the database returns the data, emit `ready` and pass the
        // data back to listen()
        emitter.emit('ready', data);
      });
    };

    function getViewers(id, emitter) {
      app.db.viewers(id, function (data) {
        // When the database returns the data, emit `ready` and pass the
        // data back to listen()
        emitter.emit('ready', data);
      });
    };

listen() currently fires all functions asynchronously and returns the results for every function in a single output object after all functions have completed. A waterfall-type execution is being worked on, but in the meantime, you can nest listen() functions to achieve the same effect:

  listen({
    first: function (emitter) {
      doSomething(emitter);
    }
  }, function (output) {
    listen({
      second: function (emitter) {
        doNextThing(output, emitter);
      }
    }, function (output) {
      listen({
        third: function (emitter) {
          doOneMoreThing(output, emitter);
        }
      }, function (output) {
        thisIsExhausting(output);
      });
    });
  });



Setting Cookies, Session Variables, and Redirects
-------------------------------------------------

In addition to the view context, the server's `ready` emitter also accepts objects used for setting cookies, session variables, and redirects.


### Cookies

You set cookies by appending a `cookie` object to the return context. Cookies can be set one at a time or in groups. The following code tells the server to set `username` and `passwordHash` cookies that never expire:

    // login controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        login: function (emitter) {
          app.patterns.models.login.authenticate({
            // Form values, just like URL parameters, are passed via the params
            // argument
            username: params.form.username,
            password: params.form.password
          }, emitter);
        }
      }, function (output) {
        var content = {
              login: output.login
            },
            cookie;

        if ( content.login.success === true ) {
          cookie = {
            // The cookie gets its name from the property name
            username: {
              // The cookie value
              value: content.login.username,

              // Valid expiration options are:
              // 'now' - deletes an existing cookie
              // 'never' - current time plus 30 years, so effectively never
              // 'session' - expires at the end of the browser session (default)
              // [time in milliseconds] - length of time, added to current time
              expires: 'never'
            },
            passwordHash: {
              value: content.login.passwordHash,
              expires: 'never'
            }
          };
        }

        emitter.emit('ready', {
          content: content,
          cookie: cookie
        });
      });
    };

The following code sets the same cookies, but they expire at the end of the browser session:

    cookie.username = content.login.username;
    cookie.passwordHash = content.login.passwordHash;

Other cookie options include `path` (default is `/`), `httpOnly` (default is `true` for security reasons), and `secure` (default is `false`).

Cookies sent by the client are available in `params.cookie` within the controller and simply `cookie` within the view context:

    <!DOCTYPE html>
    <html>
    <body>
      <div id="welcome">
        {{#if cookie.username}}
          Welcome, {{cookie.username}}.
        {{else}}
          <a href="/login">Login</a>
        {{/if}}
      </div>
    </body>
    </html>

Cookie variables you set within your controller aren't immediately available within the `params.cookie` scope. citizen's server has to receive the response from the controller before it can send the cookie to the client, so use a local instance of the variable if you need to access it during the same request.



### Session Variables

If sessions are enabled, citizen creates an object called `CTZN.sessions` to store session information. You should avoid accessing this object directly and use `params.session` instead (or simply `session` within the view), which automatically references the current user's session.

By default, the session has two properties: `id` and `expires`. The session ID is also sent to the client as a cookie called `ctzn_session_id`.

Setting session variables is the same as setting cookie variables:

    session.username = 'Danny';
    session.nickname = 'Doc';

    emitter.emit('ready', {
      content: content,
      session: session
    });

To forcibly clear and expire the current user's session:

    session.expires = 'now';

Like cookies, session variables you've just assigned aren't available during the same request within the `params.session` scope, so use a local instance if you need to access this data right away.



### Redirects

You can pass redirect instructions to the server that are to be enacted after the request is complete. Redirects using this method are not immediate, so everything your controller is asked to do, it will do before the redirect is processed. The user agent won't receive a full response, however. No view content will be sent, but cookies and session variables will be set if specified.

The `redirect` object takes two keys: `statusCode` and `url`. If you don't provide a status code, citizen uses 302 (temporary redirect).

    redirect = {
      statusCode: 301,
      url: 'http://redirect.com'
    };

    emitter.emit('ready', {
      content: content,
      redirect: redirect
    });



Application Events and the Context Argument
-------------------------------------------

Certain events will occur throughout the life of your citizen application. You can intercept these application events, execute functions, and pass the results to the next event, where they'll eventually be passed to your controller via the `context` argument. For example, you might set a custom cookie at the beginning of every new session, or check for cookies at the beginning of every request and redirect the user to a login page if they're not authenticated.

To take advantage of these events, include a directory called "on" in your app with the following modules and exports:

    app/
      on/
        application.js // exports start(), end(), and error()
        request.js     // exports start() and end()
        response.js    // exports start() and end()
        session.js     // exports start() and end()

All files and exports are optional. citizen only calls them if they exist. For example, you could have only a session.js module that exports end().

_Note: As of this update, session end() and application end() aren't functional. They'll be in a future version._

Here's an example of a request module that checks for a username cookie at the beginning of every request and redirects the user to a login page if it's not there, unless the requested pattern is the login page:

    // app/on/request.js

    exports.start = start;

    function start(params, context, emitter) {
      var redirect = {};

      if ( !params.cookie.username && params.route.name !== 'login' ) {
        redirect.url = 'http://' + params.request.headers.host + '/login';
      }

      emitter.emit('ready', {
        redirect: redirect
      });
    };



HTTP Access Control (CORS)
--------------------------

citizen supports cross-domain HTTP requests via access control headers. By default, all controllers respond to requests from the host only. To enable cross-domain access, simply add an `access` object with the necessary headers to your controller's exports:

    module.exports = {
      handler: handler,
      access: {
        'Access-Control-Allow-Origin': 'http://www.somesite.com http://anothersite.com',
        'Access-Control-Expose-Headers': 'X-My-Custom-Header, X-Another-Custom-Header',
        'Access-Control-Max-Age': 1728000,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'OPTIONS, PUT',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
      }
    };

For more details on CORS, check out this writeup on the [Mozilla Developer Network](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS).



Debugging
---------

*** `debug` and `development` modes are inherently insecure. Do not use them in a production environment. ***

If you set `"mode": "debug"` in your config file, citizen dumps the current pattern's output to the console by default. You can also dump it to the view with the `ctzn_dump` URL parameter:

    http://www.cleverna.me/article/id/237/page/2/ctzn_dump/view

By default, the pattern's complete output is dumped. You can specify the exact object to debug with the `ctzn_debug` URL parameter. You can access globals, `pattern`, and server `params`:

    // Dumps pattern.content to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/pattern.content

    // Dumps the server params object to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params

    // Dumps CTZN.session to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/CTZN.session

    // Dumps CTZN.session to the view
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/CTZN.session/ctzn_dump/view

In `development` mode, you must specify the `ctzn_debug` URL parameter to enable debug output. Debug output is disabled in production mode.

If you always want debug output dumped to the view, set debug output to "view" in your citizen config file.



Helpers
-------

In addition to `listen()`, citizen includes a few more basic helper functions that it uses internally, but might be of use to you, so it returns them for public use.

### copy(object)

Creates a deep copy of an object.

    var myCopy = app.helper.copy(myObject);

### extend(object, extension[, boolean])

Extends an object with another object, effectively merging the two objects. By default, extend() creates a copy of the original before extending it, creating a new object. If your intention is to alter the original and create a pointer, pass the optional third argument of `false`.

    var newObject = app.helper.extend(originalObject, extensionObject);

### isNumeric(object)

Returns `true` if the object is a number, `false` if not.



Views
-----

citizen supports [Handlebars](https://npmjs.org/package/handlebars) and [Jade](https://www.npmjs.org/package/jade) templates, as well as good old HTML. You can even mix and match Handlebars, Jade, and HTML templates as you see fit; just use the appropriate file extensions (.hbs, .jade, or .html) and citizen will compile and render each view with the appropriate engine.

You have direct access to each engine's methods via `app.handlebars` and `app.jade`, allowing you to use methods like `app.handlebars.registerHelper` to create global helpers. Just keep in mind that you're extending the global Handlebars and Jade objects and could potentially affect citizen's view rendering if you do anything wacky because citizen relies on these same objects.

### Includes

citizen has a standardized way of handling includes that works in both Handlebars and Jade templates. In citizen, includes are more than just chunks of code that you can reuse. citizen includes are full patterns, each having its own controller, model, and view(s).

Let's say our article pattern's Handlebars template has the following contents:

    <!DOCTYPE html>
    <html>
    <head>
      <title>{{metaData.title}}</title>
      <meta name="description" content="{{metaData.description}}" />
      <meta name="keywords" content="{{metaData.keywords}}" />
      <link rel="stylesheet" type="text/css" href="app.css" />
    </head>
    <body>
      <header>
        <a id="logo">Home page</a>
        <nav>
          <ul>
            <li>
              <a href="/">Home</a>
            </li>
            <li>
              <a href="/articles">Settings</a>
            </li>
          </ul>
        </nav>
      </header>
      <main>
        <h1>
          {{article.title}}
        </h1>
        <p id="summary">
          {{article.summary}}
        </p>
        <div id="text">
          {{article.text}}
        </div>
      </main>
    </body>
    </html>

It probably makes sense to use includes for the head section and header because you'll use that code everywhere. Let's create patterns for the head and header. I like to follow the convention of starting partials with an underscore, but that's up to you:

    app/
      patterns/
        controllers/
          _head.js
          _header.js
          article.js
        models/
          _head.js
          _header.js
          article.js
        views/
          _head/
            _head.hbs
          _header/
            _header.hbs
            _header-authenticated.hbs // A different header for logged in users
          article/
            article.hbs

When the article controller is fired, it needs to tell citizen which includes it needs. We do that with the `include` directive, which we pass via the context in the emitter:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        article: function (emitter) {
            app.patterns.models.article.getArticle({ id: params.url.id, page: params.url.page }, emitter);
        },
        viewers: function (emitter) {
          app.patterns.models.article.getViewers(params.url.id, emitter);
        }
      }, function (output) {
        var content = {
              article: output.article,
              viewers: output.viewers
            };

        emitter.emit('ready', {
          content: content,
          include: {
            // The property name is the name of the include's controller.
            // The property value is the name of the view.
            _head: '_head',
            _header: '_header'
          }
        });
      });
    }

This tells citizen to call the _head controller and render the _head view, and the _header controller and the _header view, then add both to the view context. In article.hbs, we now reference the includes using the `include` object:

    <!DOCTYPE html>
    <html>
    {{include._head}}
    <body>
      {{include._header}}
      <main>
        <h1>
          {{article.title}}
        </h1>
        <p id="summary">
          {{article.summary}}
        </p>
        <div id="text">
          {{article.text}}
        </div>
      </main>
    </body>
    </html>

What if logged in users get a different header? Just tell citizen to use a different view:

    emitter.emit('ready', {
      content: content,
      include: {
        _head: '_head',
        _header: '_header-authenticated'
      }
    });

Includes can generate content and add it to the view context of your primary controller (article.js in this example) because the primary view is the last to be rendered. However, includes are called and rendered asynchronously, so while your _head controller can generate content and add it to the view context of your article controller, don't assume that your _header controller will have access to that data. (The option of waterfall execution is being worked on, so this is only true for the time being.)

<!-- ### handoff

citizen allows the requested controller to give another controller the responsibility of handling the request and rendering its own view via a context object called `handoff`. The secondary controller assumes responsibility for the request, adding its own content to the context and rendering its own view. You can implement as many handoffs as you want (controller A can handoff to controller B, who can handoff to controller C, and so on). -->
