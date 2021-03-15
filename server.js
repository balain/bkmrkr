// Private and Secure Bookmark Manager

const debug = require('debug')('server-js')
const config = require('config')

const fs = require('fs')

const jsdom = require('jsdom')
const { JSDOM } = jsdom

const { customAlphabet } = require('nanoid');
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnopqrstuvwxyz';
const nanoid = customAlphabet(alphabet, 8);

var express = require('express')
var session = require('express-session')
var RateLimit = require('express-rate-limit')
var limiter = new RateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
})

const DEFAULT_RECORD_COUNT = 20

var passport = require('passport')
var Strategy = require('passport-local').Strategy
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn

const bcrypt = require('bcrypt')
const crypto = require('crypto')

const https = require('https')
const http = require('http')
const got = require('got')

const fetchFavicon = require('@meltwater/fetch-favicon').fetchFavicon

var userConfig = require('./users');

const useHttps = config.has('useHttps') && config.useHttps ? true : false

let auth
if (useHttps) {
  auth = require('./config/auth.js')
}

const sqlite3 = require('sqlite3').verbose()
const dbFile = config.has('dbFile') ? config.dbFile : 'bkmrks.sqlite'

const bkmrksDb = new sqlite3.Database(dbFile, err => {
  if (err) {
    return console.error(err.message)
  }
  debug(`Connected to db: ${dbFile}`)
})


/*
Configure the local strategy for use by Passport.
  The local strategy require a `verify` function which receives the credentials
  (`username` and `password`) submitted by the user.  The function must verify
  that the password is correct and then invoke `cb` with a user object, which
  will be set at `req.user` in route handlers after authentication.
 */

passport.use(new Strategy(
  function(username, password, cb) {
    userConfig.users.findByUsername(username, function(err, user) {
      if (err) {
        debug(`err in findByUsername: ${err}`)
        return cb(err);
      }
      if (!user) {
        debug(`!user found`)
        return cb(null, false);
      }
      debug(`Found user... Comparing supplied password with hashedPwd`)
      if (!bcrypt.compareSync(password, user.hashedPwd)) {
        debug(`...***NO*** MATCH`)
        return cb(null, false);
      }
      debug(`...MATCH !!!!`)
      return cb(null, user);
    });
  }));


/*
Configure Passport authenticated session persistence.
  In order to restore authentication state across HTTP requests, Passport needs
  to serialize users into and deserialize users out of the session.  The
  typical implementation of this is as simple as supplying the user ID when
  serializing, and querying the user record by ID from the database when
  deserializing.
*/
passport.serializeUser(function(user, cb) {
  cb(null, user.id);
});

passport.deserializeUser(function(id, cb) {
  userConfig.users.findById(id, function (err, user) {
    if (err) { return cb(err); }
    cb(null, user);
  });
});

var app = express();
app.use(limiter);

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(require('morgan')('combined'));
app.use(require('body-parser').urlencoded({ extended: true }));
let sessionConfig = {
  secret: userConfig.sec.getSessionKey(),
  resave: true,
  name: 'bkmrkr',
  proxy: false,
  saveUninitialized: false,
  cookie: {
    domain: config.has('cookie') && config.cookie.has('domain')
      ? config.cookie.domain
      : '',
    httpOnly: true,
    path: '/',
    sameSite: false,
    secure: false,
    maxAge: (config.has('cookie') && config.cookie.has('maxAgeDays')
      ? config.cookie.maxAgeDays
      : 7) * 24 * 60 * 60 * 1000
  }
}
if (useHttps) {
  sessionConfig.cookie.httpOnly = false
  sessionConfig.cookie.secure = true
}
app.use(session(sessionConfig));

app.use(passport.initialize());
app.use(passport.session());

// Routes

app.get('/', (req, res) => { res.send('ok') })

app.get('/bkmrkr/',
  function (req, res) {
    debug(`get//req.session: `, req.session)
    debug(`req.user: `, req.user ? req.user.username : '')
    res.render('home', { user: req.user });
  }
);

app.get('/bkmrkr/login',
  function(req, res){
    debug(`get/login/req.session: `, req.session)
    debug(`req.user: `, req.user ? req.user.username : '')
    res.render('login', { user: req.user ? req.user : { username: 'unset' } });
  }
);
  
