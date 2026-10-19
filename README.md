# 咕嘎管家

个人生活工作助理 PWA：时间管理、日程安排、健康生活、热点日报、AI 资讯，支持邮箱账号登录与跨设备云同步。

> 原为「纯前端 + WorkBuddy 托管云服务」，现已改造为**自建后端**（Node.js + Express + PostgreSQL），可部署到自己的服务器。

## 架构

```
浏览器（index.html 单文件 PWA）
        │  HTTP  /api/*
        ▼
    Nginx（静态托管 + /api 反向代理）
        │
        ▼
   Backend（Node.js + Express，端口 3000）
        │
        ├──► PostgreSQL（users / diaries / app_state）
        └──► 本地磁盘（日记图片 uploads/）
```

- **前端**：单文件 `index.html`（内联 CSS/JS）+ `sw.js` + `manifest.webmanifest` + `icons/`，无构建步骤。
- **后端**：`server/`，Express + pg，提供认证（JWT）、数据同步、图片上传。
- **部署**：Docker Compose 一键编排 postgres + backend + nginx，通过 GitHub Actions SSH 自动部署。

## 目录结构

```
咕嘎管家/
├── index.html              # 前端单文件应用
├── sw.js                   # Service Worker（PWA 离线）
├── manifest.webmanifest    # PWA 清单
├── icons/                  # 图标
├── server/                 # 后端
│   ├── src/index.js        # 入口
│   ├── src/auth.js         # 认证（注册/登录/验证码/重置密码）
│   ├── src/data.js         # 日记 + 应用状态 CRUD
│   ├── src/files.js        # 图片上传与访问
│   ├── src/db.js           # pg 连接池
│   ├── src/auth-middleware.js  # JWT 鉴权
│   ├── schema.sql          # 建表语句
│   └── Dockerfile
├── docker-compose.yml      # postgres + backend + nginx
├── nginx.conf              # 前端静态 + /api 反代
└── .github/workflows/deploy.yml  # CI/CD
```

## 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 邮箱密码注册 |
| POST | `/api/auth/login` | 邮箱密码登录 |
| POST | `/api/auth/otp/send` | 发送登录验证码 |
| POST | `/api/auth/otp/verify` | 验证码登录（自动注册） |
| POST | `/api/auth/reset-password` | 发送重置验证码 |
| POST | `/api/auth/reset-password/confirm` | 验证码 + 新密码重置 |
| GET | `/api/auth/me` | 当前用户 |
| GET | `/api/diaries` | 拉取日记 |
| PUT | `/api/diaries/:clientId` | 幂等 upsert 日记 |
| DELETE | `/api/diaries/:clientId` | 删除日记 |
| GET | `/api/state` | 拉取应用状态 |
| PUT | `/api/state` | 更新应用状态 |
| POST | `/api/upload` | 上传图片 |
| GET | `/api/files/...` | 访问图片 |
| GET | `/api/hot` | 热榜聚合（抖音 + 小红书，免登录）|
| GET | `/api/hot/douyin` | 抖音热榜 |
| GET | `/api/hot/xiaohongshu` | 小红书热门 |

所有 `/api/diaries`、`/api/state`、`/api/upload` 需要 `Authorization: Bearer <token>`。

### 热榜接口

`/api/hot*` 是**公开只读**接口（未登录也能看），服务端代理第三方聚合源并缓存 10 分钟：

- 上游全部失败时回吐上次成功缓存并置 `stale: true`，前端继续展示旧数据而不是空白
- 加 `?force=1` 强制刷新，同一平台 30 秒内最多触发一次
- 返回字段：`rank / title / hot / hotText / url / pic / label`，`url` 是抖音/小红书官方页链接，前端直接 `target="_blank"` 跳转
- 无需任何 API Key

对应的技能包：`~/.workbuddy/skills/douyin-hot/`（含 `scripts/fetch_douyin_hot.py` 命令行抓取）。

## 环境变量

见 `server/.env.example`。部署时通过 `.env` 文件或 GitHub Secrets 注入：

| 变量 | 必填 | 说明 |
|---|---|---|
| `PGPASSWORD` | 是 | PostgreSQL 密码 |
| `JWT_SECRET` | 是 | JWT 签名密钥（务必改成随机长串） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 否 | 邮箱验证码 SMTP；不配置则验证码登录/找回密码不可用（密码登录不受影响） |

## 部署（GitHub + CI/CD）

