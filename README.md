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
            index.hbs
      start.js // Entry point --> app = require('citizen');
    public/

Here's a more complex app example (more about `config` and `on` directories below):

    app/
      config/
        citizen-local.json
        citizen-production.json
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

The `config` directory is optional and is used to store your app's configuration files in JSON format. You can have multiple citizen configuration files within this directory, allowing different configurations based on environment. citizen retrieves its configuration file from this directory based on the following logic:

1. citizen parses each JSON file whose name starts with "citizen" looking for a "hostname" key that matches the machine's hostname. If it finds one, it loads that configuration.
2. If it can't find a matching hostname key, it looks for a file named citizen.json and loads that configuration.
3. If it can't find citizen.json, it runs under its default configuration.

citizen also parses any other files it finds in this directory and stores the resulting configuration within `app.config`. Using the file structure above, you'd end up with `app.config.citizen` and `app.config.db`.

The following represents citizen's default configuration.

    {
      "mode": "production",
      "directories":  {
        "app": "[current working directory]",
        "logs": "[current working directory]/logs",
        "on": "[current working directory]/on",
        "patterns":  "[current working directory]/patterns",
        "public": "../public"
      },
      "urlPaths":  {
        "app":   "/"
      },
      "httpPort": 80,
      "sessions": false,
      "sessionTimeout": 1200000
      "requestTimeout": 30000
      "mimeTypes": [parsed from internal config],
      "debug": {
        "output": "console",
        "depth": 2
      }
    }

<table>
  <thead>
    <tr>
      <th colspan="2">Objects returned by citizen</th>
    </tr>
  </thead>
  <tr>
    <th>`app.controllers`</th>
    <td>
      Contains controllers from your supplied patterns, which you can use instead of `require`
    </td>
  </tr>
  <tr>
    <th>`app.models`</th>
    <td>
       Contains models from your supplied patterns, which you can use instead of `require`
    </td>
  </tr>
  <tr>
    <th>`app.views`</th>
    <td>
      Contains views (both raw and compiled) from your supplied patterns
    </td>
  </tr>
  <tr>
    <th>`app.start()`</th>
    <td>
      Starts the web server
    </td>
  </tr>
  <tr>
    <th>`app.listen()`</th>
    <td>
      Your app's event listener for one or many asynchronous functions (see the **listen()** section)
    </td>
  </tr>
  <tr>
    <th>`app.helpers`</th>
    <td>
      Functions citizen uses internally that you might find helpful in your own app
    </td>
  </tr>
  <tr>
    <th>`app.handlebars`</th>
    <td>
      A pointer to the citizen Handlebars global, allowing you full access to Handlebars methods such as `app.handlebars.registerHelper()`
    </td>
  </tr>
  <tr>
    <th>`app.jade`</th>
    <td>
      A pointer to the citizen Jade global
    </td>
  </tr>
  <tr>
    <th>`app.config`</th>
    <td>
      The configuration settings you supplied at startup, which you can use within your application
    </td>
  </tr>
  <tr>
    <th>`CTZN`</th>
    <td>
      The global namespace used by citizen for session storage, among other things. You should not access or modify this namespace directly; anything you might need in your application will be exposed by the server to your controllers through local scopes.
    </td>
  </tr>
</table>



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

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2

This SEO content must always follow the pattern name and precede any name/value pairs. You can access it via a URL parameter called `descriptor`, which means you can use it as a unique identifier (more on URL parameters below).



MVC Patterns
------------

citizen relies on a simple model-view-controller convention. The article pattern mentioned above might use the following structure:

    app/
      patterns/
        controllers/
          article.js
        models/
          article.js
        views/
          article/        // Matches the controller name
            article.hbs   // Matches the controller name, making it the default view
            edit.hbs      // Secondary view for editing an article

At least one controller is required for a given URL, and a controller's default view directory and default view file must share its name. Additional views should reside in this same directory and are accessible via the `view` URL parameter:

    http://www.cleverna.me/article/My-Clever-Article-Title/view/edit

