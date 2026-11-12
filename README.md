# dsh-weread-studio

DeepSeek Harness 的微信读书工作台插件：**左侧栏入口 + 中央面板**。同步微信读书书架与阅读进度、查看划线/想法/笔记统计、导入本地 EPUB/TXT，并在内置阅读器里调字号、行距、字体与背景。

## 入口与面板

左侧栏导航区新增一行「微信读书」（书本图标，`order: 6`），点击后中央面板切换到本插件注册的 `main` panel：

```
在读 | 书架 | 书城 | 笔记 | 设置
```

- **在读**：继续阅读卡（最近在读的书 + 进度 + 上次阅读时间），按钮「官方阅读器 / 书籍详情 / 看划线 / 刷新」。云端正文需要 Cookie，所以没有有效 Cookie 时「继续阅读」显示为提示而不是可点按钮。
- **书架**：微信读书书架（全部 / 在读 / 已读完 筛选，封面网格，点卡片看详情与目录），下方是**本地导入**区（`.epub` / `.txt`，多选，单文件上限 100MB）。
- **书城**：关键词搜索书城，结果卡片可看目录。
- **笔记**：按书聚合的笔记总览（划线 / 想法 / 书签条数与阅读进度），点进去看逐条划线原文。
- **设置**：连接状态、微信扫码登录、API Key、粘贴 Cookie、进度回写开关、外观设置。

右侧栏 tab 也保留（老入口仍然可用）。

## 两条凭据、各管一段

这是最容易踩坑的地方，两条凭据覆盖的范围**不重叠**：

| 能力 | 靠什么 | 说明 |
| --- | --- | --- |
| 书架、在读、进度、书城搜索 | Cookie **或** API Key | 两者任一可用即可；Cookie 过期且配了 Key 时自动回落到网关 |
| 云端章节正文、正文划线高亮 | **必须 Cookie** | 正文走 weread.qq.com 的私有签名协议，Key 解不开 |
| 新建 / 改色 / 删除划线 | **必须 Cookie** | `/web/book/addBookmark` 等私有接口，Key 只能读不能写 |
| 查词 | Cookie（微信读书词典） | 没有 Cookie 时自动降级到有道 / 汉典 / dictionaryapi |
| 划线、想法、笔记统计 | **必须 API Key** | 走 Agent Gateway（`/user/notebooks`、`/book/bookmarklist`、`/review/list/mine`） |
| 本地书（EPUB/TXT）阅读 | 都不需要 | 完全离线 |

- **Cookie**：从已登录的 `weread.qq.com` 复制完整 Cookie 头（须含 `wr_vid` 与 `wr_skey`），或在设置里扫码。
- **API Key**：`wrk-` 开头，到 <https://weread.qq.com/r/weread-skills> 领取。

凭据以 `0600` 权限存在 `~/.dsh/storages/weread/credentials.json`，只发给 `weread.qq.com`。

## 阅读器

- 翻页：`←` / `→` / 空格，或点击正文左右 28% 区域；章末有「下一章」。
- 外观：主题（跟随 DSH / 浅色 / 深色 / 羊皮纸）、字号 12–30、行距 紧/标准/松、字体 默认/宋体/黑体。
- 划线：云端书的划线按 `range` 与原文定位后以 `<mark>` 渲染，5 种颜色（黄/红/蓝/绿/紫），带想法的位置显示圆点，点开看内容；「划线」抽屉按章列出全部划线并可跳转。
- 进度：滚动位置本地记忆；开启「进度回写」后会把章节与阅读时长写回微信读书。本地书不回写。

### 选中文字之后

在正文里选一段文字（同一段落内），会浮出工具条：

| 操作 | 行为 |
| --- | --- |
| 5 个色块 | 直接按该颜色划线，写入云端并立刻重绘（跨段落的选择不可划线，按钮置灰） |
| 划线 | 用当前选中的颜色划一条线 |
| 查词 | 查选中的字/词（中文走微信读书词典 → 有道 → 汉典，英文走 dictionaryapi），浮层显示音标与义项 |
| AI 理解 | 把原文与出处拼成提示词，在**面板右侧**开一个 AI 对话并预填进输入框（不自动发送），正文同时留在左边 |
| 问 AI | 同上，但提示词是开放式讨论 |
| 复制 | 复制原文 |

