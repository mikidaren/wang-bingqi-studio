# Studio 云资源页面

页面：<https://studio.miki2022.eu.org/category/process>

## 页面与数据

`src/pages/category/process.astro` 是固定的 Astro 路由。卡片与筛选来自 `src/components/CloudResourceDashboard.astro`；样式独立于其他页面。Process 文章继续显示在资源面板下方。

`src/data/cloud-resources.json` 是已领取及已注册资源的公开快照。卡片显示领取记录、容量图示、用量快照、核验说明与控制台入口。已注册显示为“待接入”，不计入已领取；历史领取、当前运行和实时余额分别处理。

## 容量与用量图示

每张卡片包含经过白名单审校的 `metrics` 数组。`configuration` 继续保留方案和环境信息，供详情区使用。`usageStatus` 只描述观测是否有效，不代表实例在线。

| 字段 | 含义 |
| --- | --- |
| `kind` | CPU、内存、存储、GPU、额度、时长、网络、并发或请求 |
| `mode` | `capacity` 总配置或方案额度；`usage` 已用数值；`balance` 余额；`unknown` 未观测 |
| `basis` | `recorded-config` 历史配置；`plan-limit` 方案记录；`observed` 账户观测；`unknown` 未知 |
| `value` | 总配置或方案容量，不能当成已使用值 |
| `used` / `limit` / `remaining` | 同次供应商观测的原始数值；缺失值不补成零 |
| `percent` | 仅在单位一致、账期明确且读数可比时导出的已用百分比 |
| `checkedAt` | 用量观测原时间，独立于页面和台账更新时间 |
| `usageStatus` | `observed` 已有有效观测；`stale` 刷新失败并保留旧读数；`unknown` 无有效观测 |

CPU 核心块与 GPU 芯片代表记录中的硬件数量。内存与存储容量图示不计算占用率。当前没有实际 CPU 负载、内存已用、磁盘已用或 GPU 使用率；未观测项保持明确的未知状态。

用量环和进度条只读取已验证的 `percent`，不从公开套餐与不同时间的读数拼接计算。0% 是有效观测；超额读数保留真实百分比，绘图范围最多填满。余额高于账期额度或数值互相矛盾时，只显示绝对数值。

当前允许从规范化用量输入中读取 Firecrawl、Apify、Browserbase 与 Zenrows 的明确数值字段。接入规则不意味着这些账户已经有真实读数。Browserbase 只有绝对用量，不能拼入公开月配额；Apify 的账户消费上限不等于赠送余额；Zenrows 的单个 API Key 限额不等于完整套餐。

页面沿用 Astro 和静态数据导出。玻璃视觉基于 Taste 原版的边缘高光、内描边、低饱和配色及克制动效；导航和筛选控件使用玻璃层，内容卡片保持可读的磨砂底色。不加载供应商 SDK，也不把凭据送入浏览器。

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
- 360px 起采用单列卡片，宽屏采用两列，分类标签可横向浏览。
- 维护时保留固定路由，并在动态 `[category].astro` 中排除 `process`。

## 2026-11-23 验收记录

初次发布的数据固定来自资源台账提交 `f4dc378eaad9f4873a09d73691b447f878ef3810`，共 28 项（已领取 15，待接入 13）。8 项导出边界测试及 Astro / Wrangler 构建通过，独立代码审查未发现阻断问题。

Cloudflare 预览页已实测默认 15 项、切换全部 28 项、待接入 13 项、类别与关键词组合筛选、空态重置及 Escape 清除搜索。手机 360px / 390px 预览均无页面横向溢出。测试用布局页面只在预览分支中使用，不包含在正式发布目录。

液态玻璃与容量可视化升级的数据来自私有台账提交 `1671dc8e0ca9cbbf89f8e8a4f1ddd90715e562e5`。Firecrawl 在 `2026-11-22T21:53:21Z`（香港时间 2026-11-23 05:53）再次返回 1,025 credits 余额、1,000 credits 账期额度；历史用量没有返回周期记录，因此不推算已用数值。

