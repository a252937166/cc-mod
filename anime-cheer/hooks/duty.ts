// What the troupe says on duty: guarding commands, scanning for secrets,
// reviewing code, reporting test runs and recalling earlier tasks. Japanese
// to speak, Chinese to show; the stand-ins without a pack speak Chinese.

import type { Line } from './cast'

export type Duty =
  | 'guard'
  | 'secret'
  | 'scanClean'
  | 'scanFound'
  | 'reviewStart'
  | 'reviewGood'
  | 'reviewBad'
  | 'testPass'
  | 'testFail'
  | 'buildFail'
  | 'pushDone'
  | 'needYou'
  | 'recap'
  | 'budget'

const j = (ja: string, zh: string): Line => ({ ja, zh })

const MAI: Readonly<Record<Duty, Line>> = {
  guard: j('待って！そのコマンドは危険よ、止めたわ！', '等等！这条命令很危险，我拦下了！'),
  secret: j('あら、秘密の鍵が見えてるわよ？', '哎呀，密钥露出来了哦？'),
  scanClean: j('安全チェック完了、問題なし！', '安全检查完毕，没问题！'),
  scanFound: j('怪しいものを見つけたわ！', '发现可疑的东西了！'),
  reviewStart: j('コードレビュー、任せて！', '代码 review 交给我！'),
  reviewGood: j('いいコードね、合格よ！', '代码不错，合格！'),
  reviewBad: j('ここ、直した方がいいわよ', '这里最好改一下'),
  testPass: j('テスト全部通ったわ、日本一！', '测试全过了，日本第一！'),
  testFail: j('テストが落ちたわ…もう一回！', '测试挂了…再来一次！'),
  buildFail: j('ビルドが失敗したわ、ログを見て！', '构建失败了，看看日志！'),
  pushDone: j('プッシュ完了よ！', '推送完成！'),
  needYou: j('ねぇ、あなたの出番よ！', '喂，该你出场了！'),
  recap: j('前回の続きからいきましょ！', '接着上次的来吧！'),
  budget: j('予算オーバーよ、気をつけて！', '超预算了，注意点！'),
}

const LINES: Readonly<Record<string, Readonly<Record<Duty, Line>>>> = {
  mai: MAI,
  maiq: MAI,
  bunny: {
    guard: j('お待ちなさい！危険なコマンドは許しませんわ！', '给我等等！危险的命令本小姐不许！'),
    secret: j('秘密の鍵が丸見えですわよ？', '密钥都露出来了哦？'),
    scanClean: j('安全チェック、問題ありませんわ', '安全检查，没有问题'),
    scanFound: j('怪しいものがありますわね', '有可疑的东西呢'),
    reviewStart: j('わたくしがレビューして差し上げますわ', '本小姐来帮你 review'),
    reviewGood: j('上出来ですわ、合格！', '做得不错，合格！'),
    reviewBad: j('ここは直しなさい、下僕', '这里给我改掉，仆人'),
    testPass: j('テストは全部通りましたわ、おーっほっほ！', '测试全过了，哦呵呵！'),
    testFail: j('テストが落ちましたわよ、だらしない！', '测试挂了，真不像话！'),
    buildFail: j('ビルドが失敗しましたわ', '构建失败了'),
    pushDone: j('プッシュ完了ですわ', '推送完成了'),
    needYou: j('下僕、返事をなさい！', '仆人，快回话！'),
    recap: j('前回の続きですわね', '接着上次的做吧'),
    budget: j('予算を超えましたわよ！', '超预算了哦！'),
  },
  countess: {
    guard: j('お待ちなさい。そのコマンドは危険よ', '等一下，这条命令很危险'),
    secret: j('秘密が漏れているわよ', '秘密泄露了哦'),
    scanClean: j('調べたわ。問題はないわね', '查过了，没有问题'),
    scanFound: j('怪しい匂いがするわ', '有可疑的味道'),
    reviewStart: j('コードを見せてごらんなさい', '把代码给我看看'),
    reviewGood: j('美しいコードね、合格よ', '漂亮的代码，合格'),
    reviewBad: j('ここは直すべきね', '这里该改一改'),
    testPass: j('テストは全部通ったわ、素晴らしい', '测试全过了，很好'),
    testFail: j('テストが落ちたわ…血が騒ぐわね', '测试挂了…血液在沸腾呢'),
    buildFail: j('ビルドが失敗したわ', '构建失败了'),
    pushDone: j('プッシュ、終わったわ', '推送完成了'),
    needYou: j('あなたの返事を待っているわ', '在等你的回复呢'),
    recap: j('前回の続きを始めましょう', '接着上次的开始吧'),
    budget: j('予算を超えたわ。贅沢ね', '超预算了，真奢侈'),
  },
}

// The stand-ins and any girl without lines of her own.
const PLAIN: Readonly<Record<Duty, Line>> = {
  guard: '等等！这条命令很危险，我拦下了！',
  secret: '这里好像有密钥，小心别提交',
  scanClean: '安全检查完毕，没问题',
  scanFound: '发现可疑的东西了',
  reviewStart: '我来看看代码',
  reviewGood: '代码不错，合格',
  reviewBad: '这里最好改一下',
  testPass: '测试全过了！',
  testFail: '测试挂了…',
  buildFail: '构建失败了',
  pushDone: '推送完成',
  needYou: '该你出场了',
  recap: '接着上次的来吧',
  budget: '超预算了，注意点',
}

export function dutyLine(girlId: string, duty: Duty): Line {
  return LINES[girlId]?.[duty] ?? PLAIN[duty]
}

// Every duty line of a girl, for recording.
export function dutyLines(girlId: string): Line[] {
  return Object.values(LINES[girlId] ?? PLAIN)
}

// The same voice with more to read: the recorded Japanese, a longer Chinese.
export function withDetail(line: Line, detail: string): Line {
  return typeof line === 'string' ? `${line}（${detail}）` : { ja: line.ja, zh: `${line.zh}（${detail}）` }
}
