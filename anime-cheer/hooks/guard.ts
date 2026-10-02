// Security checks: shell commands that should not run unasked, and secrets
// that should not be written or committed. Pure: the hooks module asks here,
// then blocks, warns or reports. Pattern matching is best effort, not a sandbox.

export type Risk = { rule: string; zh: string }

// ── Reading a shell script ───────────────────────────────────────────────

// One command of a pipeline: its name (no path, no wrapper such as `sudo`),
// its arguments with the quotes taken off, and both as one text.
type Stage = { name: string; args: string[]; text: string }
// Stages joined by `|`, and what joins the pipeline to the next one.
type Pipeline = { stages: Stage[]; then: '&&' | '||' | ';' | '' }
type Script = { pipelines: Pipeline[]; inner: string[] }
type Heredoc = { row: string; body: string }

// A heredoc's body is data (a file being written, a script for python), not
// shell: left out, unless a shell reads it (`bash <<EOF`).
function readHeredocs(script: string): { text: string; docs: Heredoc[] } {
  const kept: string[] = []
  const docs: Heredoc[] = []
  let until: string | undefined
  let isShell = false
  let body: string[] = []
  let opener = ''
  for (const row of script.split('\n')) {
    if (until !== undefined) {
      if (row.trim() === until) {
        docs.push({ row: opener, body: body.join('\n') })
        until = undefined
      } else {
        body.push(row)
        if (isShell) {
          kept.push(row)
        }
      }
      continue
    }
    kept.push(row)
    const here = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(row)
    if (here !== null) {
      until = here[2]
      opener = row
      body = []
      isShell = /(?:^|[;&|]\s*|\bsudo\s+)(?:ba|z|da|k)?sh\b[^;&|]*<</.test(row)
    }
  }
  if (until !== undefined) {
    docs.push({ row: opener, body: body.join('\n') })
  }
  return { text: kept.join('\n'), docs }
}

export function withoutHeredocs(script: string): string {
  return readHeredocs(script).text
}

// Where the `(` at `from` closes; the end of the text when it never does.
function closing(text: string, from: number): number {
  let depth = 0
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!
    if (quote !== '') {
      if (ch === '\\' && quote === '"') {
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
    } else if (ch === '\\') {
      i += 1
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        return i
      }
    }
  }
  return text.length
}

const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'time', 'nohup', 'nice', 'env', 'xargs', 'timeout', 'gtimeout', 'caffeinate', 'then', 'do', 'else', 'if', 'while', '!'])
// The wrappers' own flags that take a value.
const VALUE_FLAGS: Readonly<Record<string, RegExp>> = {
  sudo: /^-[ugCDRTUph]$/,
  doas: /^-[uC]$/,
  nice: /^-n$/,
  env: /^-[uCS]$/,
  xargs: /^-[InPLdEs]$/,
  timeout: /^-[sk]$/,
  gtimeout: /^-[sk]$/,
}
const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
const baseOf = (word: string) => word.replace(/^\\/, '').split('/').pop() ?? ''

// A stage from its words: redirections, assignments and wrappers taken off.
function toStage(words: readonly string[]): Stage {
  const rest: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (/^(?:\d*|&)[<>]/.test(word)) {
      // `> file` names its target in the next word; `>file` and `2>&1` do not.
      if (/^(?:\d*|&)(?:>>?|>\||<<?<?-?)$/.test(word)) {
        i += 1
      }
      continue
    }
    rest.push(word)
  }
  for (;;) {
    while (rest[0] !== undefined && isAssignment(rest[0])) {
      rest.shift()
    }
    const head = baseOf(rest[0] ?? '')
    if (!WRAPPERS.has(head)) {
      break
    }
    rest.shift()
    while (rest[0]?.startsWith('-') === true) {
      const flag = rest.shift()!
      if (VALUE_FLAGS[head]?.test(flag) === true) {
        rest.shift()
      }
    }
    if (head === 'timeout' || head === 'gtimeout') {
      rest.shift()
    }
  }
  const [first = '', ...args] = rest
  return { name: baseOf(first), args, text: rest.join(' ') }
}