Models and views are optional and don't necessarily need to be associated with a particular controller. If your controller doesn't need a model, you don't need to create one. If your controller is going to pass its output to another controller for further processing and final rendering, you don't need to include a matching view. (See the `handoff` directive later in this document.)



### controller.handler(params, context, emitter)

Each controller requires at least one public function named `handler()`. The citizen server calls `handler()` after it processes the initial request and passes it 3 arguments: an object containing the parameters of the request, the current request's context generated by the app up to this point, and an emitter for the controller to emit when it's done.

<table>
  <thead>
    <tr>
      <th colspan="2">Contents of the `params` object</th>
    </tr>
  </thead>
  <tr>
    <th>`request`</th>
    <td>The request object generated by the server</td>
  </tr>
  <tr>
    <th>`response`</th>
    <td>The response object generated by the server</td>
  </tr>
  <tr>
    <th>`route`</th>
    <td>Details of the route, such as the requested URL and the name of the route (controller)</td>
  </tr>
  <tr>
    <th>`url`</th>
    <td>Any URL parameters that were passed including the descriptor, if provided</td>
  </tr>
  <tr>
    <th>`form`</th>
    <td>Data collected from a POST</td>
  </tr>
  <tr>
    <th>`payload`</th>
    <td>Data collected from a PUT</td>
  </tr>
  <tr>
    <th>`cookie`</th>
    <td>An object containing any cookies that were sent with the request</td>
  </tr>
  <tr>
    <th>`session`</th>
    <td>An object containing any session variables, if sessions are enabled</td>
  </tr>
</table>

In addition to having access to these objects within your controller, they are also included in your view context automatically so you can use them within your view templates (more details in the Views section).

Based on the previous example URL...

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2

...you'll have the following `params.url` object passed to your controller:

    {
      page: 2,
      descriptor: 'My-Clever-Article-Title'
    }

Using these parameters, I can retrieve the article content from the model, add it to the view context, and pass the context back to the server:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      // Get the article content
      var content = {
        article: app.models.article.getArticle(params.url.descriptor, params.url.page)
      };

      // Emit the 'ready' event and pass the view context back to the server for rendering.
      emitter.emit('ready', {
        content: content
      });
    };

The emitter should emit a "ready" event when the controller has accomplished its task. This lets the server know it's okay to proceed.

The second argument in the emitter is an object containing any data you want to pass back to citizen, including the view context. All the content you want to render in your view should be passed to citizen within an object called `content`, as shown above. Additional objects can be passed to citizen to perform other directives, which are described later in this document.

We haven't discussed the `context` argument yet. This argument contains any output that's been generated by the request up to this point. There are various events that can populate this argument with content and directives, which is then passed to your controller so you can access that content. More on this later.

Here's a simple model:

    // article model

    exports.getArticle = getArticle;

    function getArticle(descriptor, page) {
      var articles = {
        'My-Clever-Article-Title': {
          title: 'My Clever Article Title',
          summary: 'Am I not terribly clever?',
          pages: {
            '1': 'First page content',
            '2': 'Second page content'
          }
        },
        'Clever-Part-II-The-Sequel': {
          title: 'Clever Part II: The Sequel',
          summary: 'Too clever for just one article.',
          pages: {
            '1': 'First page content',
            '2': 'Second page content'
          }
        }
      };

      return {
        title: articles[descriptor]['title'],
        summary: articles[descriptor]['summary'],
        text: articles[descriptor]['pages'][page]
      };
    };

In `article.hbs`, you can now reference objects you placed within the `content` object passed by the emitter, as well as objects within `params` such as the `url` scope:

    <!DOCTYPE html>
    <html>
    <body>
      <h1>
        {{article.title}} - Page {{url.page}}
      </h1>
      <p id="summary">
        {{article.summary}}
      </p>
      <div id="text">
        {{article.text}}
      </div>
    </body>
    </html>

The view context is extended with `params` before the view is rendered, so you can reference anything within it as if it's local.

listen({ functions }, callback)
-------------------------------