app.post('/bkmrkr/login', 
  passport.authenticate('local', {
    successReturnToOrRedirect: '/',
    failureRedirect: '/bkmrkr/login?msg=failed'
  }),
  function(req, res) {
    debug(`post/login/req.session: `, req.session)
    res.redirect('/bkmrkr/');
  }
);
  
app.get('/bkmrkr/logout',
  function(req, res){
    req.logout();
    res.redirect('/bkmrkr');
  }
);

app.get('/bkmrkr/profile',
  ensureLoggedIn('/bkmrkr/login'),
  function(req, res){
    debug(`profile/req.session: `, req.session)
    res.render('profile', { user: req.user });
  }
);

function getUrlMeta(link, counter = 1) {
  debug(`getUrlMeta(${link}, ${counter}) called...`)
  return new Promise((resolve, reject) => {
    got(link, {
      followRedirect: false,
      headers: {
        'user-agent': `custom bkmrkr${config.has('contact') ? ` (${config.contact})` : ''}`,
        'Accept': 'text/html' // So it will work with crates.io
      }
    })
      .then((response) => {
        debug(`...have response (len: ${response.statusCode})`)
        // Redirect?
        if (response.statusCode >= 300 && response.statusCode < 400 && counter <= 5) {
          debug(`...redirecting to ${response.headers.location}`)
          resolve(getUrlMeta(response.headers.location, ++counter))
        } else { // Valid URL
          debug(`...got valid URL; now parsing response.body (len: ${response.body.length})`)

          fetchFavicon(response.url).then((favicon) => {

          // Now get the page title and H1
          const dom = new JSDOM(response.body)

          debug(`...returning ${response.url}`)
          resolve({
                'statusMessage': response.statusMessage,
                'statusCode': response.statusCode,
                'ip': response.ip,
                'url': response.url,
                'timings': response.timings,
                'title': dom.window.document.querySelector("title").textContent,
                'favicon': favicon,
                'timestamp': new Date().getTime()
              })
          })
        }
      })
      .catch((err) => {
        console.error(err)
        reject(err)
    })
  })
}

/* TODO:
   1. Check for redirects & bookmark the final URL, not the original URL
    (look in headers.location)
 */
app.get('/bkmrkr/add',
  ensureLoggedIn('/bkmrkr/login'),
  async function (req, res) {
    debug(`req.user: `, req.user ? req.user.username : '')
    try {
      const linkMeta = await getUrlMeta(req.query.url)

      // const hash = crypto.createHash('sha256').update(req.query.url).digest('base64')
      const hash = crypto.createHash('sha256').update(linkMeta.url).digest('hex')
      const nano = nanoid()

      const sql = 'INSERT INTO bkmrks (url, user, title, hash, nanoid, favicon, created) VALUES (?, ?, ?, ?, ?, ?, ?)'

      const data = [
        linkMeta.url,
        req.user.username,
        linkMeta.title,
        hash,
        nano,
        linkMeta.favicon,
        linkMeta.timestamp]
      
      debug(`...sql: ${sql}, data: ${data}`)
      
      bkmrksDb.run(sql, data, err => {
        if (err) {
          res.send({ 'err': err.message })
        } else {          
          fs.writeFileSync(`./cache/${hash}.json`, JSON.stringify(linkMeta))
          res.type('html')
          res.write(`<H1>Saved</h1><div>link recorded (<em>${linkMeta.title ? linkMeta.title : linkMeta.url}</em>) and cache saved.</div><div>Window closing in <span id='counter'>5</span> seconds...</div>
          <script type='text/javascript'>
          function countdown() {
            var i = document.getElementById('counter');
            i.innerHTML = parseInt(i.innerHTML)-1;
     
            var isiPad = navigator.userAgent.match(/iPad/i) != null;
            var isiPhone = navigator.userAgent.match(/iPhone/i) != null;
            if (parseInt(i.innerHTML)<=0) { 
              if (isiPad || isiPhone) {
                setTimeout(window.close, 300 );
              } else {
                window.close();
              }
            }
          }          
          setInterval(function(){ countdown(); }, 1000);
          </script>`)
          res.end()
        }
      })
    } catch (err) {
      console.error(`@ 213: Caught error: ${err}`)
      res.send({ err: err })
    }
  }
)

