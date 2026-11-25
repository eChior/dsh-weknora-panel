#!/usr/bin/env node
/**
 * dsh-weknora-panel 安装脚本（Windows / macOS / Linux 通用）
 *
 *   node install.mjs                # 装到默认 profile（desktop，找不到就用唯一/第一个 profile）
 *   node install.mjs --profile web  # 指定 profile
 *   node install.mjs --list         # 只列出可用 profile，不安装
 *
 * 做三件事：
 *   1. 把本目录整个复制到 <DSH_HOME>/profiles/<profile>/node_modules/dsh-weknora-panel
 *   2. 在 profile 的 package.json 里登记 dependency（file: 指向刚复制的目录）
 *   3. 把包名加进 dsh.profile.bundles
 * 不会改动 config.json —— 里面的知识库地址是随包预置的。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-weknora-panel'
const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.indexOf(name)
const argOf = (name) => {
  const i = flag(name)
  return i >= 0 ? argv[i + 1] : ''
}

const DSH_HOME = (process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
const profilesDir = path.join(DSH_HOME, 'profiles')

function copyRecursive(from, to) {
  const st = fs.statSync(from)
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const name of fs.readdirSync(from)) copyRecursive(path.join(from, name), path.join(to, name))
    return
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function fail(msg) {
  console.error('\n[安装失败] ' + msg)
  process.exit(1)
}

if (!fs.existsSync(profilesDir)) {
  fail('找不到 ' + profilesDir + '\n请确认已经安装并至少启动过一次 DeepSeek Harness（DSH）。')
}

const profiles = fs
  .readdirSync(profilesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(profilesDir, d.name, 'package.json')))
  .map((d) => d.name)

if (!profiles.length) fail('profiles 目录下没有可用的 profile：' + profilesDir)

if (flag('--list') >= 0) {
  console.log('可用 profile：' + profiles.join(', '))
  console.log('DSH_HOME = ' + DSH_HOME)
  process.exit(0)
}

const want = argOf('--profile')
let profile = want
if (!profile) {
  if (profiles.includes('desktop')) profile = 'desktop'
  else if (profiles.length === 1) profile = profiles[0]
  else fail('有多个 profile（' + profiles.join(', ') + '），请用 --profile 指定一个')
}
if (!profiles.includes(profile)) {
  fail('没有名为 ' + profile + ' 的 profile，可用：' + profiles.join(', '))
}

const profileDir = path.join(profilesDir, profile)
const target = path.join(profileDir, 'node_modules', PKG)
const pkgJsonPath = path.join(profileDir, 'package.json')

console.log('DSH_HOME : ' + DSH_HOME)
console.log('profile  : ' + profile)
console.log('安装到   : ' + target)

// 1) 复制包内容
const COPY = ['package.json', 'lib', 'viewer-official', 'vendor', 'cordis.patch.yml', 'config.json', 'README.md', 'INSTALL.md']
fs.mkdirSync(path.dirname(target), { recursive: true })
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true })
}
fs.mkdirSync(target, { recursive: true })
for (const item of COPY) {
  const from = path.join(here, item)
  if (!fs.existsSync(from)) continue
  const to = path.join(target, item)
  if (typeof fs.cpSync === 'function') fs.cpSync(from, to, { recursive: true })
  else copyRecursive(from, to)
}
console.log('已复制文件：' + COPY.filter((i) => fs.existsSync(path.join(target, i))).join(', '))

// 2) 登记 dependency + bundle
let pkg
try {
  pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
} catch (e) {
  fail('读不了 profile 的 package.json：' + e.message)
}
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies[PKG] = 'file:./node_modules/' + PKG

pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles.slice() : []
if (!bundles.includes(PKG)) bundles.push(PKG)
pkg.dsh.profile.bundles = bundles

fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('已登记依赖 + bundle：' + PKG)

// 3) 体检：配置是否可用
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(path.join(target, 'config.json'), 'utf8'))
} catch {
  cfg = {}
}
console.log('知识库地址 config.json：' + (cfg.baseUrl || '(未预置)'))
console.log('API Key：' + (cfg.apiKey ? String(cfg.apiKey).slice(0, 6) + '****' + String(cfg.apiKey).slice(-4) : '(未预置，装好后在面板右上角设置里填)'))

console.log('\n完成。重启 DeepSeek Harness 后：')
console.log('  · 左侧会出现「知识库」图标（浏览库 / 文件 / 问答）')
console.log('  · 会话里问制度类问题，回答会带上可点角标，点开在右侧栏看原文并定位到那一页')
console.log('  · 想换知识库地址：面板右上角 ⚙，或直接改 ' + path.join(target, 'config.json'))