The previous example has simple methods that return static content immediately, but things are rarely that simple. The `listen()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listen()` functions for very powerful asynchronous function calls.

`listen()` takes two arguments: an object containing one or more methods you want to call, and a callback to handle the output. `listen()` requires that your functions be written to accept an `emitter` argument, which is how your function notifies `listen()` that it's ready.

Let's say our article model has two methods that need to be called before returning the results to the controller. One is called `getArticle()` and the other is `getViewers()`. Assume that both methods make an asynchronous call to a database and won't be able to return their output immediately, so we have to listen for when they're ready and then react.

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        // The property contains the action you want to listen for, which is
        // wrapped in an anonymous function in order to pass the emitter
        article: function (emitter) {
            app.models.article.getArticle({ id: params.url.id, page: params.url.page }, emitter);
        },
        viewers: function (emitter) {
          app.models.article.getViewers(params.url.id, emitter);
        }
      }, function (output) {
        // The property names you assign to the methods above become the names
        // of the output objects
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
      app.db.article(args, function (data) {
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

`listen()` currently fires all functions asynchronously and returns the results for every function in a single output object after all functions have completed. A waterfall-type execution is being worked on, but in the meantime, you can nest `listen()` functions to achieve the same effect:

    listen({
      first: function (emitter) {
        doSomething(emitter);
      }
    }, function (output) {
      listen({
        second: function (emitter) {
          doNextThing(output.first, emitter);
        }
      }, function (output) {
        listen({
          third: function (emitter) {
            doOneMoreThing(output.second, emitter);
          }
        }, function (output) {
          thisIsExhausting(output.third);
        });
      });
    });



Setting Cookies, Session Variables, and Redirects
-------------------------------------------------

In addition to the view context, the server's `ready` emitter also accepts objects used for setting cookies, session variables, and redirects.


### Cookies

You set cookies by appending a `cookie` object to the emitter context. Cookies can be set one at a time or in groups. The following code tells the server to set `username` and `passwordHash` cookies that never expire:

    // login controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        login: function (emitter) {
          app.models.login.authenticate({
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

        if ( content.login.success ) {
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

If sessions are enabled, citizen creates an object called `CTZN.sessions` to store session information. Don't access this object directly; use `params.session` instead (or simply `session` within the view). These local scopes reference the current user's session.

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

This won't end the session immediately. citizen has to receive your controller's response before it can act on this directive.

Like cookies, session variables you've just assigned aren't available during the same request within the `params.session` scope, so use a local instance if you need to access this data right away.



### Redirects

You can pass redirect instructions to the server that are to be enacted after the request is complete. Redirects using this method are not immediate, so the controller will do everything it's been asked to do before the redirect is processed. The user agent won't receive a full response, however. No view content will be sent, but cookies and session variables will be set if specified.

The `redirect` object takes two properties: `statusCode` and `url`. If you don't provide a status code, citizen uses 302 (temporary redirect).

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

Certain events will occur throughout the life of your citizen application. You can act on these application events, execute functions, set directives, and pass the results to the next event or your controller via the `context` argument. For example, you might set a custom cookie at the beginning of every new session, or check for cookies at the beginning of every request and redirect the user to a login page if they're not authenticated.

To take advantage of these events, include a directory called "on" in your app with the following modules and exports:

    app/
      on/
        application.js // exports start(), end(), and error()
        request.js     // exports start() and end()
        response.js    // exports start() and end()
        session.js     // exports start() and end()

The application `start()` and request `start()` and `end()` events are triggered before your controller is fired, so the output from those events is passed to your controller via the `context` argument.

All files and exports are optional. citizen only calls them if they exist. For example, you could have only a session.js module that exports `end()`.

_Note: As of this version, session end() and application end() aren't functional. They'll be in a future version._

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


Views
-----

citizen supports [Handlebars](https://npmjs.org/package/handlebars) and [Jade](https://www.npmjs.org/package/jade) templates, as well as good old HTML. You can even mix and match Handlebars, Jade, and HTML templates as you see fit; just use the appropriate file extensions (.hbs, .jade, or .html) and citizen will compile and render each view with the appropriate engine.

You have direct access to each engine's methods via `app.handlebars` and `app.jade`, allowing you to use methods like `app.handlebars.registerHelper()` to create global helpers. Keep in mind that you're extending the global Handlebars and Jade objects, potentially affecting citizen's view rendering if you do anything wacky because citizen relies on these same objects.

The default view format is HTML, but you can also return JSON and JSONP with no extra work on your part.

### JSON

You don't need a custom view just for JSON. You can tell a controller to return its content as plain text JSON by adding the `format` URL parameter.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json

Returns...

    {
      "My-Clever-Article-Title": {
        "title": "My Clever Article Title",
        "summary": "Am I not terribly clever?",
        "text": "Second page content"
      }
    }

Whatever you've added to the controller's emitter `content` object will be returned. The line breaks are just for readability. The actual output is compressed.

### JSONP

JSONP is pretty much the same. Use `format` and `callback` in the URL:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/jsonp/callback/foo

Returns:

    foo({
      "My-Clever-Article-Title": {
        "title": "My Clever Article Title",
        "summary": "Am I not terribly clever?",
        "text": "Second page content"
      }
    });

If you want to make it available to third party sites, see the CORS section below.



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
      <footer>
        Copyright &copy; 2014 cleverna.me
      </footer>
    </body>
    </html>

It probably makes sense to use includes for the head section, header, and footer because you'll use that code everywhere. Let's create patterns for these includes. I like to follow the convention of starting partials with an underscore, but that's up to you:

    app/
      patterns/
        controllers/
          _footer.js
          _head.js
          _header.js
          article.js
        models/
          _head.js   // The _header and _footer are just static HTML, so they need no models
          article.js
        views/
          _footer/
            _footer.hbs
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
            app.models.article.getArticle({ id: params.url.id, page: params.url.page }, emitter);
        },
        viewers: function (emitter) {
          app.models.article.getViewers(params.url.id, emitter);
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
            _header: '_header',
            _footer: '_footer'
          }
        });
      });
    }

This tells citizen to call the _head, _header, and _footer controllers, render their respective views, and add them to the view context. In article.hbs, we now reference the includes using the `include` object. The `include` object contains rendered HTML views, so use triple-stache in Handlebars to skip escaping:

    <!DOCTYPE html>
    <html>
    {{{include._head}}}
    <body>
      {{{include._header}}}
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
      {{{include._footer}}}
    </body>
    </html>

What if logged in users get a different header? Just tell citizen to use a different view:

    emitter.emit('ready', {
      content: content,
      include: {
        _head: '_head',
        _header: '_header-authenticated',
        _footer: '_footer'
      }
    });

Includes can generate content and add it to the view context of your primary controller (article.js in this example) because the primary view is the last to be rendered. However, includes are called and rendered asynchronously, so while your _header controller can generate content and add it to the view context of your article controller, don't assume that your _footer controller will have access to that data. (The option of waterfall execution is being worked on, so this is only true for the time being.)

Currently, if a controller is requested as an include, any of the directives to set cookies, session variables, redirects, etc. are ignored, but it's on the feature list to get these working.

**A pattern meant to be used as an include can be accessed via URL just like any other controller.** You could request the `_head` controller like so:

    http://cleverna.me/_head

Perhaps you'd have it return meta data as JSON for the article pattern:

    http://cleverna.me/_head/for/article/title/My-Clever-Article-Title/format/json

Here's an example of the `_head` controller written as both an include and a handler of direct requests:

    // _head.js controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      var metaData,
          // If the "for" URL param exists, use that. Otherwise, assume _head is being used
          // as an include and use the requested route name.
          getMetaDataFor = params.url.for || params.route.name;

      // If it's for the article pattern, call getMetaData() and pass it the title
      if ( getMetaDataFor === 'article' && params.url.title ) {
        metaData = app.models.article.getMetaData(params.url.title);
      // Otherwise, check if the requested controller's model has getMetaData()
      } else if ( app.models[getMetaDataFor] && app.models[getMetaDataFor].getMetaData ) {
        metaData = app.models[getMetaDataFor].getMetaData();
      }

      emitter.emit('ready', {
        content: {
          metaData: metaData
        }
      });
    }

