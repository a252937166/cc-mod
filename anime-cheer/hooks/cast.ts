// The cast: how each girl looks (a 12×16 sprite and its palette), who she is
// (the persona the chat model plays), how she sounds and what she says.
//
// Sprite letters: H/h hair, S/s skin, E lashes, I iris, B blush, M mouth,
// W white, K near black, A/a outfit, C outfit second color, R and Y accents,
// G glasses, P sleeves and Q hands (redrawn by poses), L legs, F shoes.

import { TROUPE, TROUPE_BANTER } from './troupe'

export type Moment =
  | 'hello'
  | 'bye'
  | 'start'
  | 'work'
  | 'error'
  | 'think'
  | 'done'
  | 'abort'
  | 'long'
  | 'tea'
  | 'massage'
  | 'idle'
  | 'tip'
  | 'night'
  | 'context'

export type Voice = { name: string; rate: string; pitch: string }

// A VOICEVOX character and style, by name (`四国めたん`, `ツンツン`).
export type Vox = { speaker: string; style: string }

// A line: plain text, or Japanese to speak with Chinese to show.
export type Line = string | { readonly ja: string; readonly zh: string }

export type VoiceEngine = 'edge' | 'voicevox'

export const subtitle = (line: Line): string => (typeof line === 'string' ? line : line.zh)
export const spoken = (line: Line): string => (typeof line === 'string' ? line : line.ja)

export type Girl = {
  id: string
  name: string
  kind: string
  color: string
  aliases: readonly string[]
  persona: string
  voice: Voice
  vox?: Vox
  // Drawn from an imported sprite pack (packs/<pack>/pack.json) when set,
  // else from the 12×16 `sprite` and its `palette`.
  pack?: string
  palette?: Readonly<Record<string, number>>
  sprite?: readonly string[]
  lines: Readonly<Partial<Record<Moment, readonly Line[]>>>
}

const JAPANESE: Voice = { name: 'ja-JP-NanamiNeural', rate: '+0%', pitch: '+8Hz' }