### 1. 推送到 GitHub

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin git@github.com:<你的用户名>/guga-housekeeper.git
git push -u origin main
```

### 2. 服务器首次准备（一次性）

只需装好 Docker（含 Compose 插件）和 rsync，**不需要 clone 仓库**——CI 会用 rsync 把代码直接推过去：

```bash
sudo apt update && sudo apt install -y git curl rsync
curl -fsSL https://get.docker.com | bash -s -- --mirror Aliyun
sudo systemctl enable --now docker
docker compose version
```

> 服务器无需访问 GitHub（避免国内网络导致的 TLS 中断），代码由 GitHub Actions 主动推送。

### 3. 配置 GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 值 |
|---|---|
| `SERVER_HOST` | `134.175.113.242` |
| `SERVER_USER` | 服务器登录用户（如 `root` 或 `ubuntu`） |
| `SERVER_SSH_KEY` | 能登录服务器的 SSH 私钥 |
| `SERVER_PORT` | SSH 端口（默认 22，可省略） |
| `PGPASSWORD` | 数据库密码（自定） |
| `JWT_SECRET` | 随机长字符串 |
| `SMTP_HOST` 等 | 可选，邮箱验证码用 |

### 4. 触发部署

推送代码到 `main` 分支即自动部署，或在 Actions 页面手动点 **Run workflow**。

部署采用**增量方式**，只处理改动过的部分：

1. **构建**（在 GitHub Actions 完成）：用 layer cache 构建后端镜像，只重建代码改动影响的层，推送到 GHCR（`ghcr.io/one-white-crow/personal_space-backend`）。
2. **部署**（CI 推送到服务器，服务器无需访问 GitHub）：
   - `rsync` 增量同步代码（只传变化的文件；`.env`、`uploads/` 等被排除保护）；
   - `docker compose pull backend` —— Docker 只下载镜像中变化的层，未变化的层复用本地缓存；
   - `docker compose up -d --no-build` —— 只重启有变化的服务，db / nginx 保持不变。

**各类改动的实际影响**：

| 改动内容 | 部署行为 |
|---|---|
| 前端（`index.html` / `sw.js` / 图标） | 只更新静态文件，nginx 直接读取，不重建镜像、不重启容器 |
| 后端代码（`server/src`） | 只重建镜像最后几层，pull 变化层并重启 backend |
| `server/package.json`（依赖） | 才重新执行 `npm install` |
| 数据库 / nginx 配置 | 数据卷持久化，容器保持不变 |

> 提示：GHCR 镜像默认继承仓库可见性。如果仓库是 Public，镜像通常也是 Public，服务器可直接 pull；若为 Private，workflow 已用 `GITHUB_TOKEN` 自动登录，无需额外配置。


### 5. 访问

- 前端：`http://134.175.113.242/`
- 健康检查：`http://134.175.113.242/api/health`

## HTTPS（可选但推荐）

PWA 的 Service Worker 仅在 HTTPS 下生效。裸 IP 无法申请 Let's Encrypt 免费证书，需先准备域名：

```bash
# 有域名后，用 certbot 申请证书并让 nginx 监听 443
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

然后参考 `nginx.conf` 增加 443 端口配置。

## 本地开发

```bash
# 1. 起数据库（或本地已装 PostgreSQL）
docker run -d --name guga-pg -e POSTGRES_DB=guga -e POSTGRES_USER=guga -e POSTGRES_PASSWORD=guga -p 5432:5432 postgres:16-alpine

# 2. 起后端
cd server
npm install
npm run init-db     # 初始化表结构
npm run dev         # 启动，默认 3000 端口

# 3. 前端：直接用浏览器打开 index.html 无法访问 /api（相对路径），
#    建议用简单静态服务器 + 反代，或直接 npx serve 后手动配置。
```

> 本地开发时前端 `API.base` 是 `/api`（相对路径），需要前端与后端同源。可临时用 nginx 或 vite dev server 代理，或直接 `docker compose up` 后访问 `http://localhost/`。

## 从 WorkBuddy 云服务迁移

原云服务数据（日记、目标、提醒）存在 WorkBuddy Cloud，本方案使用自建 PostgreSQL，**数据不自动迁移**。迁移方式：

- 未登录状态下，先在旧链接用「本机数据」；再登录新部署的账号，通过「本机数据上传到云端」把 localStorage 数据搬到新后端。
- 或直接重新开始使用。

## 备注

- 日记图片：登录后上传到服务器磁盘（`uploads/` 卷），正文只存 `data-cloud-path`；未登录则 base64 内嵌本机。
- AI 热点资讯：直连公开 API（aihot.virxact.com），不依赖后端。
- 热点日报：抖音/小红书数据需另配 API key（当前为示例占位）。