app.get('/n/:id',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    if (req.params.id && req.params.id.length == 8) {
      const id = req.params.id
      debug(`id is ok! ${id}`)
      const sqlUpdate = `UPDATE bkmrks SET toread=? WHERE nanoid=?;`
      debug(`sqlUpdate: ${sqlUpdate}`)
      bkmrksDb.run(sqlUpdate, [ new Date().getTime(), id ], err => {
        const sqlSelect = `SELECT url FROM bkmrks WHERE nanoid=? LIMIT 1;`
        debug(`sqlSelect: ${sqlSelect}`)
        bkmrksDb.all(sqlSelect, [ id ], (err, rowsSelect) => {
          debug(`rowsSelect: `, rowsSelect)
          debug(`redirecting to ${rowsSelect[0].url}`)
          res.redirect(rowsSelect[0].url)
        })
      })
    } else {
      console.error(`Invalid nanoid supplied: ${req.params.id}`)
      res.send({err: `Invalid nanoid`})
    }
  }
)

app.get('/bkmrkr/visit/:hash',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    if (req.params.hash && req.params.hash.length == 64) {
      const hash = req.params.hash
      debug(`hash is ok! ${hash}`)
      const sqlUpdate = `UPDATE bkmrks SET toread=? WHERE hash=?;`
      debug(`sqlUpdate: ${sqlUpdate}`)
      bkmrksDb.run(sqlUpdate, [ new Date().getTime(), hash ], err => {
        const sqlSelect = `SELECT url FROM bkmrks WHERE hash=? LIMIT 1;`
        debug(`sqlSelect: ${sqlSelect}`)
        bkmrksDb.all(sqlSelect, [ hash ], (err, rowsSelect) => {
          debug(`rowsSelect: `, rowsSelect)
          debug(`redirecting to ${rowsSelect[0].url}`)
          res.redirect(rowsSelect[0].url)
        })
      })
    } else {
      console.error(`Invalid hash supplied: ${req.params.hash}`)
      res.send({err: `Invalid hash`})
    }
  }
)

app.get('/bkmrkr/count',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    bkmrksDb.all("SELECT count(*) as counter FROM bkmrks WHERE user = ?;",
      [
        req.user.username
      ], (err, rows) => {
      res.send(rows)
    })
  }
)

app.get('/bkmrkr/list',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    debug(`req.user: `, req.user ? req.user.username : '')
    bkmrksDb.all("SELECT * FROM bkmrks WHERE user = ? ORDER BY created DESC LIMIT 100;",
      [
        req.user.username
      ], (err, rows) => {
      res.send(rows)
    })
  }
)