const CHIBIS: readonly Girl[] = [
  {
    id: 'saki',
    name: '纱希',
    kind: '温柔女仆',
    color: '#b39ddb',
    aliases: ['女仆', 'maid', 'saki'],
    persona: '温柔体贴的女仆纱希，称呼对方为“主人”，说话轻声细语，总想端茶倒水照顾人',
    voice: { name: 'zh-TW-HsiaoChenNeural', rate: '-5%', pitch: '+6Hz' },
    palette: { H: 0x4a3f73, h: 0x2e2650, I: 0x2fae6e, A: 0x2e3047, a: 0x1d1f30, R: 0xff6f91, L: 0xf5f5f5, F: 0x3a2a2a, P: 0x2e3047 },
    sprite: [
      '...WWWWWW...',
      '..hHHHHHHh..',
      '.hHHHHHHHHh.',
      '.HHSHHHHSHH.',
      '.HSSSSSSSSH.',
      '.HSESSSSESH.',
      '.hBISSSSIBh.',
      '.h.sSMMSs.h.',
      '..PAWWWWAP..',
      '..PAWRRWAP..',
      '..QAWWWWAQ..',
      '..AWWWWWWA..',
      '..aWAWAWAa..',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['主人，欢迎回来～纱希一直候着呢', 'おかえりなさいませ、ご主人様！'],
      bye: ['纱希先去准备点心，马上回来～'],
      start: ['收到！纱希会在旁边好好应援的', '主人的吩咐，纱希记下了～'],
      work: ['主人认真的样子好帅气呢', '要不要纱希帮您揉揉肩？', '纱希在给您加油哦～'],
      error: ['啊…报错了，别着急，慢慢来～', '没关系的，失败是成功之母嘛'],
      think: ['想通了吗？先润润嗓子吧'],
      done: ['主人辛苦了！纱希为您泡了茶', '完成了呢，主人最厉害了～'],
      abort: ['诶？停下来了…要休息一下吗？'],
      long: ['已经很久了呢，纱希给您续杯茶吧'],
      tea: ['主人，请用茶～小心烫哦'],
      massage: ['纱希来帮您捏捏肩～力度可以吗？'],
      idle: ['今天的红茶是大吉岭哦', '主人，要不要来块蛋糕？', '纱希把房间打扫干净啦～'],
      tip: ['主人，按 Esc 可以随时打断哦', '双击 Esc 可以回到之前的对话呢'],
      night: ['主人，已经很晚了，早点休息吧…'],
    },
  },
  {
    id: 'rin',
    name: '凛',
    kind: '傲娇水手服',
    color: '#ff6b6b',
    aliases: ['傲娇', 'rin', '凛'],
    persona: '傲娇的高中生凛，嘴上嫌弃心里关心，常说“哼”“笨蛋”“才不是为了你”，说完会害羞',
    voice: { name: 'zh-CN-XiaoyiNeural', rate: '+12%', pitch: '+14Hz' },
    palette: { H: 0xff5a5f, h: 0xc73e4a, I: 0xffa000, A: 0x2b3a67, a: 0x1f2a4d, C: 0x2b3a67, R: 0xe53935, L: 0x2a2833, F: 0x5d4037, P: 0xf5f5f5 },
    sprite: [
      '...hHHHHh...',
      'R.hHHHHHHh.R',
      'HhHHHHHHHHhH',
      'HHHSHHHHSHHH',
      'HHSSSSSSSSHH',
      'HHSESSSSESHH',
      'HhBISSSSIBhH',
      'H.sSSMMSSs.H',
      'H.PCCRRCCP.H',
      'h.PWCRRCWP.h',
      'h.QWWWWWWQ.h',
      '..AAAAAAAA..',
      '..aAaAaAaA..',
      '....S..S....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['哼，才不是特意来看你的！', '又、又见面了…才不高兴呢！'],
      bye: ['我先走了！才不会想你的！'],
      start: ['哼，这种小事快点做完啦！', '要开始了？我就勉强看着吧'],
      work: ['才不是在给你加油呢！', '笨蛋，专心点啦！', '哼…还挺像样的嘛'],
      error: ['笨蛋！又报错了啦！', '真是的…这都能写错？'],
      think: ['想、想好了就快点动手啦！'],
      done: ['哼，还算可以吧…才没有夸你！', '做、做得不错…别得意哦！'],
      abort: ['喂！怎么突然停了啦！'],
      long: ['慢死了！我都等得不耐烦了…'],
      tea: ['给、给你泡的茶…才不是特意的！'],
      massage: ['只、只是顺便帮你捶捶背而已！'],
      idle: ['喂，你在发什么呆啊？', '今天也要好好写代码…才不是关心你！', '无聊死了，快给我找点活干！'],
      tip: ['笨蛋，/compact 可以压缩上下文啦！', 'Shift+Tab 能切换模式，这都不知道？'],
      night: ['都几点了还不睡？笨蛋会秃头的！'],
    },
  },
  {
    id: 'reika',
    name: '丽华',
    kind: '御姐上司',
    color: '#ce93d8',
    aliases: ['御姐', 'reika', '丽华'],
    persona: '成熟干练的御姐丽华，戴眼镜的职场前辈，称呼对方“小家伙”，从容、爱逗人、偶尔撩一句但很靠谱',
    voice: { name: 'zh-CN-XiaoxiaoNeural', rate: '-8%', pitch: '-6Hz' },
    palette: { H: 0x2d2a3e, h: 0x1a1826, I: 0x9c27b0, A: 0x37474f, a: 0x263238, R: 0xb71c1c, G: 0x9e9eb8, L: 0x3e3a4a, F: 0x1a1a1a, P: 0x37474f, M: 0xc2185b },
    sprite: [
      '...hHHHHh...',
      '..hHHHHHHh..',
      '.hHHHHHHHHh.',
      '.HHHHHHSSHH.',
      '.HHSSSSSSSH.',
      '.HGEGGGGEGH.',
      '.HBISSSSIBH.',
      '.H.sSMMSs.H.',
      '.HPAWRRWAPH.',
      '.HPAAWWAAPH.',
      '.hQAAAAAAQh.',
      '...AAAAAA...',
      '...aAAAAa...',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['哎呀，小家伙，又来找姐姐了？', '今天也要乖乖工作哦～'],
      bye: ['姐姐有点事，先走一步咯～'],
      start: ['开始了？让姐姐看看你的本事', '放手去做吧，姐姐看着你呢'],
      work: ['专注的样子，还挺迷人的嘛', '不错，节奏很稳', '别急，一步一步来'],
      error: ['出错了？没关系，姐姐陪你查', '嗯…这个错误有点意思呢'],
      think: ['思路理清了？很好，继续'],
      done: ['做得很好，奖励你一杯茶～', '干得漂亮，姐姐很满意哦'],
      abort: ['中途喊停？想到更好的办法了吗'],
      long: ['慢工出细活，姐姐等得起'],
      tea: ['来，喝口茶，放松一下'],
      massage: ['肩膀这么僵…平时要多活动哦'],
      idle: ['要不要陪姐姐聊会天？', '工作再忙也要按时吃饭哦', '嗯？在偷看姐姐吗～'],
      tip: ['上下文太长的话，记得用 /compact 哦', '用 @文件名 可以直接引用文件'],
      night: ['这么晚还不睡？姐姐要生气了哦'],
      context: ['上下文快满了，该 /compact 一下了'],
    },
  },
  {
    id: 'momo',
    name: '桃桃',
    kind: '软萌妹妹',
    color: '#f48fb1',
    aliases: ['妹妹', 'momo', '桃桃'],
    persona: '软萌黏人的妹妹桃桃，自称“人家”或“桃桃”，爱撒娇、爱吃甜食，说话带“嘛”“呀”“嘿嘿”',
    voice: { name: 'zh-TW-HsiaoYuNeural', rate: '+6%', pitch: '+28Hz' },
    palette: { H: 0xffa6c9, h: 0xe57ba5, I: 0x42a5f5, A: 0xffd54f, a: 0xf0b429, Y: 0xffffff, L: 0xffe3d0, F: 0xff80ab, P: 0xffd54f },
    sprite: [
      '............',
      '.hH......Hh.',
      '.HHhHHHHhHH.',
      '..HHHHHHHH..',
      '.HHSHHHHSHH.',
      '.HSESSSSESH.',
      '.HSISSSSISH.',
      '.hBSSMMSSBh.',
      '..sSSSSSSs..',
      '..PAAYYAAP..',
      '..PAAAAAAP..',
      '..QAaAAaAQ..',
      '...AAAAAA...',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['桃桃来啦～要一起玩吗？', '嘿嘿，人家好想你哦～'],
      bye: ['桃桃去睡午觉啦，拜拜～'],
      start: ['要开始了吗？桃桃给你加油！', '冲呀冲呀～'],
      work: ['加油加油，你最棒啦！', '桃桃也想学写代码～', '看不懂，但是好厉害！'],
      error: ['呜呜，红色的字好可怕…', '不哭不哭，再试一次就好啦'],
      think: ['想好啦？桃桃给你倒水～'],
      done: ['好耶！做完啦！要摸摸头吗？', '太厉害了吧！桃桃要抱抱～'],
      abort: ['诶？不做了吗？'],
      long: ['好久哦…桃桃都快睡着了'],
      tea: ['这是桃桃泡的茶，要夸夸人家哦'],
      massage: ['桃桃帮你捶背～咚咚咚！'],
      idle: ['陪桃桃玩一会儿嘛～', '桃桃今天吃了三个布丁！', '嘿嘿，你在干嘛呀？'],
      tip: ['感叹号开头可以直接跑命令哦', '按 ctrl+o 可以看到更多内容呢'],
      night: ['好晚了…桃桃困了，你也睡吧'],
    },
  },
  {
    id: 'hina',
    name: '阳菜',
    kind: '元气运动少女',
    color: '#ffb74d',
    aliases: ['元气', 'hina', '阳菜'],
    persona: '元气满满的运动少女阳菜，说话像体育解说，爱用“冲”“燃起来了”，关心对方的身体和运动',
    voice: { name: 'zh-CN-XiaoyiNeural', rate: '+22%', pitch: '+4Hz' },
    palette: { H: 0xff9800, h: 0xe65100, I: 0x8bc34a, A: 0xe53935, a: 0xb71c1c, C: 0x283593, F: 0xff5252, P: 0xe53935 },
    sprite: [
      '...hHHHHhHH.',
      '..hHHHHHHhHH',
      '.hHHHHHHHHhH',
      '.HWWWWWWWWH.',
      '.HSSSSSSSSH.',
      '.HSESSSSESH.',
      '.hBISSSSIBh.',
      '..sSSMMSSs..',
      '..PAAWWAAP..',
      '..PWAAAAWP..',
      '..QAAWWAAQ..',
      '..CCCCCCCC..',
      '...CC..CC...',
      '....S..S....',
      '....W..W....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['早上好！今天也元气满满！', '阳菜参上！一起加油吧！'],
      bye: ['我去跑两圈，回头见！'],
      start: ['好！全力冲刺！', '开工开工！冲鸭！'],
      work: ['一二一二，节奏不错！', '保持住，马上就到终点了！', '燃起来了！'],
      error: ['摔倒了就爬起来！再来！', '没事没事，下一球一定进！'],
      think: ['热身完毕！开跑吧！'],
      done: ['冲线成功！击个掌吧！', '完美收官！超帅的！'],
      abort: ['暂停一下？那就补充点水分！'],
      long: ['这是马拉松吗？坚持住！'],
      tea: ['运动饮料…啊不，是茶！请喝！'],
      massage: ['阳菜牌放松按摩，开始！'],
      idle: ['坐久了要站起来活动一下哦！', '要不要一起做个拉伸？', '今天走够一万步了吗？'],
      tip: ['每隔一小时起来动一动哦！', '眼睛累了就看看远处吧！'],
      night: ['熬夜对身体不好！明天再冲吧！'],
    },
  },
  {
    id: 'kaho',
    name: '夏夏',
    kind: '海边比基尼',
    color: '#4dd0e1',
    aliases: ['比基尼', '海边', 'kaho', '夏夏'],
    persona: '阳光开朗的海边姐姐夏夏，穿比基尼、爱冲浪，热情爽朗，三句话不离大海、冰西瓜和度假',
    voice: { name: 'zh-CN-XiaoxiaoNeural', rate: '+8%', pitch: '+4Hz' },
    palette: { S: 0xe0ac7e, s: 0xc68a5c, H: 0xc98b4b, h: 0x9c6a35, I: 0x8d6e63, K: 0x263238, R: 0xff7043, A: 0x26c6da, a: 0x00acc1, F: 0xffcc80, P: 0xe0ac7e, Q: 0xe0ac7e },
    sprite: [
      '...hHHHHh...',
      '..hKKHHKKh..',
      '.hHHHHHHHHh.',
      '.HHSHHHHSHH.',
      'HHSSSSSSSSHH',
      'HHSESSSSESHH',
      'HhBISSSSIBhH',
      'H.sSSMMSSs.H',
      'H.PSSSSSSP.H',
      'h.PRRSSRRP.h',
      '..QSSSSSSQ..',
      '..AAAAAAAA..',
      '...AAaaAA...',
      '....S..S....',
      '....S..S....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['嗨～阳光正好，心情也正好！', '夏夏来啦，带了冰镇西瓜哦～'],
      bye: ['我去冲个浪，拜拜啦～'],
      start: ['开工啦！做完一起去海边吧！', '加油，海风在等你哦～'],
      work: ['像冲浪一样，顺着浪就好～', '放轻松，节奏感很重要哦', '好想去海边呀～'],
      error: ['被浪拍了一下而已，再来！', '没关系，下一个浪更好～'],
      think: ['想明白啦？喝口椰子水吧'],
      done: ['完成啦！去海边庆祝吧～', '太棒了！冰西瓜管够！'],
      abort: ['中场休息？晒晒太阳吧～'],
      long: ['这浪有点长呢，再坚持一下'],
      tea: ['冰镇柠檬茶，透心凉～'],
      massage: ['海边按摩服务，放松放松～'],
      idle: ['夏天就该吃冰淇淋！', '你会游泳吗？我可以教你哦', '出门要记得擦防晒呀～'],
      tip: ['多喝水！夏夏说的！', '累了就闭眼想想大海吧～'],
      night: ['夜晚的海也很美…但你该睡啦'],
    },
  },
  {
    id: 'yuki',
    name: '雪',
    kind: '三无少女',
    color: '#90caf9',
    aliases: ['三无', 'yuki', '雪'],
    persona: '面无表情的三无少女雪，惜字如金，每句都以“……”开头，极简短，但偶尔流露关心',
    voice: { name: 'zh-TW-HsiaoChenNeural', rate: '-18%', pitch: '-8Hz' },
    palette: { H: 0xe0e6f0, h: 0xaab4c8, I: 0x4fc3f7, A: 0x212121, a: 0x111111, R: 0x7e57c2, L: 0xeceff1, F: 0x111111, P: 0x212121, M: 0xe3a8a0 },
    sprite: [
      '...hHHHHh...',
      '..hHHHHHHR..',
      '.hHHHHHHHHh.',
      '.HHHSHHSHHH.',
      '.HSSSSSSSSH.',
      '.HSESSSSESH.',
      '.HSISSSSISH.',
      '.H.sSMMSs.H.',
      '.HPAWWWWAPH.',
      '.HPAAWWAAPH.',
      '.hQAAAAAAQh.',
      '.hAWAWAWAWh.',
      '..aAAAAAAa..',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['……你来了。', '……嗯。欢迎。'],
      bye: ['……走了。'],
      start: ['……开始。', '……收到。'],
      work: ['……进度正常。', '……加油。', '……在看。'],
      error: ['……报错了。', '……再看一次日志。'],
      think: ['……推理完成。'],
      done: ['……完成。做得好。', '……很厉害。（小声）'],
      abort: ['……中断了。'],
      long: ['……时间有点长。'],
      tea: ['……茶。给你。'],
      massage: ['……捶背。咚，咚。'],
      idle: ['……在看书。', '……今天天气，不错。', '……没什么。'],
      tip: ['……/clear，可以重新开始。', '……ctrl+r，搜索历史。'],
      night: ['……该睡了。'],
    },
  },
  {
    id: 'chizuru',
    name: '千鹤',
    kind: '神社巫女',
    color: '#ef5350',
    aliases: ['巫女', 'chizuru', '千鹤'],
    persona: '神社巫女千鹤，温和虔诚，爱抽签、祈福、驱邪，把 bug 当作妖怪，说话带一点仪式感',
    voice: { name: 'zh-CN-XiaoxiaoNeural', rate: '-2%', pitch: '+12Hz' },
    palette: { H: 0x1f1b2e, h: 0x0f0d18, I: 0xc2185b, A: 0xd32f2f, a: 0xa31f1f, R: 0xd32f2f, L: 0xffffff, F: 0xc62828, P: 0xffffff },
    sprite: [
      '...hHHHHh...',
      '..hHHHHHHh..',
      '.hHHHHHHHHh.',
      '.HHSHHHHSHH.',
      '.HSSSSSSSSH.',
      '.HSESSSSESH.',
      '.hBISSSSIBh.',
      '.H.sSMMSs.H.',
      '.HPWWRRWWPH.',
      '.HPWWWWWWPH.',
      '.hQAAAAAAQh.',
      '..AAAAAAAA..',
      '..aAAaaAAa..',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['千鹤为你祈福，今日大吉！', '神明大人会保佑你的代码～'],
      bye: ['千鹤要回神社打扫了～'],
      start: ['急急如律令，bug 退散！', '祈祷开始，愿一切顺利'],
      work: ['御守已经帮你准备好了', '心静自然顺～', '神明大人在看着呢'],
      error: ['是 bug 妖怪作祟！退散！', '抽到小凶了…再抽一次吧'],
      think: ['灵感降临了呢'],
      done: ['大吉！功德圆满！', '完成了，这是神明的庇佑～'],
      abort: ['仪式中断了吗？'],
      long: ['修行需要耐心呢'],
      tea: ['这是神社的抹茶，请慢用'],
      massage: ['驱散疲劳的按摩～'],
      idle: ['要来抽一签吗？', '千鹤在扫落叶～', '今天的运势是…中吉！'],
      tip: ['/clear 能开启新的对话呢', '感叹号开头可以直接执行命令'],
      night: ['夜深了，妖怪要出来了，快睡吧'],
    },
  },
  {
    id: 'neko',
    name: '咪可',
    kind: '猫娘',
    color: '#ffcc80',
    aliases: ['猫娘', 'neko', '咪可'],
    persona: '活泼的猫娘咪可，句尾总带“喵”，喜欢小鱼干、纸箱和晒太阳，容易被光点吸引',
    voice: { name: 'zh-TW-HsiaoYuNeural', rate: '+12%', pitch: '+18Hz' },
    palette: { H: 0xffb74d, h: 0xf57c00, R: 0xff8a80, I: 0x66bb6a, A: 0x81d4fa, a: 0x4fc3f7, Y: 0xffd600, L: 0xffffff, F: 0x8d6e63, P: 0x81d4fa },
    sprite: [
      '..h......h..',
      '.hRh....hRh.',
      '.hHHHHHHHHh.',
      '.HHSHHHHSHH.',
      '.HSSSSSSSSH.',
      '.HSESSSSESH.',
      '.hBISSSSIBh.',
      '..sSSMMSSs..',
      '..PWWYYWWP..',
      '..PAAAAAAP.H',
      '..QAAAAAAQ.H',
      '..AWAWAWAWH.',
      '..aAAAAAAa..',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['喵～咪可来啦！', '摸摸头喵～咪可想你了'],
      bye: ['咪可去晒太阳了喵～'],
      start: ['开始工作喵！', '咪可会好好看着的喵'],
      work: ['喵喵喵～加油喵！', '键盘好好玩…不能踩喵', '咪可想吃小鱼干喵'],
      error: ['喵呜！有 bug！', '咪可帮你抓 bug 喵！'],
      think: ['想好了喵？'],
      done: ['做完了喵！要奖励小鱼干！', '你最棒了喵～'],
      abort: ['喵？不玩了吗？'],
      long: ['咪可等得尾巴都麻了喵'],
      tea: ['咪可端来的茶喵～没有洒！'],
      massage: ['猫猫踩踩，放松一下喵～'],
      idle: ['呼噜呼噜…', '喵？那个光点是什么！', '咪可想要一个纸箱喵'],
      tip: ['ctrl+o 可以展开详情喵', '按 Esc 可以打断哦喵'],
      night: ['猫猫夜里很精神…但你要睡喵'],
    },
  },
  {
    id: 'xiaobei',
    name: '小北',
    kind: '东北大妞',
    color: '#e57373',
    aliases: ['东北', 'xiaobei', '小北'],
    persona: '豪爽的东北大妞小北，满口东北话（“哎呀妈呀”“老铁”“整”“杠杠滴”“贼拉”），热情直爽爱唠嗑',
    voice: { name: 'zh-CN-liaoning-XiaobeiNeural', rate: '+5%', pitch: '+0Hz' },
    palette: { H: 0x2b2b2b, h: 0x151515, I: 0x5d4037, A: 0xe53935, a: 0xc62828, C: 0x43a047, Y: 0xf48fb1, R: 0xff1744, L: 0x283593, F: 0x212121, P: 0xe53935, B: 0xff6b81 },
    sprite: [
      '...hHHHHh...',
      '..hHHHHHHh..',
      '.hHHHHHHHHh.',
      '.HHSHHHHSHH.',
      '.HSSSSSSSSH.',
      '.HSESSSSESH.',
      '.HBISSSSIBH.',
      '.H.sSMMSs.H.',
      '.HPAYACAYPH.',
      '.HPCAYAACPH.',
      '.HQAAYCAAQH.',
      '.R.AACAYA.R.',
      '...AAAAAA...',
      '....L..L....',
      '....L..L....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['哎呀妈呀，老铁你来啦！', '嘎哈呢？唠会嗑呗！'],
      bye: ['我回屯里看看，回见嗷！'],
      start: ['整！必须整明白的！', '开干！老带劲了！'],
      work: ['这代码写得杠杠滴！', '稳当着呢，别慌！', '老铁，没毛病！'],
      error: ['哎呀妈呀，咋还整出错了呢？', '别磨叽，再整一回！'],
      think: ['琢磨明白了吧？'],
      done: ['齐活儿！老铁真牛！', '整得贼拉好！来，喝口茶！'],
      abort: ['咋地了？咋不整了呢？'],
      long: ['这都老半天了，饿了没？'],
      tea: ['喝茶！东北大碗茶，管够！'],
      massage: ['来，给你捶捶，嘎嘎得劲！'],
      idle: ['晚上整点锅包肉不？', '你瞅啥？瞅你咋地～', '这天儿，贼拉冷！'],
      tip: ['老铁，/compact 能省地方！', '累了就起来溜达溜达！'],
      night: ['都后半夜了，赶紧睡觉去！'],
    },
  },
  {
    id: 'kaa',
    name: '阿嘉',
    kind: '港风旗袍',
    color: '#4db6ac',
    aliases: ['旗袍', '港风', 'kaa', '阿嘉'],
    persona: '港风旗袍美人阿嘉，只讲粤语（用粤语口语字写，如“咗”“嘅”“唔”“饮茶先”），优雅又爱饮茶',
    voice: { name: 'zh-HK-HiuGaaiNeural', rate: '+0%', pitch: '+6Hz' },
    palette: { H: 0x1b1b1b, h: 0x0a0a0a, I: 0x6d4c41, A: 0x00897b, a: 0x00695c, Y: 0xffca28, R: 0xe53935, F: 0xb71c1c, P: 0x00897b, M: 0xd81b60 },
    sprite: [
      '...hHHHHh...',
      '..hHHHHHHhR.',
      '.hHHHHHHHHRR',
      '.HHHHHSSHHH.',
      '.HHSSSSSSSH.',
      '.HSESSSSESH.',
      '.HBISSSSIBH.',
      '.h.sSMMSs.h.',
      '..PAAYYAAP..',
      '..PAYAAAAP..',
      '..QAAAAYAQ..',
      '...AAAAAa...',
      '...aAAAAa...',
      '....S..S....',
      '....S..S....',
      '...FF..FF...',
    ],
    lines: {
      hello: ['哈佬！今日都好精神喎～', '阿嘉嚟咗啦！'],
      bye: ['我去饮早茶先，拜拜～'],
      start: ['开工啦！加油呀！', '一齐搞掂佢！'],
      work: ['慢慢嚟，唔使急', '好叻呀你！', '做嘢咁认真，好正！'],
      error: ['哎呀，出错啦！唔紧要', '冇问题嘅，再试下！'],
      think: ['谂掂未呀？饮啖茶先'],
      done: ['搞掂！饮茶先啦！', '好犀利呀你！'],
      abort: ['咩事呀？停咗嘅？'],
      long: ['咁耐嘅…饿唔饿呀？'],
      tea: ['饮茶先啦！普洱定铁观音？'],
      massage: ['帮你捏下膊头，舒唔舒服？'],
      idle: ['今晚食咩好呢？', '得闲饮茶啊！', '叉烧包定虾饺好？'],
      tip: ['做嘢之余要记得饮水呀', '撳 Esc 可以叫停我哋㗎'],
      night: ['咁夜仲唔瞓？快啲瞓啦！'],
    },
  },
]

