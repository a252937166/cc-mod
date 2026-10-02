# cc-mod

Claude Code 的趣味 mod。第一个 mod 是 **anime-cheer（动漫应援团）**：像素风的动漫女孩在你的对话区里走来走去，Claude 干活时跳舞应援，干完活端茶捶背，用日语配音、带中文字幕，还会帮你播报 token 用量。

![干活时她们在对话区里跳舞、出招](docs/work.gif)

## 能做什么

- **在对话区里自由走动**：角色直接画在 Claude Code 的对话区上，只挡住身体所在的那一小块文字。每次随机出现一到两位，过几分钟换人。
- **跟着 Claude 的状态动起来**：
  - 跑任务时跳舞、四处走动、随口点评工具调用
  - 报错时出招（不知火舞会放火焰冲刺）
  - 思考完和完成后，有人端茶、有人捶背
- **日语配音，中文字幕**：台词和 AI 即兴聊天都是日语，气泡里显示中文。配音用 VOICEVOX 的动漫声线，也可以用 edge-tts。
- **token 播报**：上下文占用、5 小时和 7 天额度窗口、本次会话花费、每轮吃掉多少 token，到了关键档位会主动提醒。
- **小玩法**：`/waifu 日报` 看今天干了多少活，`/waifu 抽签` 抽今日编码运势，`/waifu <话>` 和她们聊天。

![干完活：端茶、捶背、谢幕](docs/tea.gif)

## 安装

### 需要准备

