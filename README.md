# citizen

citizen is an event-driven MVC framework for Node.js web applications. Its purpose is to handle serving, routing, and event emitter creation, while providing some useful helpers to get you on your way; the nuts and bolts of your application are up to you. citizen favors convention over configuration, and those conventions are covered throughout this guide.

[![NPM](https://nodei.co/npm/citizen.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/citizen/)

citizen is in beta. Your comments, criticisms, and requests are appreciated.

citizen's static file serving is just a hack to get your dev environment up and running quickly. I recommend something like [nginx](http://nginx.org) as a front end for static file serving in your production environment.



## Getting Started with citizen

### Installing citizen

    $ npm install citizen



### Application Directory Structure

Here's the most basic directory structure of a citizen web app:

    app/
      patterns/
        controllers/
          index.js
        models/
          index.js // Optional
        views/
          index/
            index.jade // You can use Jade (.jade), Handlebars (.hbs), or HTML files
      start.js
    web/
      // public static assets

Here's a more complex app example (more about `config` and `on` directories later):

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
            index.jade
            index-alt.jade
      start.js
    web/



### Initializing citizen and starting the web server

The start.js file in your app directory can be as simple as this:

    // start.js

    global.app = require('citizen');

    app.start();

Run start.js from the command line:

    $ node start.js



<table>
  <thead>
    <tr>
      <th colspan="2">Objects created by citizen</th>
    </tr>
  </thead>
  <tr>
    <th><code>app.controllers</code></th>
    <td>
      Contains controllers from your supplied patterns, which you can use instead of <code>require</code>
    </td>
  </tr>
  <tr>
    <th><code>app.models</code></th>
    <td>
       Contains models from your supplied patterns, which you can use instead of <code>require</code>
    </td>
  </tr>
  <tr>
    <th><code>app.views</code></th>
    <td>
      Contains views (both raw and compiled) from your supplied patterns
    </td>
  </tr>
  <tr>
    <th><code>app.start()</code></th>
    <td>
      Starts the web server
    </td>
  </tr>
  <tr>
    <th>
      <code>app.listen()</code>
      <code>app.copy()</code>
      <code>app.extend()</code>
      <code>app.isNumeric()</code>
      <code>app.dashes()</code>
    </th>
    <td>
      <a href="#helpers">Helpers</a> used internally by citizen that you might find useful in your own app
    </td>
  </tr>
  <tr>
    <th><code>app.handlebars</code></th>
    <td>
      A pointer to the citizen Handlebars global, allowing you full access to Handlebars methods such as <code>app.handlebars.registerHelper()</code>
    </td>
  </tr>
  <tr>
    <th><code>app.jade</code></th>
    <td>
      A pointer to the citizen Jade global
    </td>
  </tr>
  <tr>
    <th><code>app.config</code></th>
    <td>
      The configuration settings you supplied at startup
    </td>
  </tr>
  <tr>
    <th><code>CTZN</code></th>
    <td>
      The global namespace used by citizen for session storage, among other things. You should not access or modify this namespace directly; anything you might need in your application will be exposed by the server to your controllers through local scopes.
    </td>
  </tr>
</table>



### Configuration

citizen tries to follow convention over configuration whenever possible, but some things are best handled by a config file.

The `config` directory is optional and contains configuration files for both citizen and your app in JSON format. You can have multiple citizen configuration files within this directory, allowing different configurations based on environment. citizen retrieves its configuration file from this directory based on the following logic:

1. citizen parses each JSON file whose name starts with "citizen" looking for a `hostname` key that matches the machine's hostname. If it finds one, it loads that configuration.
2. If it can't find a matching hostname key, it looks for a file named citizen.json and loads that configuration.
3. If it can't find citizen.json, it runs under its default configuration.

citizen also parses any other files it finds in this directory and stores the resulting configuration within `app.config`. Using the file structure above, you'd end up with `app.config.citizen` and `app.config.db`.

The following represents citizen's default configuration, which is extended by your citizen configuration file:

    {
      "mode":               "production",
      "directories": {
        "app":              "[absolute path to start.js]",
        "logs":             "[directories.app]/logs",
        "on":               "[directories.app]/on",
        "controllers":      "[directories.app]/patterns/controllers",
        "models":           "[directories.app]/patterns/models",
        "views":            "[directories.app]/patterns/views",
        "web":              "[directories.app]../web"
      },
      "urlPaths": {
        "app":              "",
        "fileNotFound":     "/404.html"
      },
      "httpPort":           80,
      "hostname":           "localhost",
      "connectionQueue":    undefined,
      "logs": {
        "console":          true,
        "file":             false
      },
      "sessions":           false,
      "sessionTimeout":     1200000, // 20 minutes
      "requestTimeout":     30000, // 30 seconds
      "mimetypes":          [parsed from internal config],
      "debug": {
        "output":           "console",
        "depth":            2,
        "jade":             false
      }
    }

`urlPaths.app` is the path name in your app's web address. If your app's URL is:

    http://www.website.com/to/my-app

`urlPaths.app` should be "/to/my-app". This is necessary for the router to work.



## Routing and URLs

Apps using citizen have a simple URL structure that determines which controller to fire, passes URL parameters, and makes a bit of room for SEO-friendly content that can double as a unique identifier. The structure looks like this:

    http://www.site.com/controller/content-description/param/val/param2/val2

For example, let's say your site's base URL is:

    http://www.cleverna.me

Requesting that URL will cause the `index` controller to fire, because the index controller is the default. The following URL will also cause the index controller to fire:

    http://www.cleverna.me/index

If you have an `article` controller, you'd request it like this:

    http://www.cleverna.me/article

Instead of query strings, citizen uses an SEO-friendly method of passing URL parameters consisting of name/value pairs. If you had to pass an article ID of 237 and a page number of 2, you'd append name/value pairs to the URL:

    http://www.cleverna.me/article/id/237/page/2

Valid parameter names may contain letters, numbers, underscores, and dashes, but must start with a letter or underscore.

citizen also lets you optionally insert relevant content into your URLs, like so:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2

This SEO content must always follow the pattern name and precede any name/value pairs. You can access it generically via `route.descriptor` or specifically via the  `url` scope (`url.article` in this case), which means you can use it as a unique identifier (more on URL parameters in the [Controllers section](#controllers)).



## MVC Patterns

citizen relies on a simple model-view-controller convention. The article pattern mentioned above might use the following structure:

    app/
      patterns/
        controllers/
          article.js
        models/
          article.js
        views/
          article/        // Matches the controller name
            article.jade  // Matches the controller name, making it the default view
            edit.jade     // Secondary view for editing an article

At least one controller is required for a given URL, and a controller's default view directory and default view file must share its name. Additional views should reside in this same directory. More on views in the [Views section](#views).

Models and views are optional and don't necessarily need to be associated with a particular controller. If your controller doesn't need a model, you don't need to create one. If your controller is going to pass its output to another controller for further processing and final rendering, you don't need to include a matching view. (See the [controller handoff directive](#controller-handoff).)



## Controllers

Each controller requires at least one public function named `handler()`:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {

      // do some stuff

      emitter.emit('ready', {
        // content and directives for the server
      });
    }

The citizen server calls `handler()` after it processes the initial request and passes it 3 arguments: an object containing the parameters of the request, the current request's context generated by the app up to this point, and an emitter for the controller to emit when it's ready to pass the results to the server.

<table>
  <thead>
    <tr>
      <th colspan="2">Contents of the <code>params</code> argument</th>
    </tr>
  </thead>
  <tr>
    <th><code>request</code></th>
    <td>The request object generated by the server, just in case you need direct access</td>
  </tr>
  <tr>
    <th><code>response</code></th>
    <td>The response object generated by the server</td>
  </tr>
  <tr>
    <th><code>route</code></th>
    <td>Details of the route, such as the requested URL and the name of the route (controller)</td>
  </tr>
  <tr>
    <th><code>url</code></th>
    <td>Any URL parameters that were passed including the descriptor, if provided</td>
  </tr>
  <tr>
    <th><code>form</code></th>
    <td>Data collected from a POST</td>
  </tr>
  <tr>
    <th><code>payload</code></th>
    <td>Data collected from a PUT</td>
  </tr>
  <tr>
    <th><code>cookie</code></th>
    <td>An object containing any cookies that were sent with the request</td>
  </tr>
  <tr>
    <th><code>session</code></th>
    <td>An object containing any session variables, if sessions are enabled</td>
  </tr>
</table>

In addition to having access to these objects within your controller, they are also included in your view context automatically so you can reference them within your view templates as local variables (more details in the <a href="#views">Views section</a>).

For example, based on the previous article URL...

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2

...you'll have the following `params.url` object passed to your controller:

    {
      article: 'My-Clever-Article-Title',
      page: 2
    }

The controller name becomes a property in the URL scope that contains the SEO content, which makes it well-suited for use as a unique identifier. This content is also available in the `route` object as `route.descriptor`.

The `context` argument contains any output that's been generated by the request up to this point. There are various events that can populate this argument with content and directives, which are then passed to your controller so you can access that content or see what directives have been set by previous events.

The `emitter` argument is the method by which the controller lets the server know that it's done with its tasks and ready to render the result. The emitter should emit a "ready" event when the controller has accomplished its task. This lets the server know it's okay to proceed. As part of this event, the emitter should include any view content and [directives](#emitter-directives) for the server.

Using the above URL parameters, I can retrieve the article content from the model and pass it back to the server:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      // Get the article content
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      // Emit the 'ready' event and pass any objects you want added to the view
      // context via the content object
      emitter.emit('ready', {
        content: {
          article: article
        }
      });
    };

The second argument in `emitter.emit` is an object containing any data you want to pass back to citizen. All the content you want to render in your view should be passed to citizen within an object called `content`, as shown above. Additional objects can be passed to citizen to set directives that provide instructions to the server (explained later in the <a href="#emitter-directives">Emitter Directives</a> section). You can even add your own objects to the request context and pass them from controller to controller (more in the [Controller Handoff section](#controller-handoff).)

### Private controllers

To make a controller private--inaccessible via HTTP, but accessible within your app--add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          _head.js     // Partial, accessible via www.cleverna.me/_head
          +_header.js  // Partial, only accessible internally
          article.js   // Accessible via www.cleverna.me/article



## Models

Models are optional and their structure is completely up to you. citizen doesn't talk to your models directly; it only stores them in `app.models` for your convenience.

Here's a simple static model for the article pattern:

    // article model

    exports.getArticle = getArticle;

    function getArticle(article, page) {
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
        title: articles[article]['title'],
        summary: articles[article]['summary'],
        text: articles[article]['pages'][page]
      };
    };


## Views

citizen supports [Jade](https://www.npmjs.org/package/jade) and [Handlebars](https://npmjs.org/package/handlebars) templates, as well as good old HTML. You can even mix and match Jade, Handlebars, and HTML templates as you see fit; just use the appropriate file extensions (.jade, .hbs, or .html) and citizen will compile and render each view with the appropriate engine.

You have direct access to each engine's methods via `app.handlebars` and `app.jade`, allowing you to use methods like `app.handlebars.registerHelper()` to create global helpers. Keep in mind that you're extending the global Handlebars and Jade objects, potentially affecting citizen's view rendering if you do anything wacky because citizen relies on these same objects.

In `article.jade`, you can reference objects you placed within the `content` object passed by the emitter. citizen also injects the `params` object into your view context automatically, so you have access to those objects as local variables (such as the `url` scope):

    // article.jade

    doctype html
    html
      body
        main
          h1 #{article.title} - Page #{url.page}
          p#summary #{article.summary}
          #text #{article.text}

citizen sends HTML to the client by default, but you can also return JSON and JSONP with no extra work on your part.

### JSON

You don't need a custom view just for JSON. You can tell a controller to return its content as plain text JSON by adding the `format` URL parameter.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json

Returns...

    {
      "article": {
        "My-Clever-Article-Title": {
          "title": "My Clever Article Title",
          "summary": "Am I not terribly clever?",
          "text": "Second page content"
        }
      }
    }

Whatever you've added to the controller's emitter `content` object will be returned. (The line breaks are just for readability. The actual output is compressed.)

### JSONP

JSONP is pretty much the same. Use `format` and `callback` in the URL:

    http://www.cleverna.me/article/My-Clever-Article-Title/format/jsonp/callback/foo

Returns:

    foo({
      "article": {
        "My-Clever-Article-Title": {
          "title": "My Clever Article Title",
          "summary": "Am I not terribly clever?",
          "text": "Second page content"
        }
      }
    });

If you want to make a controller available to third party sites, see the [CORS section](#cross-origin-resource-sharing-cors).

### Rendering alternate views

By default, the server renders the view whose name matches that of the controller. To render a different view, [use the `view` directive in your emitter](#alternate-views).



## Emitter Directives

In addition to the view content, the controller's `ready` emitter can also pass directives to render alternate views, set cookies and session variables, initiate redirects, call and render includes, and hand off the request to another controller for further processing.


### Alternate Views

By default, the server renders the view whose name matches that of the controller. To render a different view, use the `view` directive in your emitter:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      emitter.emit('ready', {
        content: {
          article: article
        },
        // This tells the server to render app/patterns/views/article/edit.jade
        view: 'edit'
      });
    }


### Cookies

You set cookies by appending a `cookie` object to the emitter context.

A complete cookie object's default values:

    cookie.foo = {
      value: '',
      // Valid expiration options are:
      // 'now' - deletes an existing cookie
      // 'never' - current time plus 30 years, so effectively never
      // 'session' - expires at the end of the browser session (default)
      // [time in milliseconds] - length of time, added to current time
      expires: 'session',
      path: '/',
      httpOnly: true,
      secure: false
    }

The following sample login controller tells the server to set `username` and `passwordHash` cookies that never expire:

    // login controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      var authenticate = app.models.login.authenticate({
            // Form values, just like URL parameters, are passed via the params
            // argument
            username: params.form.username,
            password: params.form.password
          }),
          cookie = {};

      if ( authenticate.success ) {
        cookie = {
          // The cookie gets its name from the property name
          username: {
            value: authenticate.username,
            expires: 'never'
          },
          passwordHash: {
            value: authenticate.passwordHash,
            expires: 'never'
          }
        };
      }

      emitter.emit('ready', {
        content: {
          authenticate: authenticate
        },
        cookie: cookie
      });
    };

The following code sets the same cookies, but they expire at the end of the browser session:

    cookie.username.value = authenticate.username;
    cookie.passwordHash.value = authenticate.passwordHash;

Cookies sent by the client are available in `params.cookie` within the controller and simply `cookie` within the view context:

    doctype html
    html
      body
        #welcome
          if cookie.username
            | Welcome, #{cookie.username}.
          else
            a(href="/login") Login

Cookie variables you set within your controller aren't immediately available within the `params.cookie` scope. citizen's server has to receive the emitter's ready event from the controller before it can send the cookie to the client, so use a local instance of the variable if you need to access it during the same request.



### Session Variables

If sessions are enabled, citizen creates an object called `CTZN.sessions` to store session information. Don't access this object directly; use `params.session` in your controller or simply `session` within views. These local scopes reference the current user's session without having to pass a session ID.

By default, the session has four properties: `id`, `started`, `expires`, and `timer`. The session ID is also sent to the client as a cookie called `ctznSessionID`.

Setting session variables is pretty much the same as setting cookie variables:

    session.username = 'Danny';
    session.nickname = 'Doc';

    emitter.emit('ready', {
      content: content,
      session: session
    });

Sessions expire based on the `sessionTimeout` config property, which represents the length of a session in milliseconds. The default is 20 minutes. The `timer` is reset with each request. When the `timer` runs out, the session is deleted. Any client requests after that time will generate a new session ID and send a new session ID cookie to the client. Remember that the browser's session is separate from the server's session, so any cookies you've set with an expiration of `session` are untouched if the user's session expires on the server. You need to clear those cookies manually at the start of the next server session if you don't want them hanging around.

To forcibly clear and expire the current user's session:

    session.expires = 'now';

This won't end the session immediately. citizen has to receive your controller's response before it can act on this directive.

Like cookies, session variables you've just assigned aren't available during the same request within the `params.session` scope, so use a local instance if you need to access this data right away.



### Redirects

You can pass redirect instructions to the server that will be initiated after the request is complete. Redirects using this method within the controller are not immediate, so the controller will do everything it's been asked to do before the redirect is processed. The user agent won't receive a full response, however. No view content will be rendered or sent, but cookies and session variables will be set if specified.

The `redirect` object takes two properties: `statusCode` and `url`. If you don't provide a status code, citizen uses 302 (temporary redirect).

    redirect = {
      statusCode: 301,
      url: 'http://redirect.com'
    };

    emitter.emit('ready', {
      content: content,
      redirect: redirect
    });

### Include Patterns

citizen lets you use complete MVC patterns as includes. These includes are more than just chunks of code that you can reuse because each has its own controller, model, and view(s).

Let's say our article pattern's Jade template has the following contents. The head section contains dynamic meta data, and the header nav's content changes depending on whether the user is logged in or not:

    doctype html
    html
      head
        title #{metaData.title}
        meta(name="description" content="#{metaData.description}")
        meta(name="keywords" content="#{metaData.keywords}")
        link(rel="stylesheet" type="text/css" href="app.css")
      body
        header
          a#logo Home page
          if cookie.username
            p Welcome, #{cookie.username}
          nav
            ul
              li
                a(href="/") Home
              li
                a(href="/articles") Articles
              if cookie.username
                li
                  a(href="/admin") Site Administration
        main
          h1 #{article.title} - Page #{url.page}
          p#summary #{article.summary}
          #text #{article.text}

It probably makes sense to use includes for the head section and header because you'll use that code everywhere, but rather than simple partials, let's create citizen includes. The head section can use its own model for populating the meta data, and since the header is different for authenticated users, let's pull that logic out of the template and set up different header views in our controller. I like to follow the convention of starting partials with an underscore, but that's up to you:

    app/
      patterns/
        controllers/
          _head.js
          _header.js   // Doesn't generate data, so it doesn't need a model
          article.js
        models/
          _head.js
          article.js
        views/
          _head/
            _head.jade
          _header/
            _header.jade
            _header-authenticated.jade // A different header for logged in users
          article/
            article.jade

citizen include patterns have the same requirements as regular patterns, including a controller with a `handler()` function. When the article controller is fired, it has to tell citizen which includes it needs. We do that with the `include` directive, which we pass via the context in the emitter:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page),
          // We'll use the standard header by default, _header.jade
          headerView = '_header';

      // If the user is logged in, use _header-authenticated.jade
      if ( cookie.username ) {
        headerView = '_header-authenticated';
      }

      emitter.emit('ready', {
        content: content,
        include: {
          _head: {
            // The default view is rendered if no view is specified
            controller: '_head'
          },
          _header: {
            controller: '_header',
            view: headerView
          }
        }
      });
    }

This tells citizen to call the _head and _header controllers, pass them the existing request context, render their respective views, and add them to the view context.

The rendered includes are stored in the `include` scope. The `include` object contains rendered HTML views, so you need to skip escaping (`!=` in Jade, `{{{...}}}` in Handlebars):

    doctype html
    html
      != include._head
      body
        != include._header
        main
          h1 #{article.title} - Page #{url.page}
          p#summary #{article.summary}
          #text #{article.text}

citizen includes can generate content and add it to the view context of your primary controller (article.js in this example) because the primary view is the last to be rendered. However, includes are called and rendered asynchronously, so while your _header controller can generate content and add it to the view context of your article controller, don't assume that the other includes' controllers will have access to that data. (The option of waterfall execution is being worked on, so this is only true for the time being.)

citizen includes can also pass all [emitter directives](#emitter-directives) **except for [handoff](#controller-handoff)**.

**A pattern meant to be used as an include can be accessed via URL just like any other controller.** You could request the `_head` controller like so:

    http://cleverna.me/_head

Perhaps you'd have it return meta data as JSON for the article pattern:

    // http://cleverna.me/_head/article/My-Clever-Article-Title/format/json

    {
      "metaData": {
        "title": "My Clever Article Title",
        "description": "My article's description.",
        "keywords": "clever, article, keywords"
      }
    }

Here's an example of the `_head` controller written as both an include and a handler of direct requests:

    // _head controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      var metaData,
          // If the article URL param exists, use that. Otherwise, assume _head is
          // being used as an include and use the requested route.
          getMetaDataFor = params.url.article || params.route.controller;

      if ( app.models[getMetaDataFor] && app.models[getMetaDataFor].getMetaData ) {
        metaData = app.models[getMetaDataFor].getMetaData();
      }

      emitter.emit('ready', {
        content: {
          metaData: metaData
        }
      });
    }

Of course, if you don't write the controller in a manner to accept direct requests and return content, it'll return nothing (or throw an error).

**Reminder:** To make a controller private--inaccessible via HTTP, but accessible within your app--add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          _head.js     // Accessible via www.cleverna.me/_head
          +_header.js  // Only accessible internally
          article.js   // Accessible via www.cleverna.me/article

#### Should I use a citizen include or a Jade include/Handlebars partial?

citizen includes provide rich functionality, but they do have limitations and can be overkill in certain situations.

* **Do you only need to share a chunk of markup across different views?** Use a standard Handlebars partial, Jade template, or HTML document. The syntax is easy and you don't have to create a full MVC pattern like you would with a citizen include.
* **Do you need to loop over a chunk of markup to render a data set?** The server processes citizen includes and returns them as fully-rendered HTML, not compiled templates. You can't loop over them and inject data like you can with Handlebars partials or Jade includes.
* **Do you need to retrieve additional content that isn't in the parent view's context?** A citizen include can do anything that a standard MVC pattern can do except set the [handoff](#controller-handoff) directive. If you want to retrieve additional data and add it to the view context or set cookies and session variables, a citizen include is the way to go.
* **Do you need the ability to render different includes based on business logic?** citizen includes can have multiple views because they're full MVC patterns. Using a citizen include, you can place logic in the include's controller and request different views based on that logic. Using Handlebars partials or Jade includes would require registering multiple partials and putting the logic in the view template.
* **Do you want the include to be accessible from the web?** Since a citizen include has a controller, you can request it like any other controller and get back HTML, JSON, or JSONP, which is great for AJAX requests and single page apps.

### Controller Handoff

citizen allows the requested controller to give another controller the responsibility of handling the request and rendering its own view via a directive called `handoff`. The requested controller passes its content and directives to a secondary controller that assumes responsibility for the request, adding its own content and directives and rendering its own view. This is also a method for passing your own custom content and directives to the receiving controller.

A common use case for `handoff` would be to create a layout controller that serves as a template for every page on your site, rendering all the includes necessary and leaving only the core content and markup to the initially requested controller. Let's modify the article controller and view so it hands off rendering responsibility to a separate layout controller:

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      emitter.emit('ready', {
        content: {
          article: article
        },
        handoff: {
          // Pass this request to app/patterns/controller/layout.js
          controller: 'layout',

          // Specifying the view is optional. The layout controller will use its
          // default view unless you tell it to use a different one.
          view: 'layout',

          // Rendering the requested controller's view is optional.
          // Using includeView tells citizen to render the article.jade view and
          // store it in the include scope. If you don't specify the includeView,
          // the article controller's view won't be rendered.
          includeView: 'article'
        },

        // A custom directive to drive some logic in the layout controller.
        // You could even pass a function here for layout to call.
        // Just don't use any reserved citizen directive names!
        myDirective: {
          doSomething: true
        }
      });
    }

When you use the `handoff` directive and specify the `includeView` like we did above, the originally requested view (article.jade in this case) is rendered as an include whose name matches its controller:

    // article.jade, which is stored in the include scope as include.article

    h1 #{article.title}
    p#summary #{article.summary}
    #text #{article.text}

The layout controller handles the includes, follows your custom directive, and renders its own view:

    // layout controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      // We'll use the standard header by default
      var headerView = '_header';

      // If the user is logged in, use a different header view
      if ( cookie.username ) {
        headerView = '_header-authenticated';
      }

      // Access my custom directive using the context argument
      if ( context.myDirective && context.myDirective.doSomething ) {
        doSomething();
      }

      emitter.emit('ready', {
        // No need to specify `content` here because citizen keeps track of the
        // article pattern's request context throughout the handoff process
        include: {
          _head: {
            controller: '_head'
          },
          _header: {
            controller: '_header',
            view: headerView
          }
        }
      });
    }

    function doSomething() {
      // do something
    }

And our layout.jade file:

    // layout.jade

    doctype html
    html
      != include._head
      body
        != include._header
        main
          // You could use include.article here, but remember the route object?
          // It contains useful details about the route, like the original
          // controller's name. Now you can use this layout for any pattern.
          != include[route.controller]


#### Chaining controllers

You can use `handoff` to chain requests across as many controllers as you want, with each controller's directives added to the request context and each controller's view optionally added to the include scope. The initially requested controller's name and all following handoff controllers' names are stored in the `route` object as an array called `route.chain`. You can loop over this object to render all the included views:

    // layout.jade

    doctype html
    html
      != include._head
      body
        != include._header
        main
          // Include every view that was rendered via handoff
          each val in route.chain
            != include[val]



# Application Events and the Context Argument

Certain events will occur throughout the life of your citizen application. You can act on these application events, execute functions, set directives, and pass the results to the next event or your controller via the `context` argument. For example, you might set a custom cookie at the beginning of every new session, or check for cookies at the beginning of every request and redirect the user to a login page if they're not authenticated.

To take advantage of these events, include a directory called "on" in your app with the any or all of follwowing modules and exports:

    app/
      on/
        application.js // exports start(), end(), and error()
        request.js     // exports start() and end()
        response.js    // exports start() and end()
        session.js     // exports start() and end()

`request.start()`, `request.end()`, and `response.start()` are called before your controller is fired, so the output from those events is passed from each one to the next, and ultimately to your controller via the `context` argument. Exactly what they output--content, citizen directives, custom directives--is up to you.

All files and exports are optional. citizen only calls them if they exist. For example, you could have only a request.js module that exports `start()`.

_Note: As of this version, session end() and application end() aren't functional. They'll be in a future version._

Here's an example of a request module that checks for a username cookie at the beginning of every request and redirects the user to the login page if it doesn't exist. We also avoid a redirect loop by making sure the requested controller isn't the login controller:

    // app/on/request.js

    exports.start = start;

    function start(params, context, emitter) {
      var redirect = {};

      if ( !params.cookie.username && params.route.controller !== 'login' ) {
        redirect.url = '/login';
      }

      emitter.emit('ready', {
        redirect: redirect
      });
    };



## Cross-Origin Resource Sharing (CORS)

citizen supports cross-domain HTTP requests via access control headers. By default, all controllers respond to requests from the host only. This includes POST requests, which makes any controller that accepts form input safe from cross-site form submissions.

To enable cross-domain access, add an `access` object with the necessary headers to your controller's exports:

    module.exports = {
      handler: handler,
      access: {
        // citizen expects header names in lowercase (per the spec, HTTP headers are
        // case-insensitive)
        'access-control-allow-origin': 'http://www.foreignhost.com',
        'access-control-expose-headers': 'X-My-Custom-Header, X-Another-Custom-Header',
        'access-control-max-age': 1728000,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'OPTIONS, PUT',
        'access-control-allow-headers': 'Content-Type',
        'vary': 'Origin'
      }
    };

For more details on CORS, check out [the W3C spec](http://www.w3.org/TR/cors/) and [the Mozilla Developer Network](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS).


## Helpers

citizen has a few basic helper functions that it uses internally, but might be of use to you, so it returns them for public use.

### listen({ functions }, callback)

The article example we've been using has only simple methods that return static content immediately, but things are rarely that simple. The `listen()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listen()` functions for very powerful asynchronous function calls.

`listen()` takes two arguments: an object containing one or more methods you want to call, and a callback to handle the output. `listen()` requires that your functions be written to accept an `emitter` argument, which is how your function notifies `listen()` that it's ready.

Let's say our article model has two methods that need to be called before returning the results to the controller. One is called `getArticle()` and the other is `getViewers()`. Assume both methods make an asynchronous call to a database and can't be relied upon to return their output immediately, so we have to listen for when they're ready and then react.

    // article controller

    exports.handler = handler;

    function handler(params, context, emitter) {
      app.listen({
        // The property contains the action you want to listen for, which is
        // wrapped in an anonymous function in order to pass the emitter
        article: function (emitter) {
          app.models.article.getArticle(params.url.article, params.url.page, emitter);
        },
        viewers: function (emitter) {
          app.models.article.getViewers(params.url.article, emitter);
        }
      }, function (output) {
        // Emit `ready` now that we have the output from article and viewers and
        // pass the context back to the server
        emitter.emit('ready', {
          content: {
            // The property names you assign to the methods above become the names
            // of the output objects
            article: output.article,
            viewers: output.viewers
          }
        });
      });
    }

And the model:

    // article model

    module.exports = {
      getArticle: getArticle,
      getViewers: getViewers
    };

    // Methods called via listen() must be written to accept an emitter
    function getArticle(article, page, emitter) {
      app.db.article({ article: article, page: page }, function (data) {
        // When the database returns the data, emit `ready` and pass the
        // data back to listen()
        emitter.emit('ready', data);
      });
    };

    function getViewers(article, emitter) {
      app.db.viewers({ article: article }, function (data) {
        emitter.emit('ready', data);
      });
    };

`listen()` currently fires all functions asynchronously and returns the results for every function in a single output object after all functions have completed. A waterfall-type execution is being worked on, but in the meantime, you can nest `listen()` functions to achieve the same effect:

    app.listen({
      first: function (emitter) {
        doSomething(emitter);
      }
    }, function (output) {
      app.listen({
        second: function (emitter) {
          doNextThing(output.first, emitter);
        }
      }, function (output) {
        app.listen({
          third: function (emitter) {
            doOneMoreThing(output.second, emitter);
          }
        }, function (output) {
          thisIsExhausting(output.third);
        });
      });
    });

### copy(object)

Creates a deep copy of an object.

    var myCopy = app.copy(myObject);

### extend(object, extension)

Extends an object with another object, effectively merging the two objects. extend() creates a copy of the original before extending it, creating a new object. Nested objects are also merged, but properties in the original object containing arrays are overwritten by the extension (arrays aren't merged).

    var newObject = app.extend(originalObject, extensionObject);

### isNumeric(object)

Returns `true` if the object is a number, `false` if not.

    if ( app.isNumeric(params.url.id) ) {
      // pass it to the db
    } else {
      return 'Naughty naughty...';
    }

### dashes(string)

Convert strings into SEO-friendly versions that you can use in your URLs.

    var seoTitle = app.dashes("Won't You Read My Article?"); // 'Wont-You-Read-My-Article'


## Debugging

**Warning: `debug` and `development` modes are inherently insecure. Don't use them in a production environment.**

If you set `"mode": "debug"` in your config file, citizen dumps the current pattern's output to the console by default. You can also dump it to the view by setting `debug.output` in your config file to `view`, or use the `ctzn_dump` URL parameter on a per-request basis:

    // config file: always dumps debug output in the view
    {
      "debug": {
        "output": "view"
      }
    }

    // URL
    http://www.cleverna.me/article/id/237/page/2/ctzn_dump/view

By default, the pattern's complete output is dumped. You can specify the exact object to debug with the `ctzn_debug` URL parameter. You can access globals, `pattern`, and server `params`:

    // Dumps pattern.content to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/pattern.content

    // Dumps the server params object to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params

    // Dumps the user's session to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session

    // Dumps the user's session to the view
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session/ctzn_dump/view

In `development` mode, you must specify the `ctzn_debug` URL parameter to enable debug output. Debug output is disabled in production mode.