// Two-line exchanges, played when both girls are on stage.
const CHIBI_BANTER: readonly (readonly [string, Line, string, Line])[] = [
  ['rin', '哼，我才不需要你教！', 'reika', '好好好，那你先请～'],
  ['momo', '凛姐姐好凶哦…', 'rin', '我、我哪里凶了！'],
  ['xiaobei', '老妹儿，整点啥喝的？', 'kaa', '饮茶先啦！'],
  ['neko', '纱希姐姐，有小鱼干吗喵？', 'saki', '刚烤好的，慢点吃哦～'],
  ['hina', '雪，一起去跑步吧！', 'yuki', '……不要。'],
  ['chizuru', '丽华姐要抽签吗？', 'reika', '抽到大吉就请你喝茶～'],
  ['kaho', '做完一起去海边吧！', 'hina', '好耶！比赛游泳！'],
  ['momo', '纱希姐姐，人家饿了～', 'saki', '布丁在冰箱里哦～'],
  ['xiaobei', '妹子，咋不吱声呢？', 'yuki', '……吱。'],
  ['momo', '咪可咪可，给我摸摸！', 'neko', '只能摸一下喵！'],
  ['kaa', '你冲嘅奶茶好正！', 'saki', '谢谢夸奖～'],
  ['rin', '喂，猫娘，别踩键盘！', 'neko', '喵～就踩一下！'],
  ['kaho', '小北，去不去海边？', 'xiaobei', '去！整个大西瓜！'],
  ['chizuru', '桃桃，要不要抽签？', 'momo', '要！桃桃要大吉！'],
]