- **Claude Code 2.1.287 或更新版本**，并且你的账号能用 function-hook mod。这是 Claude Code 的早期功能，没开放的账号加载不了这个 mod。
- **全屏布局**：角色才能在对话区里走动；不是全屏时会自动改为显示在侧边面板里。
- **[bun](https://bun.sh)** 和 **ffmpeg**：导入角色素材时要用。
- **配音（可选，二选一）**：
  - 动漫声线：[VOICEVOX](https://voicevox.hiroshiba.jp/)，开着它的引擎即可
  - 普通日语女声：`pip install edge-tts`

### 第一步：下载角色素材

仓库里不带角色图片。这些是游戏公司的美术作品，不能在这里分发。请自己下载下面几张精灵图，放进同一个文件夹（默认是 `~/Downloads`），**文件名保持原样**：

| 角色 | 去哪下载 | 文件名 |
| --- | --- | --- |
| 不知火舞 | The Spriters Resource → Mobile → Metal Slug Defense → Units → Mai Shiranui | `Mobile - Metal Slug Defense - Units_ The King of Fighters - Mai Shiranui.png` |
| 小舞（Q 版） | The Spriters Resource → Mobile → Senran no Samurai Kingdom → Mai Shiranui | `Mobile - Senran no Samurai Kingdom (JPN) - Characters - The King of Fighters - Mai Shiranui.png` |
| 塞拉菲娜（兔女郎） | The Spriters Resource → Nintendo Switch → Disgaea 5 Complete → Seraphina (Bunny Girl) | `Nintendo Switch - Disgaea 5 Complete - Characters - Seraphina (Bunny Girl).png` |
| 卡蜜拉（吸血鬼伯爵夫人） | [CraftPix Free Vampire Pixel Art Sprite Sheets](https://free-game-assets.itch.io/free-vampire-pixel-art-sprite-sheets) | 解压后的 `Countess_Vampire/` 文件夹 |

缺哪张就少哪位，不影响其他角色。

### 第二步：导入角色、生成配音

```sh
git clone https://github.com/a252937166/cc-mod.git
cd cc-mod/anime-cheer

sh tools/import-packs.sh ~/Downloads   # 把精灵图切帧、缩放，生成 packs/<角色>/pack.json
bun tools/make-voices.ts               # 录好所有台词：开着 VOICEVOX 就用动漫声线，否则用 edge-tts
```

### 第三步：加载 mod

```sh
claude --plugin-dir /path/to/cc-mod/anime-cheer
```

想每次启动都自动加载，可以在 `~/.claude/settings.json` 的 `env` 里加上：

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/cc-mod/anime-cheer" } }
```

## 玩法

| 命令 | 作用 |
| --- | --- |
| `/waifu` | 显示或隐藏应援团 |
| `/waifu help` | 查看全部玩法 |
| `/waifu <话>` | 和随机一位聊天；`/waifu 舞 你好` 指定某人（AI 即兴回答，日语配音） |
| `/waifu token` | 播报上下文、额度和 token 消耗 |
| `/waifu 日报` | 今天聊了几轮、干了多久、吃了多少 token、最能吃的一轮 |
| `/waifu 抽签` | 抽今日编码运势（大吉到大凶） |
| `/waifu 名单` / `叫 <名字>` / `退下 <名字>` / `换人` | 管理台上的角色 |
| `/waifu 漫游` / `面板` | 在对话区里走动，或待在侧边面板 |
| `/waifu 静音` / `少说` / `声音` | 配音全关、只留关键时刻、全开 |
| `/waifu ai 关` / `ai 开` | 关掉或打开 AI 即兴聊天（关掉后只说预设台词，不花 token） |

![/waifu token：用量播报](docs/token.gif)

**自动提醒**

- 上下文用到 50%、80%、95% 时各提醒一次，80% 起会催你 `/compact`
- 5 小时和 7 天额度窗口用到 50%、80%、95% 时提醒，并告诉你多久后重置
- 本次会话花费累计到 $1、$5、$10、$20、$50、$100 时各喊一次
- 一轮吃掉超过 15 万 token 时会感叹一句
- 状态栏显示当前状态、上一轮的 token 和上下文占比

## 加你自己的角色

1. **导入素材**：用 `tools/import-pack.ts` 把精灵图切成帧。它支持三种素材排布：

   ```sh
   # 帧之间有透明空隙的普通精灵图
   bun tools/import-pack.ts <id> sheet.png --list
   # 每帧有底色框、框外是另一种底色（比如绿底粉框）
   bun tools/import-pack.ts <id> sheet.png --cells 00ff00 --key ff00ff --list
   # 每个动作一张横条图、帧大小固定（比如 128×128）
   bun tools/import-pack.ts <id> Idle.png Walk.png --grid 128x128 --list
   ```

   先加 `--list` 看帧编号，再用 `--anims` 指定每个动作用哪些帧，动作包括 `idle`、`walk`、`dance`、`cheer`、`attack`、`sleep`。常用参数：

   - `--scale`：缩放比例。像素画尽量用 1、0.5 这样的整数比，才不会糊
   - `--sample mode`：缩小时保留主色，边缘更锐利
   - `--wide`：配合舞台的四分格渲染，横向采样加倍，基本都要加
   - `--facing left`：原图朝左的素材要加

2. **写人设**：在 `hooks/troupe.ts` 里照现有角色加一项：名字、人设（AI 聊天用）、配音（VOICEVOX 的声线和风格），以及日语台词加中文字幕。
3. **重新录音**：运行 `bun tools/make-voices.ts`。

想让人物清楚，优先找游戏里的像素精灵图（有分格的动作表）。高清立绘和插画缩到终端尺寸只会糊成马赛克。

## 一些实现细节

- **画法**：终端里画图用的是 Claude Code mod 的 `Raster` 色块元素，每个字符格画 2×2 个像素（四分格字符）。所以每个角色大约 20 行高才看得清。
- **颜色配额**：Claude Code 给色块的颜色配额有限，每秒只能登记一百多种新的颜色组合，用超了就会出现白杠。所以每个角色导入时都压到 20 种颜色以内，并按行固定复用同一个元素，颜色只登记一次。
- **为什么不显示真图片**：真正的图片要终端支持 kitty 图片协议（kitty、Ghostty、WezTerm），Warp 等其他终端只能用色块画。

## 版权和致谢

- 本仓库的**代码**以 MIT 协议开源。
- **角色素材**归各自的版权方所有（SNK、日本一、CraftPix 等），不包含在仓库里。请从上面的地方自己下载，**只在本机使用，不要提交或分发**。
- 动漫配音由 [VOICEVOX](https://voicevox.hiroshiba.jp/) 生成，声线有四国めたん、春日部つむぎ、九州そら、波音リツ。公开发布生成的音频时，请按 VOICEVOX 和各角色的使用条款署名，例如“VOICEVOX:四国めたん”。
