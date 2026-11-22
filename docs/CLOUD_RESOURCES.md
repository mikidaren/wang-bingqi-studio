# Studio 云资源页面

页面：<https://studio.miki2022.eu.org/category/process>

## 页面与数据

`src/pages/category/process.astro` 是固定的 Astro 路由。卡片与筛选来自 `src/components/CloudResourceDashboard.astro`；样式独立于其他页面。Process 文章继续显示在资源面板下方。

`src/data/cloud-resources.json` 是已领取及已注册资源的公开快照。卡片显示领取记录、已记录配置、核验说明与控制台入口。已注册显示为“待接入”，不计入已领取；历史领取、当前运行和实时余额分别处理。

## 从资源台账更新

私有的 Miki-BadBrowserUse 仓库仍保存完整台账、证据和用量。使用固定同一提交版本的输入，在此仓库执行：

```sh
python3 scripts/export-cloud-resources.py \
  --benefits /path/to/Miki-BadBrowserUse/dashboard/benefits.json \
  --catalog /path/to/Miki-BadBrowserUse/dashboard/resource-catalog.json \
  --usage /path/to/Miki-BadBrowserUse/dashboard/usage.json \
  --output src/data/cloud-resources.json
python3 -m unittest discover -s tests -p 'test_cloud_resource_export.py' -v
npm run build
```

导出器只允许经过编排的展示字段。新增提供商先补公开描述和类别映射；完整私有台账、账号、实例名、凭据、证据地址和自由文本备注均不发布。没有新的供应商读数时，不更改历史读数时间。

将更新后的数据和必要的展示映射通过 GitHub API 提交到此仓库 main，Cloudflare Pages 自动构建。修改后的 JSON 本身可以供审核；不要把 API token 放入网页、源文件或 URL。此页面不调用供应商控制接口，也不依赖 GitHub Hosted Actions。

## 验证与维护

- 默认仅显示已领取；可按类别、关键词、领取状态组合筛选。
- 未知参数显示原有未知说明，不推算资源使用百分比。
- 用量快照显示其原始观测时间。
- 360px 起采用单列卡片，宽屏采用多列，分类标签可横向浏览。
- 维护时保留固定路由，并在动态 `[category].astro` 中排除 `process`。

## 2026-11-23 验收记录

初次发布的数据固定来自资源台账提交 `f4dc378eaad9f4873a09d73691b447f878ef3810`，共 28 项（已领取 15，待接入 13）。8 项导出边界测试及 Astro / Wrangler 构建通过，独立代码审查未发现阻断问题。

Cloudflare 预览页已实测默认 15 项、切换全部 28 项、待接入 13 项、类别与关键词组合筛选、空态重置及 Escape 清除搜索。手机 360px / 390px 预览均无页面横向溢出。测试用布局页面只在预览分支中使用，不包含在正式发布目录。

