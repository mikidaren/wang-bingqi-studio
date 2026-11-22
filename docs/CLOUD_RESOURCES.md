# Studio 云资源页面

页面：<https://studio.miki2022.eu.org/category/process>

## 页面与数据

`src/pages/category/process.astro` 是固定的 Astro 路由。卡片与筛选来自 `src/components/CloudResourceDashboard.astro`；样式独立于其他页面。Process 文章继续显示在资源面板下方。

`src/data/cloud-resources.json` 保存经过白名单导出的资源快照。网页只呈现已领取、未标记为已结束或受限、且至少有一项明确配置或额度的资源。已注册但未领取的资源不渲染；原始台账保留完整记录。

## 当前呈现规则

按用户提供的两张手机参考图，卡片采用图标与名称、紧凑参数格、日期与控制台入口的结构。页面使用主站 <https://miki2022.eu.org/> 的黑白灰配色、无衬线字体与细边框；品牌色只用于提供商图标和小标签。Taste 的通用配色和字体偏好服从用户明确指定的主站风格。

- 不渲染 `mode: unknown` 或 `basis: unknown`，没有数值或型号的指标不占位置，不凑四格。
- 删除“未观测”“待接入”占位、重复来源说明和空分类；搜索只索引实际展示的内容。
- 不展示已注册未领取的条目、已结束的临时环境和当前受限服务。分类与总数按实际展示项计算。
- 只保留真实配置、方案额度和账户读数。Kaggle 的每卡显存、Cloud Shell 的每周时长从已有审校配置中补入。
- CPU 分段与 GPU 标签按记录数量绘制，普通容量的细线仅是装饰，不编码使用比例。真实 `percent` 才绘制进度。
- 时间在卡片底部显示一次。Firecrawl 使用实际观测时间，其他卡片使用配置记录日期。

## 容量与用量图示

每张卡片包含经过白名单审校的 `metrics` 数组。`configuration` 保留方案与环境信息作为数据来源。`usageStatus` 只描述观测是否有效，不代表实例在线。

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

CPU 分段与 GPU 标签代表记录中的硬件数量。内存与存储总容量不计算占用率。缺少数据的指标完全不渲染。

进度条只读取已验证的 `percent`，不从公开套餐与不同时间的读数拼接计算。0% 是有效观测；超额读数保留真实百分比，绘图范围最多填满。余额高于账期额度或数值互相矛盾时，只显示绝对数值。

当前允许从规范化用量输入中读取 Firecrawl、Apify、Browserbase 与 Zenrows 的明确数值字段。接入规则不意味着这些账户已经有真实读数。Browserbase 只有绝对用量，不能拼入公开月配额；Apify 的账户消费上限不等于赠送余额；Zenrows 的单个 API Key 限额不等于完整套餐。

页面沿用 Astro 和静态数据导出。深灰玻璃材质通过细内边框、高光及轻微阴影表现；不加载供应商 SDK，也不把凭据送入浏览器。

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

- 仅显示满足当前呈现规则的已领取资源；可按类别与关键词组合筛选。
- 缺少数据的指标不输出占位内容，不推算资源使用百分比。
- 用量快照显示其原始观测时间。
- 360px 起采用单列卡片，宽屏采用两列，分类标签可横向浏览。
- 维护时保留固定路由，并在动态 `[category].astro` 中排除 `process`。

## 2026-11-23 历史版本验收记录

初次发布的数据固定来自资源台账提交 `f4dc378eaad9f4873a09d73691b447f878ef3810`，共 28 项（已领取 15，待接入 13）。8 项导出边界测试及 Astro / Wrangler 构建通过，独立代码审查未发现阻断问题。

Cloudflare 预览页已实测默认 15 项、切换全部 28 项、待接入 13 项、类别与关键词组合筛选、空态重置及 Escape 清除搜索。手机 360px / 390px 预览均无页面横向溢出。测试用布局页面只在预览分支中使用，不包含在正式发布目录。

液态玻璃与容量可视化升级的数据来自私有台账提交 `1671dc8e0ca9cbbf89f8e8a4f1ddd90715e562e5`。Firecrawl 在 `2026-11-22T21:53:21Z`（香港时间 2026-11-23 05:53）再次返回 1,025 credits 余额、1,000 credits 账期额度；历史用量没有返回周期记录，因此不推算已用数值。

升级验证：23 项导出边界测试通过，独立审查无阻断问题，Astro 与 Wrangler 构建成功。Cloudflare 预览实测 360px / 390px 手机与 1280px 桌面均无页面横向溢出；手机首张卡片顶部为 456px，桌面双列。搜索 Kaggle 显示两块 T4 芯片，空态重置恢复 15 项，待接入为 13 项。隔离测试页验证 0%、125%、极小非零百分比、余额及旧快照的图形与可访问说明；正式数据仍为 79 个指标且无虚构百分比。所有预览测试页面已从正式构建中移除。

