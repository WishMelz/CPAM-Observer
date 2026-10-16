# CPAM Observer

**CPA 只读观测台**，面向 CPA Manager Plus 的用量分析、请求监控与凭证查询。Observer 表明项目只负责观察和查询，不提供管理或修改操作。

仓库：[WishMelz/CPAM-Observer](https://github.com/WishMelz/CPAM-Observer)。

基于 [CPA Manager Plus](https://github.com/seakee/CPA-Manager-Plus) 源码迁移，保留上游 [MIT 许可证](LICENSE)，使用 Next.js，沿用原版页面组件、业务模型、样式、图标和翻译，仅提供三个入口：

| 页面 | 地址 | 查询内容 |
| --- | --- | --- |
| 用量分析 | `/usage-analytics` | 总览、趋势、模型、客户端 Key、凭证分析、热力图 |
| 请求监控 | `/monitoring` | 账号、API Key、请求记录、筛选、保存额度、脱敏导出 |
| 凭证查询 | `/accounts` | 列表、筛选、表格/卡片、五个详情页签、巡检历史、OAuth 配置查询 |

Next App Router 提供入口和服务端 API，原页面在客户端运行。不是静态导出项目，可运行 Node.js 服务，或通过 OpenNext 部署到 Cloudflare Workers。没有改动原项目或 `CPAM-Detail`。

项目包名为 `cpam-observer`。为兼容现有部署，目录和 Cloudflare Worker 标识仍保留 `cpam-next`，环境变量与会话配置不变。

## 配置

需要 Node.js 22+、npm，以及已经配置完成、从部署环境可访问的 CPA Manager Plus Manager Server。

按 [.env.example](.env.example) 在本项目根目录配置 `.env.local`，或在运行环境设置以下变量。实际配置文件已加入 Git 忽略规则。

| 变量 | 含义 |
| --- | --- |
| `CPA_MANAGER_URL` | **Manager Server** 基址，例如 `http://127.0.0.1:8021`；不是供应商 API、`/v1` 或 `/v0/management` 地址。支持部署路径前缀，不接受 URL 用户密码、查询参数和片段。 |
| `CPA_MANAGER_KEY` | Manager Server 管理密钥，仅供服务端请求上游。 |
| `CPAM_VIEWER_KEY` | 此查看器独立登录密钥，必须恰好为 6 个英文字母（A-Z、a-z），区分大小写，不接受数字、符号或空白，不能与管理密钥相同。 |
| `CPAM_COOKIE_SECURE` | 本地 HTTP 使用 `false`；HTTPS 部署设为 `true`。 |
| `CPAM_PUBLIC_ORIGIN` | HTTPS 反向代理时填写准确的对外来源，例如 `https://viewer.example.com`，不要包含路径、查询参数；本地直连可留空。 |

浏览器只输入 `CPAM_VIEWER_KEY`。不要把管理密钥放进浏览器，也不要使用 `NEXT_PUBLIC_` 前缀。配置修改后重启 Node 服务，或在 Cloudflare 控制台点击 Deploy。未配置时显示配置提示，不使用测试数据代替真实数据。

6 位字母密钥更容易被猜测，公网部署建议配合 Cloudflare Access 等访问限制，不应仅依赖短密钥和应用内限流。

Manager Server 必须已经连接 CPA 并启用所需的用量采集功能。此查看器不会帮上游初始化、修复数据库或启动采集器。

## 运行

在本项目目录执行：

```sh
npm install
npm run dev -- --hostname 127.0.0.1 --port 3100
```

访问 <http://127.0.0.1:3100>。生产运行：

```sh
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
```

对外访问建议由 HTTPS 反向代理转发至此端口，同时设置 `CPAM_PUBLIC_ORIGIN` 和 `CPAM_COOKIE_SECURE=true`。不要把开发服务器直接暴露到公网。多实例应使用相同配置和密钥；当前登录限流是单进程共享的 30 次/5 分钟，不是分布式或按 IP 限流，公网需另加边缘限流。

## 部署到 Cloudflare Workers

本项目使用 `@opennextjs/cloudflare` 部署到 **Cloudflare Workers**，不是 Cloudflare Pages 静态站点。不需要创建 R2、KV 或数据库。配置见 [wrangler.jsonc](wrangler.jsonc) 和 [open-next.config.ts](open-next.config.ts)。

### 使用 Cloudflare Workers Builds

在 Cloudflare 控制台创建 Worker 并连接包含本项目的 Git 仓库，配置：

| 设置 | 值 |
| --- | --- |
| Worker name | `cpam-next` |
| Root directory | 仓库包含本工作区各项目时填 `cpam-next`；仓库只有此项目内容时填 `/` |
| Build command | `npm run build:cf` |
| Deploy command | `npm run deploy:cf` |
| Node.js version | 22 或以上，可在构建环境设置 `NODE_VERSION=22` |

构建只需要安装依赖，不需要业务密钥。首次可以先部署，页面会显示未配置，然后再按下表设置运行时变量。不要把业务变量只填在 **Build variables and secrets**；那里不是 Worker 的运行时设置。

Worker 名称来自 [wrangler.jsonc](wrangler.jsonc) 的 `name`，当前为 `cpam-next`。改名时也要同步修改 `services` 中 `WORKER_SELF_REFERENCE` 的 `service`，并与控制台 Worker 名称一致。

### 控制台运行时变量

进入 **Workers & Pages → 对应 Worker → Settings → Variables and Secrets**，添加：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `CPA_MANAGER_URL` | Text | Manager Server 的公网 HTTPS 基址，不是供应商 API、`/v1` 或 `/v0/management`；不能使用你电脑的 `localhost` 地址 |
| `CPAM_COOKIE_SECURE` | Text | `true` |
| `CPAM_PUBLIC_ORIGIN` | Text | 查看器实际访问来源，例如 `https://viewer.example.com`；不是上游地址，不包含路径；使用 `workers.dev` 时填对应 HTTPS 来源 |
| `CPA_MANAGER_KEY` | Secret | Manager Server 管理密钥 |
| `CPAM_VIEWER_KEY` | Secret | 查看器登录密钥，恰好 6 个英文字母（A-Z、a-z），区分大小写，且不能与管理密钥相同 |

添加或修改后点击 **Deploy**。浏览器登录时只输入 `CPAM_VIEWER_KEY`。更换自定义域名后也要更新 `CPAM_PUBLIC_ORIGIN`。`keep_vars: true` 保留控制台已有普通变量；Secret 也不会被代码部署覆盖。本项目不在 Wrangler 配置中声明业务变量值。

### 本地命令部署

在本项目目录执行；Wrangler 登录在浏览器完成，无需把 CF Token 填进项目：

```sh
npm ci
npx wrangler login
npm run build:cf
npm run deploy:cf
```

每次修改代码后先重新 `build:cf`，再 `deploy:cf`，后者只部署已生成产物。[bin/build-cloudflare.mjs](bin/build-cloudflare.mjs) 在临时目录复制源码和依赖，排除本地环境文件，并检查产物的环境配置为空。不要绕过它直接执行 `opennextjs-cloudflare build`：适配器默认会把本地 `.env*` 编入服务端包。构建需要额外临时磁盘空间，结束后自动清理，不修改本地配置或正常开发构建。

不要上传 `.env*`、`.dev.vars*` 或写入真实密钥到仓库、Wrangler 配置及构建命令。Cloudflare 构建环境为 Linux；OpenNext 对 Windows 的支持有限，遇到平台问题优先使用 Workers Builds 或 WSL。

### 部署后检查

1. 打开 Worker 地址，确认出现独立登录页。
2. 使用 `CPAM_VIEWER_KEY` 登录。
3. 检查 `/usage-analytics`、`/monitoring` 和 `/accounts` 三个页面。
4. 如果页面提示未配置，检查变量是否设置在实际访问的 Worker 的 **Settings → Variables and Secrets** 中，再点击 **Deploy**。
5. 如果上游访问失败，检查 Worker 到 `CPA_MANAGER_URL` 的网络可达性、管理密钥和 Manager Server 的 HTTPS 证书。

本地先 `npm run build:cf`，再 `npm run preview:cf`。预览可读取本地 `.env` 或 `.dev.vars`，不会自动获取控制台 Secret；普通 `next dev` 仍使用本地 Next 环境变量。生产 Worker 只使用 CF 运行时配置。

登录限流在 Workers 中仅为单 isolate 内的限制，不是全局或按 IP 限流；公网访问建议配置 Cloudflare 边缘限流。Worker 压缩体积可通过 `npm run check:cf` 检查；构建通过不代表账户配额、真实上游可达性和线上域名已经验证。

## 只读边界

- 上游 URL 固定在服务端，浏览器不能指定任意代理目的地；不跟随上游重定向。
- 只放行明确列出的查询 GET，以及 analytics、account-history、account-window-usage、quota-snapshots/query 四类查询 POST。历史查询强制 `catch_up=false`。
- 上传、删除、编辑保存、启停凭证、优先级和备注调整、OAuth 修改、用量导入、主动供应商探测、重置额度、巡检运行和处置入口均从界面移除。配置以静态字段展示，映射图不支持编辑或连线；服务端仍拒绝写接口。
- 保留筛选、排序、分页、查询刷新、详情、历史、复制、脱敏下载及导出。主题、语言和展示布局只影响本地查看方式。
- 额度来自保存快照或已有请求响应头；手动刷新只重新读取，不调用供应商额度接口。未知额度不当作零，过期快照显示标识。没有保存数据时不能生成实时额度。
- 请求监控导出仅包含当前已加载和筛选的脱敏记录，不是上游全量备份。凭证下载也是脱敏 JSON，不能用于恢复原凭证。
- 访问令牌、管理密钥、请求头/原始内容等被移除或替换；客户端 Key、分析身份以哈希映射。账号邮箱、文件名及用量元数据仍会展示，访问密钥持有人应被视为可信的只读用户。
- 登录使用 8 小时的签名 HttpOnly、SameSite=Strict Cookie，访问密钥不写入 localStorage。退出清除当前浏览器 Cookie；轮换访问密钥并重启或发布新的 Worker 配置可使全部旧会话失效。若切换上游，建议同时轮换访问密钥并清除此站点的本地缓存，防止沿用旧 UI 状态。

只读限制和敏感字段脱敏是有意区别，不能与原版管理写操作完全一致。原 UI 的连接标识不等于上游健康证明，应以实际查询结果为准。

## 验证

```sh
npm test
npm run typecheck
npm run lint
npm run test:browser
npm run build:cf
npm run check:cf
npm run test:cf
```

- 单元测试覆盖独立密钥、会话签名/过期、查询白名单、响应脱敏、分析身份映射、请求大小和来源校验。
- `lint` 检查新增 Next 入口、服务端、部署配置及 CF 构建/测试脚本；迁移源码由 TypeScript、生产构建及浏览器回归验证，未进行全量 lint 重构。
- `test:cf` 使用本地 workerd 和现有假上游，验证同一包未配置/运行时配置两种状态、登录 Cookie、跨站拒绝、脱敏 GET/POST、写操作拒绝、三页与静态资源、退出。不使用 Cloudflare 账号，不访问真实上游。
- 浏览器回归需要本机 Microsoft Edge，使用独立随机回环端口和假上游，检查 1440/390/320px 三页、六个分析页签、五个凭证详情页签、监控额度/导出、修改入口不存在、OAuth 映射只读、Cookie 和退出。截图输出到 `test-results`，结束后停止测试服务。
- 测试上游只用于回归，普通 `dev`/`start` 不会加载它。测试通过不代表已连接真实上游，也不代表所有数据组合及逐像素视觉完全一致。

真实上游配置由使用者自行填写；上述自动化验证使用隔离测试数据，不读取真实密钥。上游版本差异、外部独立用量服务、特殊凭证元数据及巡检历史仍需在真实环境中核验。

## 目录

- `src/app`：Next 页面、独立登录和同源 API。
- `src/server/security.mjs`：查询白名单、会话、脱敏与身份映射。
- `src/original`：迁移的原版页面及局部只读适配。
- `tests`、`bin/test-browser.mjs`：独立测试数据和回归。
- `bin/migrate-original.mjs`、`bin/prune-demo.mjs`、`bin/adapt-sass.mjs`：一次性迁移工具；不要直接重跑，它们可能覆盖已经完成的手工适配。
