# 栏目改版 · 旧链接迁移验证工作台

内容平台更换栏目结构后，技术负责人需要回答一个问题：**每一条旧链接最终会落到哪里、状态是否正确**。
本项目不是「把映射表填完」，而是用证据回答它：

- **Vue 3 工作台**：映射总览 / 归一化歧义 / 验证运行 / 迁移方案 / 发布闸门报告
- **Fastify 服务**：API、验证编排、发布闸门；并在**同一进程随项目启动**旧站（:18080）与新站（:18081）
- **PostgreSQL**：保存旧/新映射、爬取（验证）结果、归一化歧义、迁移方案
- **WHATWG URL** 规范化（Node/浏览器同一套 `URL`），不做 `decodeURIComponent` 式的自由解码
- **受控验证器**：只允许访问随项目启动的本地站点，手工逐跳跟随重定向，检环、限长、核实最终状态

## 端口（全部仅监听 127.0.0.1）

| 组件 | 地址 |
| --- | --- |
| Fastify API + 托管的前端 | http://127.0.0.1:18000 |
| 旧内容平台（随项目启动） | http://127.0.0.1:18080 |
| 新内容平台（随项目启动） | http://127.0.0.1:18081 |
| Vite 开发服务器（可选） | http://127.0.0.1:18099 |
| PostgreSQL | 127.0.0.1:55432（免 root，见下） |

验证器的允许名单写死为旧/新两个本地 origin（`server/index.js` 的 `ALLOWED_ORIGINS`）。
任何映射或重定向把请求引向其它 host/port/scheme，**在发起请求之前**就被拦截，记
`BLOCKED_ORIGIN`，链中该跳 `status=null, blocked=true`。

## 规范化规则（明确、可追溯，见 `server/lib/normalize.js`）

| 规则 | 处理 |
| --- | --- |
| R1 解析器 | 仅用 WHATWG URL；相对链接以登记的 base origin 解析；无法解析直接拒绝 |
| R2 origin | host 小写；默认端口（80/443）去除；非标准端口保留；点段 `.`/`..` 由解析期消除；仅允许 `http:` |
| R3 路径大小写 | **大小写敏感**，不做小写化；`/News` ≠ `/news`，差异登记 `CASE_VARIANT`（BLOCKER），人工裁决 |
| R4 百分号编码 | **不自由解码**。WHATWG 序列化为准，十六进制大写；`%2F` 不是分隔符，`%2D` 不等于 `-`；仅作保守字节级提示 `ENCODING_VARIANT`，**绝不静默合并** |
| R5 尾斜杠 | 是路径的一部分：`/a` ≠ `/a/`，登记 `TRAILING_SLASH` 提示 |
| R6 查询参数 | 参与资源身份，顺序/大小写保留；`utm_* / spm / gclid / fbclid …` 等追踪参数必须**端到端保留**，剥离即 `QUERY_LOST`；仅查询不同登记 `QUERY_VARIANT`，不折叠 |
| R7 fragment | 不属服务端资源身份，规范化时剥离 |

canonical_key = `origin + pathname + search`（无 hash）。

## 验证器对每条链接核实什么（`server/lib/verifier.js`）

- 手工跟随（`redirect:'manual'`），逐跳记录 `{hop,url,status,location}`
- **重定向环**：同一无 hash URL 再次出现 → `REDIRECT_LOOP`
- **过长链**：超过 5 跳仍为 3xx → `CHAIN_TOO_LONG`，并立即停止请求
- **越权**：每一跳目的 origin 先过允许名单，不在名单即拦截、不请求
- **最终页面状态**：链尾必须与裁决一致——`301` 裁决要求最终 `200` 且落点等于映射目标；
  `410` 裁决要求链尾即 `410` 且不得发生跳转
- **查询/追踪参数**：旧侧参数多重集合必须在链尾保留
- **归一化歧义**：未裁决的 BLOCKER（大小写形态、同键目标冲突）直接阻塞对应条目

## 数据库表（`sql/schema.sql`）

`url_mappings`（映射，含 raw 原样值/raw_variants/canonical_key/裁决/目标/栏目）、
`verification_runs`（每次运行留痕）、`crawl_results`（链、最终状态、问题码、参数保留、越权标记）、
`ambiguities`（五类歧义及裁决）、`migration_plan`（方案动作与 readiness：
PENDING/READY/BLOCKED/CONFIRMED_GONE，均由证据回填）。