// A script as its pipelines, quotes respected; what `$(…)`, `<(…)` and
// backticks hold is set aside in `inner`, to be read as scripts of their own.
function parse(script: string): Script {
  const pipelines: Pipeline[] = []
  const inner: string[] = []
  let stages: Stage[] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote = ''
  const endWord = () => {
    if (hasWord) {
      words.push(word)
    }
    word = ''
    hasWord = false
  }
  const endStage = () => {
    endWord()
    if (words.length > 0) {
      stages.push(toStage(words))
    }
    words = []
  }
  const endPipeline = (then: Pipeline['then']) => {
    endStage()
    if (stages.length > 0) {
      pipelines.push({ stages, then })
    }
    stages = []
  }
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]!
    const after = script[i + 1]
    if (quote === "'") {
      if (ch === "'") {
        quote = ''
      } else {
        word += ch
      }
      continue
    }
    if (ch === '\\') {
      if (after === '\n') {
        i += 1
      } else if (after !== undefined) {
        word += after
        hasWord = true
        i += 1
      }
      continue
    }
    if ((ch === '$' && after === '(') || (quote === '' && (ch === '<' || ch === '>') && after === '(')) {
      const end = closing(script, i + 1)
      inner.push(script.slice(i + 2, end))
      word += '$(…)'
      hasWord = true
      i = end
      continue
    }
    if (ch === '`') {
      const end = script.indexOf('`', i + 1)
      const stop = end < 0 ? script.length : end
      inner.push(script.slice(i + 1, stop))
      word += '$(…)'
      hasWord = true
      i = stop
      continue
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = ''
      } else {
        word += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasWord = true
    } else if (ch === ' ' || ch === '\t') {
      endWord()
    } else if (ch === '\n' || ch === ';') {
      endPipeline(';')
    } else if (ch === '&' && after === '&') {
      endPipeline('&&')
      i += 1
    } else if (ch === '&' && (after === '>' || /[<>]$/.test(word))) {
      // `&>` and `2>&1` are redirections, not a job sent to the background.
      word += ch
      hasWord = true
    } else if (ch === '&') {
      endPipeline(';')
    } else if (ch === '|' && after === '|') {
      endPipeline('||')
      i += 1
    } else if (ch === '|') {
      endStage()
      if (after === '&') {
        i += 1
      }
    } else if (ch === '(' || ch === ')') {
      endPipeline(';')
    } else if ((ch === '{' || ch === '}') && word === '' && !hasWord && (after === undefined || /[\s;]/.test(after))) {
      // `{ a; b; }` groups commands; `{}` and `a{b,c}` are words.
      endPipeline(';')
    } else {
      word += ch
      hasWord = true
    }
  }
  endPipeline('')
  return { pipelines, inner }
}

// ── Commands that wait for the person ────────────────────────────────────

const TEMP = /^\/(?:private\/)?(?:tmp|var\/tmp|var\/folders)\/(?!\*$)./

// A target `rm -r` must not be pointed at without a second look.
function isBroad(target: string): boolean {
  const bare = target.replace(/\/+$/, '') || '/'
  if (target === '' || TEMP.test(bare)) {
    return false
  }
  // An unset variable in front of `/*` is the root directory's content.
  if (/^\$\{?\w+\}?\/\*$/.test(bare) && !/^\$\{?HOME\}?\//.test(bare)) {
    return true
  }
  const t = bare.replace(/^\$\{?HOME\}?(?=\/|$)/, '~').replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
  if (t === '.git' || t.endsWith('/.git')) {
    return true
  }
  const parts = t.split('/').filter(part => part !== '')
  if (t.startsWith('/')) {
    return parts.length <= 2
  }
  if (parts[0] === '~') {
    return parts.length <= 2 || (parts.length === 3 && parts[2] === '*')
  }
  // Relative: the directory itself, its parents, or everything in them.
  const below = parts.filter(part => part !== '.')
  return below.every(part => part === '..' || part === '*')
}