function formatEntry(row, format = 'card') {
  let favicon = ''
  switch (format) {
    case 'card':
      favicon = row.favicon ? `<img src='${row.favicon}' alt='${row.title}' width='60px' height='60px'>` : ''

      return `
        <div class='col-sm-3'>
        <div class="card mb-3">
        <div class='row g-0'>
        <div class='col-md-4'>
        ${favicon}
        </div>
        <div class='col-md-8'>
        <div class='card-body'>
          <p class='card-text small'><a href='/n/${row.nanoid}' target='_blank' title='${row.title ? row.title : row.url}'>${row.title ? row.title : row.nanoid}</a>${row.toread && row.toread.length == 13 ? `&#128065` : ''}
          </p>
          </div>
        </div>
        </div>
        </div>
        </div>`
    case 'list':
      const dCreated = new Date(+row.created)
      let dRead = new Date(+row.toread)
      if (dRead.getFullYear() == 2021) {
        dRead = `${dRead.getMonth() + 1}/${dRead.getDate()}`
      } else {
        dRead = dRead.toLocaleDateString("en-US")
      }

      favicon = row.favicon ? `<span style='padding: 0px 4px 0px 4px'><img src='${row.favicon}' width='20px' height='20px'></span>` : ''

      return `<li><a href='/n/${row.nanoid}' target='_blank'>${favicon}${row.title ? row.title : row.url}</a> (+:${dCreated.getFullYear() == 2021 ? `${dCreated.getMonth() + 1}/${dCreated.getDate()}` : dCreated.toLocaleDateString("en-US")}${row.toread && row.toread.length == 13 ? `; &#128065: ${dRead}` : ''})`
    default:
      return `Unrecognized format: ${format}`
  }
}

app.get('/bkmrkr/display',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    const showAll = req.query.showAll && req.query.showAll == 'yes' ? true : false
    const showCount = req.query.limit ? req.query.limit : DEFAULT_RECORD_COUNT
    const offset = req.query.offset ? req.query.offset : 0
    const listFormat = req.query.format && req.query.format == 'list' ? 'list' : 'card'

    res.type(`html`)
    const mainSql = `SELECT url, title, hash, nanoid, toread, favicon, created FROM bkmrks WHERE user = ? ${showAll ? '' : ` AND (toread is null OR toread = 'yes')`} ORDER BY created DESC LIMIT ${showCount} OFFSET ${offset};`
    debug(`mainSql: ${mainSql}`)
    bkmrksDb.all(mainSql,
      [
        req.user.username
      ], (err, rows) => {
        res.write(startHtml(`Bookmarks`, listFormat, offset, showAll))

        if (rows && rows.length) {

          if (listFormat == 'card') {
            res.write(`\n<div class='row'>\n`)
          } else if (listFormat == 'list') {
            res.write(`<ul class='list-unstyled'>`)
          }

          rows.forEach((row) => {
            const dCreated = new Date(+row.created)
            let dRead = new Date(+row.toread)
            if (dRead.getFullYear() == 2021) {
              dRead = `${dRead.getMonth() + 1}/${dRead.getDate()}`
            } else {
              dRead = dRead.toLocaleDateString("en-US")
            }

            res.write(formatEntry(row, listFormat))

          })
          res.write(`</div>`)
          res.write(`<hr>`)
          if (offset > 0) {
            res.write(`<a class='btn btn-outline-primary btn-sm' href='?format=${listFormat}&offset=0&showAll=${showAll}'>First page</a>`)
          }

          res.write(`<a class='btn btn-success btn-sm' href='?format=${listFormat}&offset=${+offset + DEFAULT_RECORD_COUNT}&showAll=${showAll}'>Next page</a>
          <a class='btn btn-warn btn-sm text-right' href='?format=${listFormat == 'card' ? 'list' : 'card'}&offset=${offset}&showAll=${showAll}'>Switch Format</a>
          `)
        } else {
          res.write(`<em>No bookmarks found</em>`)
        }
        if (listFormat == 'list') {
          res.write(`</ul>`)
        }
        res.write(endHtml())
        res.end()
    })
  }
)

function startHtml(title = '', listFormat = 'card', offset = 0, showAll = 'no') {
  return (`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-BmbxuPwQa2lc/FVzBcNJ7UAyJxM6wuqIj61tLrc4wSX0szH/Ev+nYRRuWlolflfl" crossorigin="anonymous"><title>${title}</title> </head> <body>
  <div class='text-right sticky-top' style = 'top: 0; left: 0; text-align: right;' > <button type='button' class='btn btn-primary btn-sm'><a class='btn btn-primary btn-sm' href='?format=${listFormat}&offset=${offset}&${showAll ? ' showAll=no' : 'showAll=yes'}'>${showAll ? 'Show Unread Only' : 'Show All'}</a></button ></div>
  <h1>${title.length ? `${title} [${offset}-${+offset + DEFAULT_RECORD_COUNT}]` : ''}</h1>`)
}

function endHtml() {
    return(`<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta2/dist/js/bootstrap.bundle.min.js" integrity="sha384-b5kHyXgcpbZJO/tY9Ul7kGkf1S0CWuKcCD38l8YkeH8z8QjE0GmW1gYU5S9FOnJ0" crossorigin="anonymous"></script></body></html>`)
}

var options = {}

if (useHttps) {
  // SSL Keys
  options = {
    key: auth.key,
    cert: auth.cert
  };
  
  // Start the server
  var httpsServer = https.createServer(options, app)
  httpsServer.listen(config.port, () => {
    console.log(`HTTPS Server started on port ${config.port}`)
  })
} else {
  // Start the server
  var httpServer = http.createServer(options, app)
  httpServer.listen(config.port, () => {
    console.log(`HTTP Server started on port ${config.port}`)
  })
}