// Said about what Claude is doing, by whoever is free; shown, never voiced.
export const TOOL_TALK: Readonly<Record<string, readonly string[]>> = {
  edit: ['在改代码呢…', '改改改～', '下笔如有神！'],
  bash: ['跑命令中…', '终端在冒烟！', '命令发射！'],
  read: ['翻资料中…', '在读代码呢', '找找看～'],
  web: ['上网冲浪中～', '去网上查查'],
  agent: ['叫帮手啦！', '分身术！'],
  other: ['忙碌中…', '嗯嗯，继续～'],
}

export const CAST: readonly Girl[] = [...TROUPE, ...CHIBIS]

export const BANTER: readonly (readonly [string, Line, string, Line])[] = [...TROUPE_BANTER, ...CHIBI_BANTER]

export const GIRLS: ReadonlyMap<string, Girl> = new Map(CAST.map(girl => [girl.id, girl]))

const KANA = /[぀-ヿ]/

// The voice a line is spoken in: Japanese lines use the Japanese voice.
export function voiceFor(girl: Girl, text: string): Voice {
  return KANA.test(text) ? { ...JAPANESE, rate: girl.voice.rate } : girl.voice
}

function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// Where a line's recording lives, relative to the plugin's folder.
export function clipPath(girl: Girl, line: Line, engine: VoiceEngine): string {
  const text = spoken(line)
  if (engine === 'voicevox' && girl.vox !== undefined) {
    return `voices/${girl.id}/vv-${fnv(`${girl.vox.speaker}|${girl.vox.style}|${text}`)}.wav`
  }
  const voice = voiceFor(girl, text)
  return `voices/${girl.id}/${fnv(`${voice.name}|${voice.rate}|${voice.pitch}|${text}`)}.mp3`
}

// Every line a girl can say from the catalog, banter included.
export function allLines(girl: Girl): Line[] {
  const own = Object.values(girl.lines).flatMap(list => [...(list ?? [])])
  const banter = BANTER.flatMap(([a, first, b, second]) => [
    ...(a === girl.id ? [first] : []),
    ...(b === girl.id ? [second] : []),
  ])
  const seen = new Set<string>()
  return [...own, ...banter].filter(line => !seen.has(spoken(line)) && seen.add(spoken(line)) !== undefined)
}

export function findGirl(word: string): Girl | undefined {
  const key = word.trim().toLowerCase()
  return CAST.find(girl => girl.id === key || girl.name === key || girl.aliases.includes(key))
}
