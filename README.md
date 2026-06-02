# WANG Bingqi Studio

建筑作品与研究笔记站 — Astro + Decap CMS + Cloudflare Pages

## 🚀 一键部署指南

### 1. 创建 GitHub 仓库

1. 打开 https://github.com/new
2. 仓库名：`wang-bingqi-studio`
3. 设为 **Public**（Decap CMS 需要 public repo 才能免费工作）
4. **不要**勾选 "Add a README"（我们会推送已有项目）
5. 创建后复制仓库 URL

### 2. 推送项目到 GitHub

在本地项目目录运行：

```bash
cd E:\Code\项目1-作品集网站\..\wang-bingqi-studio
git init
git add .
git commit -m "🎉 init: Astro + Decap CMS studio site"
git remote add origin https://github.com/mikidaren/wang-bingqi-studio.git
git push -u origin main
```

### 3. 注册 GitHub OAuth App

1. 打开 https://github.com/settings/developers → **OAuth Apps** → **Register a new application**
2. 填写：
   - **Application name**: `Wang Bingqi Studio CMS`
   - **Homepage URL**: `https://studio.wangbingqi.eu.org`
   - **Authorization callback URL**: `https://studio.wangbingqi.eu.org/auth/callback`
3. 点击 **Register application**
4. 记下 **Client ID**（一串数字字母）
5. 点 **Generate a new client secret**，复制 secret 并保存好

### 4. 配置 Cloudflare Pages

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 授权并选择 `wang-bingqi-studio` 仓库
3. 构建配置：
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: （留空）
4. 点击 **Save and Deploy**
5. 部署完后，进入 Pages 项目 → **Settings** → **Environment Variables** → **Add variables**：

   | 变量名 | 值 |
   |---|---|
   | `GITHUB_CLIENT_ID` | 刚才记下的 Client ID |
   | `GITHUB_CLIENT_SECRET` | 刚才生成的 Client Secret |

   > ⚠️ `GITHUB_CLIENT_SECRET` 要勾选 **Encrypt**

6. 回到 Pages 项目 → **Settings** → **Functions** → 确保 **Functions** 已启用（默认开启）

### 5. 绑定自定义域名

1. 进入 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入 `studio.wangbingqi.eu.org`
3. Cloudflare 会自动添加 DNS 记录
4. 等待 HTTPS 证书签发（约 1-2 分钟）

### 6. 验证登录

1. 打开 `https://studio.wangbingqi.eu.org/admin/`
2. 点击 **Login with GitHub**
3. 授权后会自动跳回后台
4. 新建一篇文章试试，点击 **Publish**
5. 几秒后回到首页就能看到新文章

## 🧱 项目结构

```
wang-bingqi-studio/
├── src/
│   ├── content/
│   │   ├── config.ts        # 内容模型定义
│   │   └── posts/           # Markdown 文章（Decap CMS 写入这里）
│   ├── layouts/
│   │   └── Base.astro       # 全局布局
│   ├── pages/
│   │   ├── index.astro      # 首页（文章列表）
│   │   ├── 404.astro        # 404 页面
│   │   ├── posts/
│   │   │   └── [...slug].astro  # 文章详情页
│   │   └── category/
│   │       └── [category].astro  # 分类页
│   └── styles/
│       └── global.css       # 全局样式（暗黑粗野风）
├── public/
│   ├── admin/
│   │   ├── index.html       # Decap CMS 后台入口
│   │   └── config.yml       # CMS 配置（连哪个仓库、字段定义）
│   └── assets/
│       └── favicon.svg
├── functions/
│   ├── auth.js              # GitHub OAuth 入口
│   └── auth/
│       └── callback.js      # GitHub OAuth 回调处理
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

## 📝 日常使用

### 写文章

1. 打开 `https://studio.wangbingqi.eu.org/admin/`
2. 点击 **Login with GitHub**
3. 点击 **New Post** → 填写标题、正文、选分类
4. 拖拽上传封面图（自动存到 `public/assets/uploads/`）
5. 点击 **Publish** → 自动部署 → 几秒后上线

### 本地预览

```bash
npm install
npm run dev
# → http://localhost:4321
```

### 分类说明

| 分类 | 用途 |
|---|---|
| **Project** | 完整建筑项目展示（GBA 斜拉桥、海事博物馆等） |
| **Research** | 参数化结构 / 数字建造 / AI 辅助设计研究 |
| **Process** | 设计过程记录与方案迭代 |
| **Note** | 日常笔记、灵感、资源整理 |

## ⚙️ 国内可用说明

- **域名**：`studio.wangbingqi.eu.org` 绑 Cloudflare，国内可直连
- **CMS 脚本**：通过 jsDelivr CDN 加载（有国内节点）
- **图片**：上传后托管在 GitHub + Cloudflare Pages 缓存
- **如果后台加载慢**：下载 `decap-cms.js` 放到 `public/admin/` 并修改 `index.html` 指向本地文件
