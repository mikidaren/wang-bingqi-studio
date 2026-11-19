# 独立 WebDAV 服务部署计划（Cloudflare Workers + R2）

目标：`https://dav.miki2022.eu.org/`，服务名 `miki-private-webdav`，私有 R2 bucket `miki-private-webdav`。

此目录是基础设施交接记录，不影响现有 `studio.miki2022.eu.org` Cloudflare Pages 构建、DNS 或站点代码。部署源码及自动化测试已整理为会话中的 `private-webdav-ready.zip`（包含 `src/index.js`、`wrangler.toml`、PowerShell/Bash 部署脚本、10 项单元测试与线上烟雾测试）；请先将该压缩包解压到本地项目目录后运行。

## 本地部署（Windows / Codex）
1. Node.js 24 LTS；在源码目录执行 `npm install` 和 `npm test`（应有 10/10 PASS）。
2. `npx wrangler login`；核实 Cloudflare 账号与 `miki2022.eu.org` 所在 zone。
3. 检查 R2 是否启用。若要求 R2 账单开通或绑定支付方式，停止，由用户审查费用选项。
4. `powershell -ExecutionPolicy Bypass -File scripts/deploy-cloudflare.ps1`，按提示为 `DAV_USER`、`DAV_PASSWORD` 设置独立 Worker Secrets。
5. 验证真实部署 URL、Cloudflare 证书和 401/207 状态；然后运行 `scripts/verify-webdav.sh`（Git Bash/WSL）。
6. 在截图中的 LX Music WebDAV 设置填写地址、用户名、密码和 `/LX_Music/`，测试连接，再用测试歌单检查双设备同步。

**界限**：原 Cloudflare Pages 站点不更改；R2 bucket 保持私有；不把任何 Cookie、密码、令牌、验证码放入仓库；不将 Cloudflare Quick Tunnel 当作常驻文件服务。源码目前仅为 WebDAV Level 1 的小文件同步实现，单文件上限 8 MiB，不支持 LOCK/UNLOCK 或目录 MOVE。

关联：`mikidaren/Miki-BadBrowserUse` 提供的 GitHub Actions + Quick Tunnel 仅适合临时公开测试，不是 R2 持久存储部署。