## 快速开始

```bash
# 1) 依赖
npm install

# 2) 免 root 起 PostgreSQL 15（Debian deb 下载解压到 /tmp/pglocal，数据在 /tmp/pgdata）
bash scripts/dev-postgres.sh
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=migration PGPASSWORD= PGDATABASE=url_migration

# 3) 建表 + 演示数据（编码中文 / 追踪参数 / 已删栏目 / 环 / 长链 / 越权 / 各类歧义）
node scripts/init-db.js
node scripts/seed.js

# 4) 起服务（broken 模式：内置缺陷，等验证抓出）
node server/index.js
# 浏览器打开 http://127.0.0.1:18000

# 或一条命令：
bash scripts/dev.sh
```

前端开发模式（热更新）：`npm run dev:web`（Vite 代理 `/api` → :18000）。
生产构建：`npm run build`，构建产物由 Fastify 自动托管。

规则与验证器自检（mock fetch，无真实网络）：

```bash
node scripts/selftest.js
```

## 演示数据（16 条 → 评审后 14 条受影响链接）

| 场景 | 旧链接（要点） | broken 模式预期 |
| --- | --- | --- |
| 正常迁移 | `/News/Tech/123?id=8&utm_source=…&spm=…` | PASS，参数保留 |
| 追踪参数丢失 | `/News/Tech/456?gclid=…&page=2` | FAIL `QUERY_LOST`+`TARGET_MISMATCH` |
| 编码中文路径 | `/%E6%A0%8F%E7%9B%AE/weekly?utm_source=wechat` | PASS，字节保真 |
| 已删除栏目 | `/Dead/column/9` 与带查询入口 | PASS `410`（`CONFIRMED_GONE`） |
| 目标页未建 | `/News/Life/77?utm_source=oldportal` | FAIL 最终 404 |
| 重定向环 | `/loop/a → /loop/b → …` | FAIL `REDIRECT_LOOP` |
| 过长链 | `/chain/0 …`（6 跳 302） | FAIL `CHAIN_TOO_LONG` |
| 越权重定向 | `/promo/partner → http://example.com/…` | FAIL `BLOCKED_ORIGIN`（不请求） |
| 大小写形态 | `/News/Tech/123` vs `/news/tech/123` | BLOCKER `CASE_VARIANT`，小写 404 |
| 编码形态 | `/a%2Fb` vs `/a/b` | WARNING `ENCODING_VARIANT`，不合并 |
| 尾斜杠 | `/Sports/Basketball/` vs 无斜杠 | WARNING，无斜杠真实 404 |
| 同键冲突 | 同 canonicalKey（fragment 不同）却有 301 与 410 两份裁决 | BLOCKER `CONFLICT` |

## 发布闸门（`GET /api/report`，工作台「发布闸门报告」页）

`releasable` 必须全部满足：每条链接都有最新证据、最终页面状态核实通过、零 FAIL、
不存在把访问引向站外的旧链接、零未裁决 BLOCKER 歧义、方案条目全部 READY/CONFIRMED_GONE。

### 修复闭环（闸门从红到绿，证明「填表 ≠ 完成」）

```bash
# 数据层评审落库：删除矛盾 410、移出真实 404 的无斜杠条目、逐条裁决歧义、同步归档目标
node scripts/remediate.js

# 站点层修复：SITE_MODE=fixed（保留查询、拆环、单次 301、外跳落地迁回新站、小写兜底…）
SITE_MODE=fixed node server/index.js

# 在工作台再次「执行验证」（或 curl -XPOST :18000/api/verify）
# 结果：14/14 PASS，闸门 releasable=true
```

注意：只修站点不改映射表同样会被抓出——`/News/Life/77` 迁入 `/archive/life/77` 后若映射
目标未同步，复跑仍是 `TARGET_MISMATCH`（`remediate.js` 第 6 步处理）。

## 目录

```
server/            Fastify：index.js(API/编排/闸门) lib/(normalize, verifier, sites, db)
web/               Vue 3 + Vite 工作台（src/components/*View.vue）
sql/schema.sql     五张表
scripts/           init-db seed remediate selftest dev-postgres dev
```
