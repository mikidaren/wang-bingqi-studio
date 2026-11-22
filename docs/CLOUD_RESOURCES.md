# Studio 云资源页面

页面：<https://studio.miki2022.eu.org/category/process>

## 页面与数据

`src/pages/category/process.astro` 是固定的 Astro 路由。卡片与筛选来自 `src/components/CloudResourceDashboard.astro`；样式独立于其他页面。页面仅展示云资源，原文章入口已移除。用量接口、刷新和公开快照维护见 [RESOURCE_REFRESH.md](RESOURCE_REFRESH.md)。

`src/data/cloud-resources.json` 保存经过白名单导出的资源快照。网页呈现有明确配置的已领取资源，以及已有实际用量或余额的已注册账户。受限的 GitHub Actions 在所有者确认额度耗尽后仍然显示，橙色满条直接表达状态；原始台账保留完整记录。

## 当前呈现规则

按用户提供的两张手机参考图，卡片采用图标与名称、紧凑参数格、日期与控制台入口的结构。页面使用主站 <https://miki2022.eu.org/> 的黑白灰配色、无衬线字体与细边框；品牌色只用于提供商图标和小标签。Taste 的通用配色和字体偏好服从用户明确指定的主站风格。

- 不渲染 `mode: unknown` 或 `basis: unknown`，没有数值或型号的指标不占位置，不凑四格。
- 删除“未观测”“待接入”占位、重复来源说明和空分类；搜索只索引实际展示的内容。
- 没有实际读数的未领取条目及已结束的临时环境不显示。已核实用量的账户和明确确认耗尽的资源可显示，分类与总数按实际展示项计算。
- 只保留真实配置、方案额度和账户读数。Kaggle 的每卡显存、Cloud Shell 的每周时长从已有审校配置中补入。
- CPU 分段与 GPU 标签按记录数量绘制；配置容量不画空白用量条。已用进度、可用余额与确认耗尽状态使用不同文字标识。
- 时间在卡片底部显示一次，分别标明账户更新、用户确认或配置记录时间。

本次修订恢复 GitHub Actions、Apify、HF ZeroGPU、Browserbase 四张有依据的卡片。用量与余额卡片优先排列；GitHub Actions 的耗尽状态置于最前。预览布局检查页不进入正式发布。

## 容量与用量图示

每张卡片包含经过白名单审校的 `metrics` 数组。`configuration` 保留方案与环境信息作为数据来源。`usageStatus` 只描述观测是否有效，不代表实例在线。

| 字段 | 含义 |
| --- | --- |
| `kind` | CPU、内存、存储、GPU、额度、时长、网络、并发或请求 |
| `mode` | `capacity` 总配置或方案额度；`usage` 已用数值；`balance` 余额；`unknown` 未观测 |
| `basis` | `recorded-config` 历史配置；`plan-limit` 方案记录；`observed` 账户观测；`user-confirmed` 所有者确认耗尽；`unknown` 未知 |
| `value` | 总配置或方案容量，不能当成已使用值 |
| `used` / `limit` / `remaining` | 同次供应商观测的原始数值；缺失值不补成零 |
| `percent` | 仅在单位一致、账期明确且读数可比时导出的已用百分比 |
| `quotaState` | `exhausted` 明确耗尽状态；允许在没有分钟数时表达已用完 |
| `referenceLabel` | 说明分母是消费上限、个人配额或账期额度 |
| `checkedAt` | 用量观测原时间，独立于页面和台账更新时间 |
| `usageStatus` | `observed` 已有有效观测；`stale` 刷新失败并保留旧读数；`unknown` 无有效观测 |

CPU 分段与 GPU 标签代表记录中的硬件数量。内存与存储总容量不计算占用率。缺少数据的指标完全不渲染。

用量条读取已验证的 `percent`，或同次同口径 `used / limit`；不从公开套餐与不同时间的读数拼接计算。0% 是有效观测，超额读数保留真实百分比，绘图范围最多填满。余额条使用 `remaining / limit` 并明确标出可用余额与参考额度；Firecrawl 余额高于账期额度时不反推消耗。GitHub 满条来自所有者确认，保持其确认时间。

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

- 显示满足当前呈现规则的资源；可按类别与关键词组合筛选。
- 缺少数据的指标不输出占位内容，不推算资源使用百分比。
- 用量快照显示其原始观测时间。
- 360px 起采用单列卡片，宽屏采用两列，分类标签可横向浏览。
- 维护时保留固定的 `/category/process/` 路由；原动态分类路由已移除。用量刷新按 [RESOURCE_REFRESH.md](RESOURCE_REFRESH.md) 维护。

## 2026-11-23 历史版本验收记录

初次发布的数据固定来自资源台账提交 `f4dc378eaad9f4873a09d73691b447f878ef3810`，共 28 项（已领取 15，待接入 13）。8 项导出边界测试及 Astro / Wrangler 构建通过，独立代码审查未发现阻断问题。

Cloudflare 预览页已实测默认 15 项、切换全部 28 项、待接入 13 项、类别与关键词组合筛选、空态重置及 Escape 清除搜索。手机 360px / 390px 预览均无页面横向溢出。测试用布局页面只在预览分支中使用，不包含在正式发布目录。

液态玻璃与容量可视化升级的数据来自私有台账提交 `1671dc8e0ca9cbbf89f8e8a4f1ddd90715e562e5`。Firecrawl 在 `2026-11-22T21:53:21Z`（香港时间 2026-11-23 05:53）再次返回 1,025 credits 余额、1,000 credits 账期额度；历史用量没有返回周期记录，因此不推算已用数值。