const hasShort = (args: readonly string[], letter: string) => args.some(arg => /^-[a-zA-Z]+$/.test(arg) && arg.includes(letter))
const targetsOf = (args: readonly string[]) => args.filter(arg => !arg.startsWith('-'))

function rmRisk(args: readonly string[]): Risk | undefined {
  const isRecursive = args.includes('--recursive') || hasShort(args, 'r') || hasShort(args, 'R')
  const broad = targetsOf(args).find(isBroad)
  return isRecursive && broad !== undefined ? { rule: 'rm-broad', zh: `递归删除 ${broad}` } : undefined
}

// `find <broad> -delete` with nothing to narrow it down by name, age or size.
function findRisk(args: readonly string[]): Risk | undefined {
  const firstTest = args.findIndex(arg => arg.startsWith('-') || arg === '(' || arg === '!')
  const roots = firstTest < 0 ? args : args.slice(0, firstTest)
  const deletes = args.includes('-delete') || args.some((arg, i) => /^-(?:exec|execdir|ok)$/.test(arg) && baseOf(args[i + 1] ?? '') === 'rm')
  const isNarrowed = args.some(arg => /^-(?:i?name|i?path|i?regex|newer|[mca]time|[mca]min|size|empty|user|group|perm)$/.test(arg))
  const broad = (roots.length === 0 ? ['.'] : roots).find(isBroad)
  return deletes && !isNarrowed && broad !== undefined ? { rule: 'find-delete', zh: `用 find 批量删除 ${broad} 下的文件` } : undefined
}

