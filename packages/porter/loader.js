/* eslint-env browser */
/* eslint-disable semi-spacing, strict */
(function(global) {

  // do not override
  if (global.porter) return

  var ArrayFn = Array.prototype

  if (!Object.assign) {
    Object.assign = function() {
      var args = ArrayFn.slice.call(arguments)
      var target = args.shift()

      while (args.length) {
        var source = args.shift()

        for (var p in source) {
          if (source != null) {
            if (source.hasOwnProperty(p)) {
              target[p] = source[p]
            }
          }
        }
      }

      return target
    }
  }

  if (!Date.now) {
    Date.now = function() {
      return +new Date()
    }
  }


  var system = { lock: {}, registry: {} }
  var lock = system.lock
  var registry = system.registry
  Object.assign(system, process.env.loaderConfig)
  var baseUrl = system.baseUrl
  var pkg = system.package


  function onload(el, callback) {
    if ('onload' in el) {
      el.onload = function() {
        callback()
      }
      el.onerror = function() {
        callback(new Error('Failed to fetch ' + el.src))
      }
    }
    else {
      // get called multiple times
      // https://msdn.microsoft.com/en-us/library/ms534359(v=vs.85).aspx
      el.onreadystatechange = function() {
        if (/loaded|complete/.test(el.readyState)) {
          callback()
        }
      }
    }
  }

  var request

  if (typeof importScripts == 'function') {
    /* eslint-env worker */
    request = function loadScript(url, callback) {
      try {
        importScripts(url)
      } catch (err) {
        return callback(err)
      }
      callback()
    }
  }
  else {
    var doc = document
    var head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement
    var baseElement = head.getElementsByTagName('base')[0] || null

    request = function loadScript(url, callback) {
      var el = doc.createElement('script')

      onload(el, function(err) {
        el = el.onload = el.onerror = el.onreadystatechange = null
        // head.removeChild(el)
        callback(err)
      })
      el.async = true
      el.src = url

      // baseElement cannot be undefined in IE8-.
      head.insertBefore(el, baseElement)
    }
  }


  /*
   * resolve paths
   */
  var RE_DIRNAME = /([^?#]*)\//
  var RE_DUPLICATED_SLASH = /(^|[^:])\/\/+/g

  function dirname(fpath) {
    var m = fpath.match(RE_DIRNAME)
    return m ? m[1] : '.'
  }

  function resolve() {
    var args = ArrayFn.slice.call(arguments)
    var base = args.shift()
    var levels = base ? base.split('/') : []

    while (args.length) {
      var parts = args.shift().split('/')
      while (parts.length) {
        var part = parts.shift()
        if (part === '..') {
          if (levels.length) {
            levels.pop()
          } else {
            throw new Error('Top level reached.')
          }
        }
        else if (part !== '.') {
          levels.push(part)
        }
      }
    }

    for (var i = levels.length - 1; i >= 0; i--) {
      if (levels[i] === '.') levels.splice(i, 1)
    }

    return levels.join('/').replace(RE_DUPLICATED_SLASH, '$1/')
  }


  function suffix(id) {
    return /\.(?:css|js)$/.test(id) ? id : id + '.js'
  }


  /*
   * Resovle id with the version tree
   */
  var rModuleId = /^((?:@[^\/]+\/)?[^\/]+)(?:\/(\d+\.\d+\.\d+[^\/]*))?(?:\/(.*))?$/

  function parseId(id) {
    var m = id.match(rModuleId)
    return { name: m[1], version: m[2], file: m[3] }
  }


  function parseMap(uri) {
    var map = system.map
    var ret = uri

    if (map) {
      for (var pattern in map) {
        ret = uri.replace(new RegExp('^' + pattern), map[pattern])
        // Only apply the first matched rule
        if (ret !== uri) break
      }
    }

    return ret
  }


  /**
   * To match against following uris:
   * - https://example.com/foo.js
   * - http://example.com/bar.js
   * - //example.com/baz.js
   * - /qux.js
   */
  var rUri = /^(?:https?:)?\//

  function parseUri(id) {
    var id = parseMap(id)

    if (rUri.test(id)) return id

    var obj = parseId(id)
    var name = obj.name
    var version = obj.version

    if (name !== pkg.name) {
      if (lock[name][version].bundle) {
        return resolve(baseUrl, name, version, '~bundle.js')
      }
    }

    var url = resolve(baseUrl, id)
    if (pkg.entries[obj.file]) url += '?entry'
    return url
  }


  var MODULE_INIT = 0
  var MODULE_FETCHING = 1
  var MODULE_FETCHED = 2
  var MODULE_LOADED = 3
  var MODULE_ERROR = 4

  /**
   * The Module class
   * @param {string} id
   * @param {Object} opts
   * @param {string[]} opts.deps
   * @param {function} opts.factory
   * @example
   * new Module('jquery/3.3.1/dist/jquery.js')
   * new Module('//g.alicdn.com/alilog/mlog/aplus_v2.js')
   */
  function Module(id, opts) {
    opts = opts || {}
    this.id = id
    this.deps = opts.deps
    this.children = []
    this.factory = opts.factory
    this.exports = {}
    this.status = MODULE_INIT
    registry[id] = this
  }

  var fetching = {}

  Module.prototype.fetch = function() {
    var mod = this

    if (mod.status < MODULE_FETCHING) {
      mod.status = MODULE_FETCHING
      var uri = parseUri(mod.id)
      if (fetching[uri]) return
      fetching[uri] = true
      request(uri, function(err) {
        if (err) mod.status = MODULE_ERROR
        if (mod.status < MODULE_FETCHED) mod.status = MODULE_FETCHED
        mod.uri = uri
        mod.ignite()
      })
    }
  }

  var rWorkerLoader = /^worker-loader[?!]/

  Module.prototype.resolve = function() {
    var mod = this
    var children = mod.children = []

    if (mod.deps) {
      mod.deps.forEach(function(depName) {
        if (rWorkerLoader.test(depName)) return
        var depId = Module.resolve(depName, mod.id)
        children.push(registry[depId] || new Module(depId))
      })
    }

    children.forEach(function(child) {
      if (!child.parent) child.parent = mod
      child.fetch()
    })
  }

  Module.prototype.ignite = function() {
    var mod = this
    var allset = true

    for (var id in registry) {
      if (registry[id].status < MODULE_FETCHED) {
        allset = false
        break
      }
    }

    if (allset) {
      var ancestor = mod
      while (ancestor.parent) {
        ancestor = ancestor.parent
      }
      ancestor.execute()
    }
  }

  Module.prototype.execute = function() {
    var factory = this.factory
    var mod = this
    var context = dirname(mod.id)

    if (mod.status >= MODULE_LOADED) return

    function require(id) {
      if (rWorkerLoader.test(id)) {
        return workerFactory(context)(id.split('!').pop())
      }
      id = Module.resolve(id, mod.id)
      var dep = registry[id]

      if (dep.status < MODULE_FETCHED) {
        throw new Error('Module ' + id + ' is not ready')
      }
      else if (dep.status < MODULE_LOADED) {
        dep.execute()
      }

      return dep.exports
    }

    require.async = importFactory(context)
    require.worker = workerFactory(context)
    mod.status = MODULE_LOADED

    var exports = typeof factory === 'function'
      ? factory.call(null, require, mod.exports, mod)
      : factory

    if (exports) mod.exports = exports
  }

  /**
   * @param {string} id
   * @param {string} context
   * @example
   * Module.resolve('./lib/foo', 'app/1.0.0/home')
   * Module.resolve('lib/foo', 'app/1.0.0/home')
   * Module.resolve('react', 'app/1.0.0')
   */
  Module.resolve = function(id, context) {
    if (rUri.test(id)) return id
    if (id.charAt(0) === '.') id = resolve(dirname(context), id)

    // if lock is not configured yet (which happens if the app is a work in progress)
    if (!lock[pkg.name]) return suffix(resolve(pkg.name, pkg.version, id))

    var parent = parseId(context)
    var opts = lock[parent.name][parent.version]

    var mod = parseId(id)
    if (!(mod.name in lock)) {
      mod = { name: pkg.name, version: pkg.version, file: id }
    }
    var name = mod.name
    var version = mod.version
    var map

    if (version) {
      map = lock[name][version]
    }
    else if (opts && opts.dependencies && (name in opts.dependencies)) {
      if (!version) version = opts.dependencies[name]
      map = lock[name][version]
    }

    var file = mod.file || map.main
    if (map.alias) file = map.alias[file] || file
    return resolve(name, version, suffix(file || 'index.js'))
  }


  function define(id, deps, factory) {
    if (!factory) {
      factory = deps
      deps = []
    }
    id = suffix(id)
    var mod = registry[id] || new Module(id)

    mod.deps = deps
    mod.factory = factory
    mod.status = MODULE_FETCHED
    mod.resolve()
  }

  function importFactory(context) {
    var entryId = 'import-' + (+new Date()).toString(36) + '.js'

    return function(ids, fn) {
      ids = [].concat(ids)
      ids.forEach(function(id) { pkg.entries[suffix(id)] = true })
      define(resolve(context, entryId), ids, function(require) {
        var mods = ids.map(function(id) { return require(id) })
        if (fn) fn.apply(null, mods)
      })
    }
  }

  function workerFactory(context) {
    return function(id) {
      var url = resolve(baseUrl, context, id).replace(/(?:\.js)?$/, '.js')
      return function createWorker() {
        return new Worker([url, 'main'].join(url.indexOf('?') > 0 ? '&' : '?'))
      }
    }
  }

  Object.assign(system, {
    'import': function Porter_import(entry, fn) {
      entry = suffix(entry)
      var mod = parseId(entry)
      if (mod.version) entry = mod.file
      var context = pkg.name + '/' + pkg.version
      importFactory(context)(entry, fn)
    }
  })

  global.define = define
  global.porter = system

  global.process = {
    env: {
      BROWSER: true,
      NODE_ENV: process.env.NODE_ENV
    }
  }
})(this)

if (process.env.NODE_ENV != 'production' && 'serviceWorker' in navigator && (location.protocol == 'https:' || location.hostname == 'localhost')) {
  navigator.serviceWorker.register('/porter-sw.js', { scope: '/' }).then(function(registration) {
    if (registration.waiting || registration.active) {
      var worker = registration.waiting || registration.active
      var porter = self.porter

      worker.postMessage({
        type: 'loaderConfig',
        data: { cache: porter.cache }
      })
    }
  })
}
