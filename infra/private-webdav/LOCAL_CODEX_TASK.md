# Local Codex 工单：部署个人 WebDAV

## 输入
本对话产出的 `private-webdav-ready.zip`，Cloudflare 上已托管的 `miki2022.eu.org`；本机现有 Wrangler OAuth 登录。

## 必做
1. 解压项目；运行 `npm test`；确认 10 项通过。
2. 通过 `npx wrangler whoami` 核对 Cloudflare 所属账号、`miki2022.eu.org` zone，检查 `dav.miki2022.eu.org` 是否已占用。
3. 核查 Workers Free 与 R2 订阅及费用条件。如果 R2 未激活且需要支付/绑卡，不继续；向用户报告。
4. 启用私有 R2 bucket `miki-private-webdav`、Worker `miki-private-webdav`，设置 `DAV_USER` 和 `DAV_PASSWORD` 为 Worker Secrets；不要复制给 GPT 或提交 GitHub。
5. 使用项目自带 Windows PowerShell 脚本部署；检查 Cloudflare 实际回显并确保自定义域名 `dav.miki2022.eu.org` 绑定到此 Worker；不覆盖其他 Worker/Pages。
6. 用匿名 `PROPFIND` 验证 401，认证 `PROPFIND` 验证 207，再测 MKCOL/PUT/GET/MOVE/DELETE。
7. 用 LX Music `测试连接` 和一次实际测试歌单同步验收。用户操作移动客户端属于客户端测试；不能将单元测试当作完成跨设备同步。

## 最终交付
实际生效域名、测试结果、失败点、是否产生费用以及 Worker 和 R2 的后台状态。敏感信息留在本地。

## 禁止
未经同意启用计费；修改 `studio.miki2022.eu.org`；使用 Quick Tunnel 代替持久服务；在仓库或 Actions 保存登录态。