// `chmod -R` / `chown -R` on the system's or the home directory's top levels.
function modeRisk(name: string, args: readonly string[]): Risk | undefined {
  const isRecursive = args.includes('--recursive') || hasShort(args, 'R')
  const broad = targetsOf(args)
    .slice(1)
    .find(target => /^(?:\/|~|\$\{?HOME)/.test(target) && isBroad(target))
  return isRecursive && broad !== undefined ? { rule: 'chmod-broad', zh: `递归修改 ${broad} 的${name === 'chmod' ? '权限' : '属主'}` } : undefined
}

function gitRisk(args: readonly string[]): Risk | undefined {
  const rest = [...args]
  while (rest[0]?.startsWith('-') === true) {
    const flag = rest.shift()!
    if (flag === '-C' || flag === '-c' || flag === '--git-dir' || flag === '--work-tree') {
      rest.shift()
    }
  }
  const [sub, ...more] = rest
  const has = (...names: string[]) => more.some(arg => names.includes(arg))
  if (sub === 'push' && (has('--force') || hasShort(more, 'f') || more.some(arg => /^\+\S/.test(arg)))) {
    return { rule: 'git-force-push', zh: '强制推送，会覆盖远端的提交历史' }
  }
  if (sub === 'reset' && has('--hard')) {
    return { rule: 'git-reset-hard', zh: 'git reset --hard，会丢掉没提交的改动' }
  }
  if (sub === 'clean' && hasShort(more, 'f') && !hasShort(more, 'n') && !has('--dry-run')) {
    return { rule: 'git-clean', zh: 'git clean，会删掉没被跟踪的文件' }
  }
  if ((sub === 'checkout' || sub === 'restore') && has('.') && (!has('--staged', '-S') || has('--worktree', '-W'))) {
    return { rule: 'git-discard', zh: `git ${sub} .，会丢掉工作区里的全部改动` }
  }
  if ((sub === 'checkout' || sub === 'switch') && (has('--force', '--discard-changes') || hasShort(more, 'f'))) {
    return { rule: 'git-discard', zh: `git ${sub} --force，会丢掉工作区里的改动` }
  }
  if (sub === 'branch' && hasShort(more, 'D')) {
    return { rule: 'git-branch-delete', zh: '强制删除分支' }
  }
  return undefined
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])
const STDIN_RUNNERS = new Set(['python', 'python3', 'perl', 'ruby', 'node', 'bun', 'deno'])
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'clickhouse', 'clickhouse-client', 'duckdb', 'bq', 'snowsql', 'cockroach', 'mtdev', 'mongosh', 'mongo'])
const SQL_DROP = /\b(?:DROP\s+(?:DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b|\bDELETE\s+FROM\s+[\w.`"\[\]]+\s*(?:;|$)|\bdropDatabase\s*\(|\.drop\s*\(\s*\)/im
const SQL_RISK: Risk = { rule: 'sql-drop', zh: '删库删表（DROP / TRUNCATE / 不带 WHERE 的 DELETE）' }
const SSH_VALUE_FLAGS = /^-[bcDEeFIiJLlmOopQRSWw]$/
const DISK_VERBS = /^(?:eraseDisk|eraseVolume|partitionDisk|reformat|zeroDisk|randomDisk|secureErase)$/

// What one command would do, the script it hands to another shell included.
function stageRisk({ name, args, text }: Stage, depth: number): Risk | undefined {
  if (name === 'rm') {
    return rmRisk(args)
  }
  if (name === 'git') {
    return gitRisk(args)
  }
  if (name === 'find') {
    return findRisk(args)
  }
  if (name === 'chmod' || name === 'chown' || name === 'chgrp') {
    return modeRisk(name, args)
  }
  if (SHELLS.has(name)) {
    const at = args.findIndex(arg => /^-[a-zA-Z]*c$/.test(arg))
    return at < 0 ? undefined : riskIn(args[at + 1] ?? '', depth + 1)
  }
  if (name === 'eval') {
    return riskIn(args.join(' '), depth + 1)
  }
  if (name === 'ssh') {
    const rest = [...args]
    while (rest[0]?.startsWith('-') === true) {
      if (SSH_VALUE_FLAGS.test(rest.shift()!)) {
        rest.shift()
      }
    }
    return riskIn(rest.slice(1).join(' '), depth + 1)
  }
  if (name === 'dd') {
    return args.some(arg => /^of=\/dev\/(?!null$|zero$|stdout$|stderr$|fd\/)/.test(arg)) ? { rule: 'dd-device', zh: '用 dd 直接写磁盘设备' } : undefined
  }
  if (name.startsWith('mkfs') || (name === 'diskutil' && DISK_VERBS.test(args[0] ?? ''))) {
    return { rule: 'format-disk', zh: '格式化磁盘' }
  }
  if ((name === 'terraform' || name === 'tofu') && (args.includes('destroy') || (args.includes('apply') && args.includes('-destroy')))) {
    return { rule: 'terraform-destroy', zh: 'terraform destroy，会销毁云上资源' }
  }
  if (name === 'kubectl' && args.includes('delete') && args.some(arg => /^(?:ns|namespaces?|all|--all|--all-namespaces|-A)$/.test(arg))) {
    return { rule: 'kubectl-delete', zh: 'kubectl 批量删除资源' }
  }
  if ((name === 'docker' || name === 'podman') && args[0] === 'system' && args[1] === 'prune' && (args.includes('--all') || hasShort(args, 'a'))) {
    return { rule: 'docker-prune', zh: '清空 Docker 的全部镜像和容器' }
  }
  if (name === 'gh' && args[0] === 'repo' && args[1] === 'delete') {
    return { rule: 'gh-repo-delete', zh: '删除 GitHub 仓库' }
  }
  if (name === 'redis-cli') {
    const rest = [...args]
    while (rest[0]?.startsWith('-') === true) {
      if (/^(?:-[hpsaunri]|--user|--pass)$/.test(rest.shift()!)) {
        rest.shift()
      }
    }
    return /^flush(?:all|db)$/i.test(rest[0] ?? '') ? { rule: 'redis-flush', zh: '清空 Redis' } : undefined
  }
  if (SQL_CLIENTS.has(name) && SQL_DROP.test(text)) {
    return SQL_RISK
  }
  return undefined
}

function pipelineRisk({ stages }: Pipeline, depth: number): Risk | undefined {
  for (const [i, stage] of stages.entries()) {
    const risk = stageRisk(stage, depth)
    if (risk !== undefined) {
      return risk
    }
    const fed = stages.slice(0, i)
    // A download piped into something that runs it.
    const runsInput = (SHELLS.has(stage.name) && !stage.args.some(arg => /^-[a-zA-Z]*c$/.test(arg))) || (STDIN_RUNNERS.has(stage.name) && (stage.args.length === 0 || stage.args[0] === '-'))
    if (runsInput && fed.some(one => one.name === 'curl' || one.name === 'wget')) {
      return PIPE_TO_SHELL
    }
    if (SQL_CLIENTS.has(stage.name) && fed.some(one => SQL_DROP.test(one.text))) {
      return SQL_RISK
    }
  }
  return undefined
}

const PIPE_TO_SHELL: Risk = { rule: 'pipe-to-shell', zh: '把网上下载的脚本直接交给 shell 执行' }
// `bash <(curl …)` and `sh -c "$(curl …)"`: a download run without a pipe.
const SHELL_OF_DOWNLOAD = /(?:^|[\n;&|(]\s*)(?:sudo\s+)?(?:ba|z|da|k)?sh\s[^;&|\n]*(?:<\(|\$\()\s*(?:curl|wget)\b/
// Looked for outside quotes: what sits in quotes is somebody's words.
const BARE: readonly (readonly [RegExp, Risk])[] = [
  [/>\s*\/dev\/(?:sd|hd|disk|rdisk|nvme|mmcblk)\w*/, { rule: 'write-device', zh: '直接写磁盘设备' }],
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, { rule: 'fork-bomb', zh: 'fork 炸弹' }],
]

function riskIn(script: string, depth: number): Risk | undefined {
  if (depth > 3 || script.trim() === '') {
    return undefined
  }
  const { text, docs } = readHeredocs(script)
  if (SHELL_OF_DOWNLOAD.test(text)) {
    return PIPE_TO_SHELL
  }
  const bare = text.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\$`])*"/g, '""')
  for (const [pattern, risk] of BARE) {
    if (pattern.test(bare)) {
      return risk
    }
  }
  const { pipelines, inner } = parse(text)
  for (const pipeline of pipelines) {
    const risk = pipelineRisk(pipeline, depth)
    if (risk !== undefined) {
      return risk
    }
  }
  // SQL handed to a client in a heredoc.
  for (const doc of docs) {
    if (SQL_DROP.test(doc.body) && parse(doc.row).pipelines.some(pipeline => pipeline.stages.some(stage => SQL_CLIENTS.has(stage.name)))) {
      return SQL_RISK
    }
  }
  for (const one of inner) {
    const risk = riskIn(one, depth + 1)
    if (risk !== undefined) {
      return risk
    }
  }
  return undefined
}

