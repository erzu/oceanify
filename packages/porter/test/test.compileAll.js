'use strict'

const path = require('path')
const expect = require('expect.js')
const exec = require('child_process').execSync
const { readFile } = require('mz/fs')
const Porter = require('..')
const util = require('util')

const glob = util.promisify(require('glob'))

const root = path.join(__dirname, '../../porter-app')
// The root option of postcss-import seems to be not working. Let's just change the process.cwd() for now.
process.chdir(root)
const porter = new Porter({
  root,
  paths: ['components', 'browser_modules'],
  preload: 'preload',
  lazyload: ['i18n/index.js'],
  source: { root: 'http://localhost:3000/' }
})

describe('porter.compileAll()', function() {
  let entries

  before(async function() {
    exec('rm -rf ' + path.join(root, 'public'))
    await porter.compileAll({
      entries: ['home.js', 'test/suite.js', 'stylesheets/app.css']
    })
    entries = await glob('public/**/*.{css,js,map}', { cwd: root })
  })

  it('should compile entries with same-package dependencies bundled', async function () {
    const { name, version } = porter.package
    const fpath = path.join(root, `public/${name}/${version}/home.js`)
    const content = await readFile(fpath, 'utf8')
    expect(content).to.contain(`define("${name}/${version}/i18n/index.js",`)
    expect(content).to.contain('porter.lock')
  })

  it('should compile entries in all paths', async function () {
    const { name, version } = porter.package
    expect(entries).to.contain(`public/${name}/${version}/test/suite.js`)
    expect(entries).to.contain(`public/${name}/${version}/test/suite.js.map`)
  })

  it('should compile lazyload files', async function () {
    const { name, version } = porter.package
    expect(entries).to.contain(`public/${name}/${version}/i18n/index.js`)
  })

  it('should generate source map of entries', async function() {
    const { name, version } = porter.package
    const fpath = path.join(root, `public/${name}/${version}/home.js.map`)
    const map = JSON.parse(await readFile(fpath, 'utf8'))
    expect(map.sources).to.contain('components/home.js')
    expect(map.sources).to.contain('components/i18n/index.js')
    expect(map.sources).to.contain('components/i18n/zh.js')
  })

  it('should generate source map of components from other paths', async function() {
    const { name, version } = porter.package
    const fpath = path.join(root, `public/${name}/${version}/test/suite.js.map`)
    const map = JSON.parse(await readFile(fpath, 'utf8'))
    expect(map.sources).to.contain('browser_modules/test/suite.js')
    expect(map.sources).to.contain('browser_modules/cyclic-modules/suite.js')
    expect(map.sources).to.contain('browser_modules/require-directory/convert/index.js')
  })

  it('should set sourceRoot in components source map', async function() {
    const { name, version } = porter.package
    const fpath = path.join(root, `public/${name}/${version}/home.js.map`)
    const map = JSON.parse(await readFile(fpath, 'utf8'))
    expect(map.sourceRoot).to.equal('http://localhost:3000/')
  })

  it('should set sourceRoot in related dependencies too', async function() {
    const { name, version } = porter.package
    const fpath = path.join(root, `public/${name}/${version}/home.js.map`)
    const map = JSON.parse(await readFile(fpath, 'utf8'))
    expect(map.sourceRoot).to.equal('http://localhost:3000/')
  })

  it('should compile stylesheets', async function() {
    const { name, version } = porter.package
    expect(entries).to.contain(`public/${name}/${version}/stylesheets/app.css`)
  })
})
