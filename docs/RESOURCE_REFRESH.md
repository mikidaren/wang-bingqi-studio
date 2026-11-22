# 云资源用量刷新

## 页面

页面每 60 秒请求 `/api/resource-usage`，隐藏时暂停，返回后重新检查；按钮可手动刷新。后端缓存 60 秒，避免每个访客重复调用供应商。

真实已用量与同口径总量显示进度条；只有绝对数时显示绝对数；只有配置时保留配置。没有数据的字段不出现。失败时保留原读数和采集时间，不改成零。

用量卡片优先显示。GitHub Actions 按所有者在 2026-11-23 的明确确认记录 `basis: user-confirmed`、`quotaState: exhausted`，展示橙色满条，不填写未取得的分钟数。该确认保存在独立快照中，普通接口刷新不会清除，也不会伪装成实时账单读数。

已注册且具有真实用量/余额读数的账户同样显示。Apify 的比例分母为账户消费上限；HF ZeroGPU 显示个人剩余 GPU 时长与个人配额；Firecrawl 显示可用余额相对账期额度，余额超过账期额度时只限制条形宽度，保留完整数字。配置容量不会画成空白用量条。

InstaBox CPU/内存最多保留 120 秒，磁盘最多 10 分钟。暂停时不把历史 CPU 当作当前占用，也不推成 0%。查询监控不启动或恢复实例。

## 后端配置

`server/resources/usage.mjs` 负责固定官方接口的只读采集、单位转换和筛选。`functions/api/resource-usage.js` 只输出资源 ID、状态及指标白名单，不返回账户/实例 ID、凭据或原始响应。

| Pages 配置名 | 用途 |
| --- | --- |
| RESOURCE_INSTABOX_API_KEY | machines:read，读取配置、状态、metrics |
| RESOURCE_INSTABOX_MACHINE_ID | 多台机器时明确选择，只有一台可省略 |
| RESOURCE_FIRECRAWL_API_KEY | credit-usage 及有效历史用量 |
| RESOURCE_CLOUDFLARE_API_TOKEN | Account Analytics Read |
| RESOURCE_CLOUDFLARE_ACCOUNT_ID | 明确查询的 Cloudflare 账户 |

独立前缀不会自动使用其他应用的 Secret。部署代码不代表供应商已经接通；配置后须实际验证响应。

本轮私有凭据出站请求遭到自动审批拒绝，上述监控 Secret 尚未配置，实际供应商请求未验收。需要所有者明确确认：允许使用现有 InstaBox、Cloudflare、Firecrawl 凭据，只向各自官方 API 读取用量，并将监控凭据以 Secret 保存在现有 Cloudflare Pages 项目。确认后继续此步骤，不重做页面。

## 每小时快照任务

已创建并启用「同步 Studio 云资源用量」，按 Asia/Shanghai 时区每小时执行。当前使用已连接的 Firecrawl 服务。

`src/data/resource-usage-snapshot.json` 当前保存通过既有 Firecrawl 连接器取得的余额与账期额度，观测时间逐项保存。

任务每轮读取本文和当前 main，然后通过已连接 Firecrawl 工具读取 current。若 historical 有明确期间用量可记录；空数组不能当作零。只更新公开白名单数值与真实查询时间，经 GitHub API 提交此 JSON 文件，保留其他快照、所有页面和资产。不修改原资源台账、领取状态或其他项目。

连接器失败时保留旧值及旧时间。不得绕过自动审批拒绝而改用私库凭据。提交使用最新 main 和 expected SHA；核实 Cloudflare 构建。正常同步不发聊天提醒，持续失败或确需用户处理时才报告。

同步 Firecrawl 时保留 `credits` 的 `mode: balance`，把同次 `planCredits` 写为 `limit`、`referenceLabel: 账期额度`；不从余额反推已用量。保留快照中的 GitHub 用户确认、HF、Apify 及其原观测时间。数值与账期不变且公开快照不足 24 小时时，不为时间戳单独触发部署。

## 口径

- CPU 比例由 InstaBox 返回且已按核数归一；内存使用同次 used/total。
- 磁盘按 /data 的 usedBytes/sizeBytes；不混用 df 的保留空间分母。
- Cloudflare 日计数注明 UTC 日期；R2 瞬时字节不除以 GB-month 额度。
- Firecrawl 余额大于账期额度时分别显示，不用差值推算消耗。

## 官方依据

- https://api.instabox.sh/v1/openapi.json
- https://instabox.sh/docs/reference/typescript/metrics
- https://docs.firecrawl.dev/api-reference/endpoint/credit-usage
- https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- https://developers.cloudflare.com/analytics/graphql-api/
- https://developers.cloudflare.com/r2/platform/metrics-analytics/
- https://github.com/huggingface/huggingface_hub/blob/main/src/huggingface_hub/_space_api.py （`ZeroGpuQuota`：`current` 映射为剩余 GPU 秒，`base` 为基础配额）
