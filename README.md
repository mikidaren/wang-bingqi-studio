# WANG BINGQI Studio

项目与工具入口，使用主站黑白灰视觉。Astro + Cloudflare Pages Functions，main 推送后自动部署。

- Studio：https://studio.miki2022.eu.org/
- 主站：https://miki2022.eu.org/

## 当前入口

| 入口 | 地址 | 内容 |
| --- | --- | --- |
| 云资源 | `/category/process/` | 已领取云资源、用量记录、刷新与控制台 |
| 哈尔滨冰雪大世界 | `/category/project/` | 规划、建筑、设计与施工三个模块 |

在 `src/data/studio-projects.ts` 添加项目及对应页面，首页、共享导航、描述和 404 入口会同步生成。原博客、Research、Grasshopper 和 CMS 公开入口已移除，旧链接回 Studio，历史源码可从 Git 恢复。

## 云资源

`src/data/cloud-resources.json` 为已审核的公开台账，导出维护见 [CLOUD_RESOURCES.md](docs/CLOUD_RESOURCES.md)。`src/data/resource-usage-snapshot.json` 保存定时公开读数；`/api/resource-usage` 合并快照及配置完成后的供应商 API 结果，页面每 60 秒检查并支持手动刷新。卡片直接显示已用进度或可用余额：耗尽为橙色满条，余额明确标明参考额度。所有者确认的 GitHub Actions 耗尽状态单独记录，不填写未获取的分钟数。没有数值的字段不生成格子。

凭据仅在 Pages Secret 中保存。接入与同步说明见 [RESOURCE_REFRESH.md](docs/RESOURCE_REFRESH.md)。

## 冰雪工作台

源仓库为 `mikidaren/https-github.com-mikidaren-Project-IceWorld-Disney-Platform3-Claude`，构建版本见 `public/category/project/build.json`。产品逻辑在源仓库修改后导出到此宿主。

`public/category/project/studio-theme.css` 只覆盖宿主外观。重新导出时保留四个 HTML 入口里的样式引用及 `studio-project-page` body class，图稿与原图保留原色。

生成接口仍为 `/category/project/design/compose`、`draw`、`access`；`CHUNXIAO_BASE_URL`、`CHUNXIAO_TEXT_KEY`、`CHUNXIAO_IMAGE_KEY` 与资源监控配置独立。

## 开发

```sh
npm ci
npm run build
node --test tests/resource-usage.test.mjs
npx wrangler pages dev dist --ip 127.0.0.1 --port 4217 --show-interactive-dev-session false
```

本地私有变量使用被忽略的 `.dev.vars`。Wrangler 将 Functions 编译到 `dist/_worker.js` 并生成 `dist/_routes.json`。不完整的本地检出不能覆盖远端完整树；发布基于最新 main 的 tree 追加变更，并用 expected SHA 防止覆盖其他会话的工作。