升级验证：23 项导出边界测试通过，独立审查无阻断问题，Astro 与 Wrangler 构建成功。Cloudflare 预览实测 360px / 390px 手机与 1280px 桌面均无页面横向溢出；手机首张卡片顶部为 456px，桌面双列。搜索 Kaggle 显示两块 T4 芯片，空态重置恢复 15 项，待接入为 13 项。隔离测试页验证 0%、125%、极小非零百分比、余额及旧快照的图形与可访问说明；正式数据仍为 79 个指标且无虚构百分比。所有预览测试页面已从正式构建中移除。

## 2026-11-23 账户验收快照同步

本次更新导出器中经过人工审核的摘要、配置、指标说明和固定状态标签，并使用最新用量重新导出；沿用现有公开数据结构。每条新增账户事实都在摘要中标明验收日期；`recordedAt` 取自台账条目的记录日期，可能随核验更新，不等于首次领取日期；`sourceCheckedAt` 代表读取台账的时间。两者均不替代供应商观测时间。静态的「本次验收」内容不能作为今后的实时状态。

| 资源 | 本次可公开的验收事实 | 仍未验收的范围 |
| --- | --- | --- |
| InstaBox | 官方 API 确认免费实例，4 vCPU、8192 MiB 内存、20 GiB 持久盘；状态为 suspended | 未启动实例，未采集 CPU 或内存使用量 |
| Upstash | 管理接口鉴权通过，数据库目录为 0 个 | 无实例读写验收 |
| Render | 唯一工作区的服务、Postgres、Key Value 目录均为 0 个 | 未创建或部署资源 |
| Hugging Face | 非 PRO，账户支付标志 canPay=false；个人配额基础与当前均为 300 秒，超额 0，重置时间未返回；Space 为 NO_APP_FILE，实际硬件未分配，申请 zero-a10g | 未验证 GPU 运行 |
| Groq | 鉴权与模型目录读取通过，返回 11 个模型 | 未执行推理，未取得账户可用额度 |
| Cloudflare D1 | 本次 D1 数据库目录请求返回 HTTP 401 | D1 数据库目录、SQL 与用量均未读取；不据此推断其他 API 的鉴权结果 |
| Apify | FREE 方案，月费 $0，月赠额 $5；月度消费快照 $0，账户消费上限 $5 | 未运行 Actor；不把上限减消费当作赠额余额 |
| Browserbase | 1 个项目；browserMinutes 为 0、proxyBytes 为 0，统计周期未返回 | 未创建会话；不推算剩余分钟 |
| Neon | Free 组织，1 个项目、1 个 idle 端点 | 未执行 SQL |
| Backblaze B2 | 账户鉴权通过 | 存储桶目录、上传下载与实际用量未验证 |
| Turso | 数据库接口仅接受关闭请求并返回成功 | 未执行 SQL 或读写测试 |
| Cloudflare Workers AI | 模型目录读取通过 | 未执行推理，未取得用量 |

鉴权成功或目录可读不会改变领取统计，也不会自动变成运行通过。公开卡片的领取状态与运行证据仍按台账枚举生成。私有台账的 `acceptanceAt`、`authAcceptance` 和原始响应不透传；相关账户结论先审核成固定公开文案。更新后的 usage 继续经过现有指标白名单导出，保留所有新设计的 `metrics` / `usageStatus` 字段与原始观测时间。Firecrawl 余额高于账期额度时不推算消耗比例；Apify 只按账户消费上限计量；Browserbase 在统计周期未知时只显示绝对用量。

本次同步最终合并到 Studio 提交 `f9db629a7a7a8d51f56148f24906318ba480d7f8` 的黑灰卡片布局，保留其筛选与呈现规则；导出器和测试以其未改变的 `27d6b5b9692fb35141a6af5866925782ab19d49f` 版本为基础。固定输入来自私有台账提交 `0d59cc7c45b9947b546ee4df5a189cf681fe5aa9`，benefits、catalog、usage 三份输入的 Git blob SHA 均与该提交一致。导出读取时间为 `2026-11-22T22:23:34Z`；数据仍为 28 项（已领取 15、待接入 13），共 79 个指标；它们与当前布局实际显示的 12 张卡片是两个统计范围，不能混用。完整 24 项公开导出与指标边界测试通过。

最新输入自动生成 3 家有效账户观测数据；当前布局隐藏未领取条目，因此 Apify 和 Browserbase 不在正式页面渲染。数据层结果为：Firecrawl 余额与账期额度分别显示；Apify 本期消费 $0、账户消费上限 $5，0% 为真实零消费读数；Browserbase 0 分钟与 0 bytes 仅显示绝对用量。InstaBox、Hugging Face、Render、Upstash 的固定指标说明补充了带日期的账户验收边界，不将历史配置、空目录或鉴权成功当作硬件占用监控。本次记录仅证明固定输入及离线测试结果；生产部署提交和线上展示另行核实。

InstaBox 的可用性枚举仍为 `unverified`，数据中的固定标签为「已挂起 · 运行待验收」。当前简洁布局不渲染该标签、账户摘要或未知指标，具体状态保留于数据、上表和完整验收记录。该说明仅从导出器的公开白名单读取，不接收私有台账的任意标签；新增测试覆盖这一边界。硬件配置说明保留本次 API 观测时刻（北京时间 2026-11-23 06:03），不表示当前持续在线或已取得占用监测。