Of course, if you don't write the controller in a manner to accept direct requests and return content, it'll return nothing (or throw an error).

_Note: A convention is being worked on to let you make controllers private, so even if they're requested, they'll return a 404. You'll have to do this manually for now._

### handoff

citizen allows the requested controller to give another controller the responsibility of handling the request and rendering its own view via a directive called `handoff`. The requested controller passes its content to the secondary controller, which assumes responsibility for the request, adding its own content to the context and rendering its own view.

A common use case for `handoff` would be to create a layout controller that serves as a template for every page on your site, rendering all the includes necessary and leaving only the core content and markup to the requested controller. Let's modify the article controller and view so it hands off rendering responsibility to a separate layout controller:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        article: function (emitter) {
            app.models.article.getArticle({ id: params.url.id, page: params.url.page }, emitter);
        },
        viewers: function (emitter) {
          app.models.article.getViewers(params.url.id, emitter);
        }
      }, function (output) {
        var content = {
              article: output.article,
              viewers: output.viewers
            };

        emitter.emit('ready', {
          content: content,
          handoff: {
            controller: 'layout',
            // Specifying the view is optional. The layout controller will use
            // its default view unless you tell it to use a different one.
            view: 'layout'
          }
        });
      });
    }

The layout controller handles the includes and renders its own view:

    // layout controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      emitter.emit('ready', {
        // No need to specify `content` here because citizen keeps track of the
        // article pattern's request context throughout the handoff process
        include: {
          _head: '_head',
          _header: '_header',
          _footer: '_footer'
        }
      });
    }