// The first reason a shell command should wait for the person, if any.
export function riskOf(script: string): Risk | undefined {
  return riskIn(script, 0)
}

// ── git commit: what it is about to record ───────────────────────────────

// Where a script commits and what it stages on its way there. `adds` are the
// paths `git add` names (`.` for all of them); `withNew` when files not yet
// tracked go in too; `isAll` for `git commit -a`.
export type Commit = { dir?: string; isAll: boolean; adds: string[]; withNew: boolean }

export function commitOf(script: string): Commit | undefined {
  const { pipelines } = parse(readHeredocs(script).text)
  let dir: string | undefined
  let adds: string[] = []
  let withNew = false
  for (const { stages } of pipelines) {
    for (const { name, args } of stages) {
      if (name === 'cd' && args[0] !== undefined) {
        dir = dir === undefined || args[0].startsWith('/') ? args[0] : `${dir}/${args[0]}`
        continue
      }
      if (name !== 'git') {
        continue
      }
      const rest = [...args]
      while (rest[0]?.startsWith('-') === true) {
        const flag = rest.shift()!
        if (flag === '-C') {
          dir = rest.shift()
        } else if (flag === '-c' || flag === '--git-dir' || flag === '--work-tree') {
          rest.shift()
        }
      }
      const [sub, ...more] = rest
      if (sub === 'add') {
        const isEverything = more.some(arg => arg === '-A' || arg === '--all' || arg === '.')
        const isUpdate = more.some(arg => arg === '-u' || arg === '--update')
        const paths = targetsOf(more)
        adds = isEverything || (isUpdate && paths.length === 0) ? ['.'] : [...adds, ...paths]
        withNew ||= !isUpdate
      } else if (sub === 'commit') {
        // A path that cannot be followed (`~`, a variable) is left to git's
        // own working directory.
        const isPlain = dir !== undefined && !dir.startsWith('~') && !dir.includes('$')
        return { ...(isPlain ? { dir } : {}), isAll: more.includes('--all') || hasShort(more, 'a'), adds, withNew }
      }
    }
  }
  return undefined
}