工具条、划线气泡、查词浮层都贴着触发它的那段文字出现（上方或下方），不会甩到面板角落。

点已有的 `<mark>` 会弹出气泡：换颜色、删除（点一次就删，气泡本身就是确认）、以及跳到本书划线列表。

AI 对话在面板里与阅读器**并排**：右边是会话，左边是正文，可以一边看原文一边追问；点「← 回到阅读」收回侧栏，阅读进度不受影响。窄侧栏（插件不在中间面板时）没有两栏的空间，那里对话会临时盖住正文。

正文里**右键**同样的选区，会走宿主自己的右键菜单（`weread.selection` 目标，四个动作与工具条一致）。

划线写入走 `weread.qq.com` 的 `addBookmark` / `updateBookmark` / `removeBookmark`，需要有效 Cookie；写入成功后本地缓存立即失效，重进章节能读到刚划的线。

## 本地书库

导入的 EPUB/TXT 解析后存成 JSON（`~/.dsh/storages/weread/library/`），bookId 形如 `local-xxxxxxxxxxxx`。

- EPUB：自实现 ZIP 读取（stored + deflate），按 spine 顺序出章。不支持 DRM 加密书、ZIP64，不解析 `nav.xhtml` 多级目录。
- TXT：优先 UTF-8，失败退 gb18030；章节识别是启发式的（短标题行 + 序章/楔子/前言/后记/尾声/目录），识别不到就按 3000 字符切块。

体积上做过压测：88 本真实中文 EPUB 全部解析成功，最大 154MB（206MB base64）走一次 JSON POST 也能在 1 秒内导入；打开 160 章的大书到可读约 100ms，跳章同样是百毫秒级。上限设成 100MB 是浏览器端字符串的安全边界，不是解析器的瓶颈。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `weread_shelf` | 书架列表 |
| `weread_search` | 书城搜索 |
| `weread_book` | 书籍详情与目录 |
| `weread_chapter` | 章节正文 |

## 安装

```bash
dsh plugin --profile desktop add "file:/path/to/weread-studio"
```

装完需要整页刷新 GUI。注意：profile 里装的是**实体拷贝**而不是软链，所以改完源码要同步过去：

```bash
cp client.js ~/.dsh/profiles/desktop/node_modules/dsh-weread-studio/client.js
```

- 改 `client.js` → 拷贝 + 整页刷新即可生效。
- 改 `index.js` / `lib/*.js` → 属于 host 半，不用重启 app：往 profile 的 `cordis.patch.yml` **末尾追加一行注释**（`printf "\n# reload probe %s\n" "$(date +%s)" >> ~/.dsh/profiles/desktop/cordis.patch.yml`），约 6 秒后 patchReload 重新 mount 插件，新端点立即生效。注意单纯 `touch` 不会触发——文件内容必须变化。

## 测试

```bash
npm test     # node --test test/*.test.mjs
```

148 个用例（`test/` 下 8 个文件），覆盖 EPUB/TXT 解析、本地书库落盘与并发、划线定位算法、HTML 坐标索引、选区工具条的纯函数、字典解析与降级链、写入型接口的请求体形状，以及 service 层网关与本地书分支。

## 已知限制

- 没有有效 Cookie 时读不了云端正文（微信读书私有协议限制，非本插件可绕过）。
- 没有 API Key 时 `chapterMarks` 直接返回 `configured: false`，正文按纯文本渲染并提示。
- 划线的 `range` 是解码后 HTML 的字符偏移（标签也算），渲染时先按 HTML 索引换算成段内偏移；换算失败才回落到「段落以换行连接」的老坐标系。两套都对不上就进 unmatched 列表，绝不猜位置。
- 只能划线，**不能写想法/点评**：微信读书的想法走另一套接口，本插件未实现。
- 「AI 理解 / 问 AI」只把提示词预填进新会话的输入框，不代发；新会话归到当前工作区（脱离工作区的会话在宿主里输入框是禁用的），并直接开在面板右侧，不切换主视图。
- 仅 macOS 桌面端实测。

## 许可证

MIT。EPUB 解析、划线定位、阅读器 UI 为本项目实现；网关协议与正文解码参考了 MIT 许可的 [dsh-weread](https://github.com/wwjzzy/dsh-weread)。