When you use the `handoff` directive, the originally requested view (article in this case) is rendered as an include called `_main`:

    <!-- article.hbs, which is saved into include._main -->
    <h1>
      {{article.title}}
    </h1>
    <p id="summary">
      {{article.summary}}
    </p>
    <div id="text">
      {{article.text}}
    </div>

And our layout.hbs file:

    <!DOCTYPE html>
    <html>
    {{{include._head}}}
    <body>
      {{{include._header}}}
      <main>
        {{{include._main}}}
      </main>
      {{{include._footer}}}
    </body>
    </html>

You can implement as many handoffs as you want (controller A can handoff to controller B, which can handoff to controller C, and so on), but the original controller's view will still be the one that ends up in `includes._main`.



HTTP Access Control (CORS)
--------------------------

citizen supports cross-domain HTTP requests via access control headers. By default, all controllers respond to requests from the host only. To enable cross-domain access, add an `access` object with the necessary headers to your controller's exports:

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


Helpers
-------

In addition to `listen()`, citizen includes a few more basic helper functions that it uses internally, but might be of use to you, so it returns them for public use.

### copy(object)

Creates a deep copy of an object.

    var myCopy = app.helpers.copy(myObject);

### extend(object, extension[, boolean])

Extends an object with another object, effectively merging the two objects. By default, extend() creates a copy of the original before extending it, creating a new object. If your intention is to alter the original and create a pointer, pass the optional third argument of `false`.

    var newObject = app.helpers.extend(originalObject, extensionObject);

### isNumeric(object)

Returns `true` if the object is a number, `false` if not.

    if ( app.helpers.isNumeric(url.id) ) {
      // pass it to the db
    } else {
      return 'Naughty naughty...';
    }

### dashes(string)

Convert strings into SEO-friendly versions that you can use in your URLs.

    var seoTitle = app.helpers.dashes("Won't You Read My Article?"); // 'Wont-You-Read-My-Article'


Debugging
---------

**Warning: `debug` and `development` modes are inherently insecure. Don't use them in a production environment.**

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

    {
      "debug": {
        "output": "view"
      }
    }