// Whether a command needs the guard's closer look before it runs.
export function mayStop(script: string): boolean {
  return riskOf(script) !== undefined || commitOf(script) !== undefined
}

// ── Secrets ──────────────────────────────────────────────────────────────

export type Secret = { kind: string; sample: string }

const SECRETS: readonly (readonly [string, RegExp])[] = [
  ['私钥', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g],
  // Not the key the AWS documentation uses in its examples.
  ['AWS 访问密钥', /\bAKIA(?![0-9A-Z]{9}EXAMPLE\b)[0-9A-Z]{16}\b/g],
  ['GitHub 令牌', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['Anthropic API 密钥', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI 风格的 API 密钥', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['Slack 令牌', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Google API 密钥', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  // A credential is plain ASCII: a label in another script (`password: '请输入密码…'`) is not one.
  ['写死的密码或密钥', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['"](?=[\x21-\x7e]{12,}['"])[^'"\s$<{]{12,}['"]/gi],
]

export const mask = (text: string) => (text.length <= 8 ? `${text.slice(0, 2)}…` : `${text.slice(0, 6)}…${text.slice(-2)}`)

// Every secret-looking string in a text, its value masked.
export function secretsIn(text: string): Secret[] {
  const found: Secret[] = []
  for (const [kind, pattern] of SECRETS) {
    for (const match of text.matchAll(pattern)) {
      if (!found.some(one => one.sample === mask(match[0]))) {
        found.push({ kind, sample: mask(match[0]) })
      }
    }
  }
  return found
}

// A file whose very presence in a commit is worth a warning.
export function isSensitiveFile(path: string): boolean {
  const name = path.split('/').pop() ?? path
  if (/^\.env(\.|$)/.test(name)) {
    return !/\.(example|sample|template|dist)$/.test(name)
  }
  return /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|\.netrc|\.npmrc|credentials\.json)$/.test(name) || /\.(pem|p12|pfx|keystore|jks)$/.test(name)
}

export type Finding = { file: string; line: number; kind: string; sample: string }

// Secrets on the lines a unified diff adds, and sensitive files it adds.
export function scanDiff(diff: string): Finding[] {
  const findings: Finding[] = []
  let file = ''
  let line = 0
  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ ')) {
      file = row.slice(4).replace(/^b\//, '')
      if (file !== '/dev/null' && isSensitiveFile(file)) {
        findings.push({ file, line: 0, kind: '敏感文件', sample: file.split('/').pop() ?? file })
      }
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row)
    if (hunk !== null) {
      line = Number(hunk[1])
      continue
    }
    if (row.startsWith('+')) {
      for (const secret of secretsIn(row.slice(1))) {
        findings.push({ file, line, ...secret })
      }
      line += 1
    } else if (!row.startsWith('-') && !row.startsWith('\\')) {
      line += 1
    }
  }
  return findings
}

// A file not yet tracked, as the diff that would add it.
export function newFileDiff(file: string, text: string): string {
  const rows = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  return [`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${rows.length} @@`, ...rows.map(row => `+${row}`), ''].join('\n')
}

// Files a scan or a review does not read: not text, or not written by hand.
export const isOpaqueFile = (file: string) =>
  /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|bz2|xz|7z|rar|mp3|mp4|mov|wav|ogg|woff2?|ttf|otf|lockb?|bin|so|dylib|dll|exe|class|jar|pyc|wasm|sqlite|db)$/i.test(file)

// The text `/waifu scan` prints.
export function scanReport(name: string, findings: readonly Finding[], files: number): string {
  if (findings.length === 0) {
    return `🛡 ${name}的安全检查：看了 ${files} 个改动的文件，没发现密钥或敏感文件。`
  }
  return [
    `🛡 ${name}的安全检查：${files} 个改动的文件里有 ${findings.length} 处要看一下`,
    ...findings.slice(0, 12).map(one => `- ${one.file}${one.line > 0 ? `:${one.line}` : ''}  ${one.kind}  ${one.sample}`),
    ...(findings.length > 12 ? [`…还有 ${findings.length - 12} 处`] : []),
  ].join('\n')
}

// ── Commands whose outcome is worth saying out loud ──────────────────────

export type CommandKind = 'test' | 'build' | 'push'
// `isExact`: the script is that one command, so its exit status is the
// command's own; otherwise (a pipe into `tail`, a chain) only its output tells.
export type Watch = { kind: CommandKind; isExact: boolean }

const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const TEST_TOOLS = new Set(['pytest', 'jest', 'vitest', 'rspec', 'phpunit', 'mocha', 'ava', 'unittest', 'tox', 'ctest'])
const TEST_VERBS = new Set(['go', 'cargo', 'mvn', 'mvnw', 'gradle', 'gradlew', 'dotnet', 'swift', 'deno', 'zig', 'mix', 'flutter', 'dart', 'playwright'])
const BUILD_VERBS = new Set(['cargo', 'go', 'swift', 'zig', 'dotnet', 'gradle', 'gradlew', 'next', 'vite', 'astro', 'nuxt', 'bun'])

// The command a runner runs for someone else (`npx jest`, `python -m pytest`).
function unwrapped({ name, args }: Stage): { name: string; args: string[] } {
  const rest = [...args]
  if (name === 'npx' || name === 'bunx' || name === 'pnpx') {
    while (rest[0]?.startsWith('-') === true) {
      if (/^(?:-p|--package|-c|--call)$/.test(rest.shift()!)) {
        rest.shift()
      }
    }
    return { name: baseOf(rest.shift() ?? ''), args: rest }
  }
  if ((name === 'pnpm' || name === 'yarn') && (rest[0] === 'exec' || rest[0] === 'dlx')) {
    return { name: baseOf(rest[1] ?? ''), args: rest.slice(2) }
  }
  if (/^(?:uv|poetry|pipenv|pdm|hatch)$/.test(name) && rest[0] === 'run') {
    return unwrapped({ name: baseOf(rest[1] ?? ''), args: rest.slice(2), text: '' })
  }
  if (/^python[\d.]*$/.test(name) && rest[0] === '-m') {
    return { name: rest[1] ?? '', args: rest.slice(2) }
  }
  return { name, args: rest }
}

function kindOfStage(stage: Stage): CommandKind | undefined {
  const { name, args } = unwrapped(stage)
  const verb = args.find(arg => !arg.startsWith('-')) ?? ''
  if (name === 'git') {
    const rest = [...args]
    while (rest[0]?.startsWith('-') === true) {
      if (/^(?:-C|-c|--git-dir|--work-tree)$/.test(rest.shift()!)) {
        rest.shift()
      }
    }
    return rest[0] === 'push' && !rest.includes('--dry-run') && !hasShort(rest.slice(1), 'n') ? 'push' : undefined
  }
  if (PACKAGE_RUNNERS.has(name)) {
    const task = args[0] === 'run' ? (args[1] ?? '') : (args[0] ?? '')
    if (/^(?:test|t)$/.test(args[0] ?? '') || /^test(?::|$)/.test(task)) {
      return 'test'
    }
    if (/^build(?::|$)/.test(task) && (args[0] === 'run' || name !== 'npm')) {
      return 'build'
    }
    return undefined
  }
  if (TEST_TOOLS.has(name) || (TEST_VERBS.has(name) && verb === 'test') || (name === 'claude' && args[0] === 'plugin' && args[1] === 'test')) {
    return 'test'
  }
  if (name === 'make') {
    if (args.some(arg => /^(?:-n|--dry-run|--version|-v|--help)$/.test(arg))) {
      return undefined
    }
    return /^(?:test|tests|check)$/.test(verb) ? 'test' : 'build'
  }
  if (name === 'tsc' || name === 'webpack' || name === 'tsup') {
    return args.some(arg => /^(?:--version|-v|--help|-h)$/.test(arg)) ? undefined : 'build'
  }
  if ((BUILD_VERBS.has(name) && verb === 'build') || (name === 'cargo' && verb === 'check') || (name === 'cmake' && args.includes('--build'))) {
    return 'build'
  }
  if ((name === 'mvn' || name === 'mvnw') && /^(?:package|install|compile|verify)$/.test(verb)) {
    return 'build'
  }
  if ((name === 'gradle' || name === 'gradlew') && /^(?:build|assemble)$/.test(verb)) {
    return 'build'
  }
  return undefined
}

// The test runs, builds and pushes a script holds: tests first, pushes last.
export function watchesOf(script: string): Watch[] {
  const { pipelines } = parse(readHeredocs(script).text)
  const found: Watch[] = []
  // Steps that only set the scene (`cd dir &&`, `export X=1 &&`) aside, an
  // exact script is one pipeline of one command.
  const real = pipelines.filter(({ stages }) => !(stages.length === 1 && /^(?:cd|export|source|\.|)$/.test(stages[0]!.name)))
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      const kind = kindOfStage(stage)
      if (kind !== undefined && !found.some(one => one.kind === kind)) {
        const isAlone = real.length === 1 && real[0] === pipeline && pipeline.stages.length === 1
        const isChained = pipelines.every(one => one === pipeline || one.then === '&&')
        found.push({ kind, isExact: isAlone && isChained })
      }
    }
  }
  const order: readonly CommandKind[] = ['test', 'build', 'push']
  return found.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

const FAILED: Readonly<Record<CommandKind, readonly RegExp[]>> = {
  test: [
    /\b[1-9]\d*\s+(?:tests?\s+)?(?:fail(?:ed|ing|ures?)?|errors?|errored)\b/i,
    /\(fail\)|^\s*(?:FAIL(?:ED)?|✗|✘|×)\s/m,
    /\bAssertionError\b|--- FAIL:|\btest result: FAILED\b|\bFAILED \(|\bFAILURES!|^not ok\b/m,
  ],
  build: [/\berror TS\d+\b/, /\berror(?:\[E\d+\])?:/i, /\b(?:build|compilation) failed\b/i, /^make(?:\[\d+\])?: \*\*\*/m, /\bnpm ERR!/, /\bBUILD FAILURE\b/],
  push: [/\[(?:remote )?rejected\]|^\s*! /m, /\b(?:fatal|error):/],
}
const PASSED: Readonly<Record<CommandKind, readonly RegExp[]>> = {
  test: [/\b0\s+fail/i, /\b[1-9]\d*\s+(?:tests?\s+)?pass(?:ed|ing)?\b/i, /\ball tests passed\b/i, /^ok\s/m, /\btest result: ok\b/, /^\s*(?:PASS|✓|✔)\s/m, /\bOK \(\d+ tests?\b/, /^OK$/m],
  build: [],
  push: [/\S+\s+->\s+\S+/, /\bEverything up-to-date\b/],
}

// How a watched command came out, as far as can be told: undefined when its
// exit status is somebody else's and its output does not say.
export function outcomeOf(watch: Watch, hasFailed: boolean, output: string): 'pass' | 'fail' | undefined {
  if (watch.isExact) {
    return hasFailed ? 'fail' : 'pass'
  }
  if (FAILED[watch.kind].some(pattern => pattern.test(output))) {
    return 'fail'
  }
  return PASSED[watch.kind].some(pattern => pattern.test(output)) ? 'pass' : undefined
}
