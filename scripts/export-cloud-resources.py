#!/usr/bin/env python3
"""Export a small public projection of a private resource ledger.

Only reviewed display profiles, enum mappings, validated dates and allowlisted
numeric usage snapshots can reach the output. Source names, notes, URLs,
evidence, account fields and arbitrary nested fields are never copied.

Example (all inputs are local files; this script makes no network requests):
  python3 scripts/export-cloud-resources.py \
    --benefits /private/dashboard/benefits.json \
    --catalog /private/dashboard/resource-catalog.json \
    --usage /private/dashboard/usage.json \
    --output src/data/cloud-resources.json
"""

import argparse
from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import sys


CATEGORIES = [
    {"id": "compute", "label": "算力与环境"},
    {"id": "hosting", "label": "托管与网络"},
    {"id": "storage", "label": "存储与数据库"},
    {"id": "ai", "label": "AI 服务"},
    {"id": "browser", "label": "浏览器与采集"},
    {"id": "tools", "label": "开发工具"},
]


def profile(provider, name, category, initials, accent, summary, url, *config):
    return {
        "provider": provider,
        "name": name,
        "category": category,
        "initials": initials,
        "accent": accent,
        "summary": summary,
        "officialUrl": url,
        "configuration": [{"label": label, "value": value} for label, value in config],
    }


# Human-reviewed public wording. These values intentionally do not come from
# free-text ledger fields. Update the profiles when a plan needs re-review.
DISPLAY = {
    "github-actions-compute": profile(
        "GitHub", "GitHub Actions", "compute", "GH", "#24292f",
        "Linux CPU 曾完成计算任务；当前使用受限。",
        "https://docs.github.com/en/actions",
        ("环境记录", "Ubuntu Linux"), ("算力配置", "按任务分配"),
        ("额度状态", "待重新核验")),
    "cloudflare-quick-tunnel": profile(
        "Cloudflare", "Cloudflare Quick Tunnel", "hosting", "CF", "#f48120",
        "已完成临时 HTTPS 访问测试，测试隧道已结束。",
        "https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/",
        ("服务类型", "临时 HTTPS 隧道"), ("地址分配", "每次运行生成"),
        ("使用记录", "历史测试")),
    "kaggle-gpu": profile(
        "Kaggle", "Kaggle GPU", "compute", "K", "#20a7d8",
        "双 T4 笔记本环境，已有 GPU 运算记录。",
        "https://www.kaggle.com/code",
        ("GPU 记录", "Tesla T4 × 2"), ("显存记录", "16 GB / 张"),
        ("可用时长", "随账户配额变化")),
    "colab-free": profile(
        "Google", "Google Colab", "compute", "CO", "#e89b10",
        "免费笔记本曾完成 CPU、GPU 与 TPU 运算。",
        "https://colab.research.google.com/",
        ("GPU 记录", "Tesla T4"), ("TPU 记录", "TPU v5 lite"),
        ("当前配置", "按会话分配")),
    "google-cloud-shell": profile(
        "Google Cloud", "Google Cloud Shell", "tools", "GC", "#4285f4",
        "已有 Linux 开发终端运行记录，适合临时开发任务。",
        "https://shell.cloud.google.com/",
        ("方案时长", "50 小时 / 周"), ("HOME 容量", "5 GB"),
        ("剩余时长", "待核验")),
    "cloudflare-workers": profile(
        "Cloudflare", "Cloudflare Workers", "hosting", "CF", "#f48120",
        "已有 Worker 运行记录，适合边缘接口与轻量应用。",
        "https://developers.cloudflare.com/workers/",
        ("方案请求量", "100,000 次 / 日"), ("CPU 限额", "10 ms / 请求"),
        ("运行方式", "按请求执行")),
    "hf-zerogpu": profile(
        "Hugging Face", "Hugging Face ZeroGPU", "ai", "HF", "#c79d13",
        "2026-11-23 账户验收：鉴权与个人配额查询通过，非 PRO，支付标志为 false；Space 缺少应用文件，未验证 GPU 运行。",
        "https://huggingface.co/docs/hub/spaces-zerogpu",
        ("配额快照", "基础 300 秒；当前 300 秒"),
        ("超额与重置", "超额 0 秒；重置时间未返回"),
        ("Space 状态快照", "NO_APP_FILE（缺应用文件）"),
        ("硬件快照", "实际未分配；申请 zero-a10g")),
    "cloudflare-pages": profile(
        "Cloudflare", "Cloudflare Pages", "hosting", "CF", "#f48120",
        "已用于静态网站托管与自定义域名访问。",
        "https://developers.cloudflare.com/pages/",
        ("方案构建量", "500 次 / 月"), ("服务类型", "静态网站托管"),
        ("构建余量", "待核验")),
    "cloudflare-kv": profile(
        "Cloudflare", "Cloudflare Workers KV", "storage", "KV", "#e27419",
        "已有键值存储使用记录，适合边缘应用的小型数据。",
        "https://developers.cloudflare.com/kv/",
        ("方案容量", "1 GB"), ("读取额度", "100,000 次 / 日"),
        ("写入额度", "1,000 次 / 日")),
    "cloudflare-r2-webdav": profile(
        "Cloudflare", "Cloudflare R2", "storage", "R2", "#e27419",
        "对象存储与 WebDAV 已有使用记录；超出包含额度可能计费。",
        "https://developers.cloudflare.com/r2/pricing/",
        ("包含存储量", "10 GB-month"), ("Class A 请求", "100 万次 / 月"),
        ("Class B 请求", "1,000 万次 / 月"), ("费用边界", "超额可能计费")),
    "cloudflare-browser-run": profile(
        "Cloudflare", "Cloudflare Browser Run", "browser", "CF", "#f48120",
        "云端浏览器已有运行记录，可用于网页访问与自动化。",
        "https://developers.cloudflare.com/browser-rendering/",
        ("方案时长", "10 分钟 / 日"), ("并发上限", "3 个浏览器"),
        ("当前余量", "待核验")),
    "browserless-free": profile(
        "Browserless", "Browserless", "browser", "BL", "#6c53d8",
        "已有云浏览器调用记录，方案额度来自历史账户快照。",
        "https://www.browserless.io/pricing",
        ("历史月额度", "1,000 units"), ("额度记录", "2026-11-11"),
        ("当前余量", "待核验")),
    "anchor-free": profile(
        "Anchor", "Anchor Browser", "browser", "AN", "#7357d8",
        "已有账户记录，浏览器会话创建仍待接入验收。",
        "https://anchorbrowser.io/",
        ("历史月额度", "5 credits"), ("历史并发上限", "5 个会话"),
        ("当前余量", "待核验")),
    "cloudflare-d1": profile(
        "Cloudflare", "Cloudflare D1", "storage", "D1", "#e27419",
        "2026-11-23 账户验收：本次 D1 数据库目录请求返回 HTTP 401；未取得 D1 目录与用量，保留用户确认的领取记录。",
        "https://developers.cloudflare.com/d1/",
        ("方案总容量", "5 GB"), ("单库上限", "500 MB"),
        ("读取额度", "500 万行 / 日"), ("写入额度", "10 万行 / 日")),
    "neon-free": profile(
        "Neon", "Neon Postgres", "storage", "NE", "#15976b",
        "2026-11-23 账户验收：Free 组织中已有 1 个项目、1 个 idle 端点；本次未执行 SQL。",
        "https://neon.com/pricing",
        ("公开计算额度", "100 CU-hours / 项目 / 月"),
        ("公开存储额度", "1 GB / 项目"), ("项目快照", "1 个项目；1 个 idle 端点"),
        ("数据库执行", "本次未执行 SQL")),
    "railway-anonymous-vm": profile(
        "Railway", "Railway 临时云环境", "compute", "RW", "#6949a8",
        "曾验证短时 Linux 任务，记录不代表持续运行的实例。",
        "https://railway.com/free-vm",
        ("CPU 记录", "2 vCPU"), ("内存记录", "2 GB"),
        ("历史任务时限", "60 分钟")),
    "backblaze-b2-free": profile(
        "Backblaze", "Backblaze B2", "storage", "B2", "#d83e47",
        "2026-11-23 账户验收：账户鉴权通过；存储桶目录、上传下载与实际用量尚未验证。",
        "https://www.backblaze.com/cloud-storage/pricing",
        ("公开免费容量", "前 10 GB"), ("出站规则", "月均存储量的 3 倍"),
        ("账户用量", "待核验")),
    "browserbase-free": profile(
        "Browserbase", "Browserbase", "browser", "BB", "#d26740",
        "2026-11-23 账户验收：确认 1 个项目并读取用量快照；本次未创建浏览器会话。",
        "https://docs.browserbase.com/",
        ("项目快照", "1 个"), ("浏览器时长快照", "0 分钟"),
        ("代理流量快照", "0 bytes"), ("用量统计周期", "未返回；剩余额度未推算")),
    "instabox-free": profile(
        "InstaBox", "InstaBox 云电脑", "compute", "IB", "#507caa",
        "2026-11-23 账户验收：官方 API 确认免费实例配置，状态为已挂起；本次未启动实例。",
        "https://dashboard.instabox.sh",
        ("CPU 配置快照", "4 vCPU"), ("内存配置快照", "8 GiB（8192 MiB）"),
        ("持久盘配置快照", "20 GiB"), ("实例状态快照", "suspended（已挂起）"))
        | {"availabilityLabel": "已挂起 · 运行待验收"},
    "northflank-sandbox": profile(
        "Northflank", "Northflank Sandbox", "hosting", "NF", "#4b72d3",
        "应用托管账户已注册，服务部署与实际额度待验收。",
        "https://northflank.com/pricing",
        ("公开服务配额", "2 个 services"), ("任务配额", "2 个 jobs"),
        ("数据库配额", "1 个 database")),
    "zenrows-free": profile(
        "Zenrows", "Zenrows", "browser", "ZR", "#db7147",
        "网页采集账户已登记，接口调用与余额待接入验收。",
        "https://www.zenrows.com/pricing",
        ("公开月额度", "5,000 credits"), ("服务类型", "网页采集 API"),
        ("当前余额", "待核验")),
    "apify-free": profile(
        "Apify", "Apify", "browser", "AP", "#bc7341",
        "2026-11-23 账户验收：确认 FREE 方案并读取月度消费；本次未运行 Actor，消费上限不等于赠额余额。",
        "https://apify.com/pricing",
        ("方案快照", "FREE（月费 $0）"), ("方案月赠额", "$5"),
        ("月度消费快照", "$0"), ("账户消费上限", "$5")),
    "firecrawl-free": profile(
        "Firecrawl", "Firecrawl", "browser", "FC", "#de6b37",
        "已通过连接器读取网页，历史额度保留独立观测时间。",
        "https://www.firecrawl.dev/pricing",
        ("计量单位", "credits"), ("刷新周期", "按账户账期"),
        ("验证途径", "已连接服务")),
    "render-free": profile(
        "Render", "Render Web Service", "hosting", "RE", "#5960b7",
        "2026-11-23 账户验收：唯一工作区的服务、Postgres 与 Key Value 目录均为空；本次未创建或部署资源。",
        "https://render.com/docs/free",
        ("服务快照", "0 个"), ("Postgres 快照", "0 个"),
        ("Key Value 快照", "0 个"), ("公开月额度", "750 实例小时 / 工作区")),
    "cloudflare-workers-ai": profile(
        "Cloudflare", "Cloudflare Workers AI", "ai", "AI", "#e27419",
        "2026-11-23 账户验收：模型目录读取成功；本次未执行推理，账户用量未取得。",
        "https://developers.cloudflare.com/workers-ai/",
        ("公开日额度", "10,000 Neurons"), ("验收范围", "模型目录读取"),
        ("推理与余量", "本次未验证")),
    "upstash-redis-free": profile(
        "Upstash", "Upstash Redis", "storage", "UP", "#1a9b70",
        "2026-11-23 账户验收：管理接口鉴权通过，数据库目录为 0 个；Redis 实例与读写尚未验收。",
        "https://upstash.com/pricing/redis",
        ("公开存储额度", "250 MB"), ("命令额度", "50 万次 / 月"),
        ("带宽额度", "10 GB / 月"), ("数据库快照", "0 个")),
    "groq-free": profile(
        "Groq", "Groq 推理 API", "ai", "GQ", "#d96840",
        "2026-11-23 账户验收：鉴权与模型目录读取成功，返回 11 个模型；本次未执行推理。",
        "https://console.groq.com/docs/rate-limits",
        ("额度方式", "按模型分别限流"), ("周期", "分钟与日限额"),
        ("模型目录快照", "11 个"), ("实际可用量", "未取得账户读数")),
    "turso-free": profile(
        "Turso", "Turso", "storage", "TU", "#338b7e",
        "2026-11-23 账户验收：数据库接口仅验证了关闭请求并返回成功；本次未执行 SQL，读写能力未验收。",
        "https://turso.tech/pricing",
        ("公开数据库数", "100 个"), ("总存储额度", "5 GB"),
        ("读取额度", "5 亿行 / 月"), ("写入额度", "1,000 万行 / 月")),
}

# Fixed public entry points, reviewed separately from resource evidence. Most
# come from the ledger's action URLs; generic origins discard account paths.
# Browserless: https://docs.browserless.io/overview/api-keys
# Browserbase: https://docs.browserbase.com/integrations/vercel/quickstart
# Apify: https://docs.apify.com/account/console
# Northflank: https://northflank.com/legal/terms
# Zenrows: https://docs.zenrows.com/first-steps/pricing
# Quick Tunnel and the historical anonymous VM have no account console here.
CONSOLES = {
    "github-actions-compute": ("https://github.com/settings/billing", "查看账户用量"),
    "kaggle-gpu": ("https://www.kaggle.com/code", "打开控制台"),
    "colab-free": ("https://colab.research.google.com/", "打开控制台"),
    "google-cloud-shell": ("https://shell.cloud.google.com/", "打开控制台"),
    "cloudflare-workers": ("https://dash.cloudflare.com/", "打开控制台"),
    "hf-zerogpu": ("https://huggingface.co/settings/profile", "打开账户设置"),
    "cloudflare-pages": ("https://dash.cloudflare.com/", "打开控制台"),
    "cloudflare-kv": ("https://dash.cloudflare.com/", "打开控制台"),
    "cloudflare-r2-webdav": ("https://dash.cloudflare.com/", "打开控制台"),
    "cloudflare-browser-run": ("https://dash.cloudflare.com/", "打开控制台"),
    "browserless-free": ("https://www.browserless.io/account/", "打开控制台"),
    "anchor-free": ("https://app.anchorbrowser.io/mcp", "打开控制台"),
    "cloudflare-d1": ("https://dash.cloudflare.com/", "打开控制台"),
    "neon-free": ("https://console.neon.tech/", "打开控制台"),
    "backblaze-b2-free": ("https://secure.backblaze.com/", "打开控制台"),
    "browserbase-free": ("https://www.browserbase.com/overview", "打开控制台"),
    "instabox-free": ("https://dashboard.instabox.sh", "打开控制台"),
    "northflank-sandbox": ("https://app.northflank.com/", "打开控制台"),
    "zenrows-free": ("https://app.zenrows.com/", "打开控制台"),
    "apify-free": ("https://console.apify.com/", "打开控制台"),
    "firecrawl-free": ("https://www.firecrawl.dev/app", "打开控制台"),
    "render-free": ("https://dashboard.render.com/", "打开控制台"),
    "cloudflare-workers-ai": ("https://dash.cloudflare.com/", "打开控制台"),
    "upstash-redis-free": ("https://console.upstash.com/", "打开控制台"),
    "groq-free": ("https://console.groq.com/", "打开控制台"),
    "turso-free": ("https://app.turso.tech/", "打开控制台"),
}

STATUSES = {"claimed", "verified", "pending", "candidate"}
ACQUISITIONS = {"owned", "registered", "unclaimed", "historical", "paused", "blocked", "unknown"}
EVIDENCE = {
    "runtime": "runtime",
    "platform": "account",
    "user-reported": "user-confirmed",
    "user-screenshot": "screenshot",
    "account": "account",
}
AVAILABILITY = {
    "recorded": "已有运行记录",
    "historical": "历史临时使用",
    "restricted": "当前受限",
    "unverified": "当前状态待核验",
    "awaiting-setup": "待接入验收",
}


def unknown_metric(key, label, kind):
    return {"key": key, "label": label, "kind": kind, "mode": "unknown",
            "displayValue": "未观测", "basis": "unknown",
            "note": "暂无可核实的用量读数。"}


def capacity_metric(key, label, kind, display_value, value=None, unit=None,
                    basis="plan-limit", note=None):
    metric = {"key": key, "label": label, "kind": kind, "mode": "capacity",
              "displayValue": display_value, "basis": basis,
              "note": note or ("历史配置记录；实际占用未观测。" if basis == "recorded-config"
                               else "方案额度记录；账户实际用量未观测。")}
    if value is not None:
        metric["value"] = value
    if unit is not None:
        metric["unit"] = unit
    return metric


def hardware_metrics(cpu=None, memory=None, storage=None, gpu=None):
    """Four fixed hardware slots; capacity is never a utilization percentage."""
    return [deepcopy(value) if value else unknown_metric(key, label, key)
            for key, label, value in (("cpu", "CPU", cpu), ("memory", "内存", memory),
                                      ("storage", "存储", storage), ("gpu", "GPU", gpu))]


# Public numeric profiles are reviewed alongside DISPLAY. Never parse ledger
# free text into a metric, and never use a plan value as an observed denominator.
VISUAL_PROFILES = {
    "github-actions-compute": hardware_metrics(),
    "cloudflare-quick-tunnel": [unknown_metric("requests", "请求用量", "requests"),
                                unknown_metric("traffic", "传输流量", "network")],
    "kaggle-gpu": hardware_metrics(gpu=capacity_metric(
        "gpu", "GPU", "gpu", "T4 × 2", 2, "GPU", "recorded-config",
        "历史运行配置；每张 16 GB 显存，当前分配与占用未观测。")),
    "colab-free": hardware_metrics(gpu=capacity_metric(
        "gpu", "GPU / TPU", "gpu", "T4 / TPU v5 lite", basis="recorded-config",
        note="分别来自历史会话；当前硬件按会话分配。")),
    "google-cloud-shell": hardware_metrics(storage=capacity_metric(
        "storage", "HOME 存储", "storage", "5 GB", 5, "GB")),
    "cloudflare-workers": [
        capacity_metric("requests", "请求额度", "requests", "100,000 次 / 日", 100000, "requests"),
        capacity_metric("cpu_time", "CPU 时间", "cpu", "10 ms / 请求", 10, "ms")],
    "hf-zerogpu": [
        capacity_metric("gpu_minutes", "个人共享 GPU 配额", "runtime", "5 分钟基础配额", 5, "minutes",
                        note="2026-11-23 06:04（北京时间）个人调用共享 ZeroGPU 的基础与当前配额均为 300 秒；重置时间未返回，不代表自建 Space 已分配 GPU。"),
        {**unknown_metric("gpu", "Space GPU 配置", "gpu"),
         "note": "2026-11-23 Space 为 NO_APP_FILE，实际硬件未分配；申请 zero-a10g 不等于已获得 GPU。"}],
    "cloudflare-pages": [
        capacity_metric("builds", "构建额度", "quota", "500 次 / 月", 500, "builds"),
        unknown_metric("build_usage", "已用构建", "quota")],
    "cloudflare-kv": [
        capacity_metric("storage", "存储容量", "storage", "1 GB", 1, "GB"),
        capacity_metric("reads", "读取额度", "requests", "100,000 次 / 日", 100000, "requests"),
        capacity_metric("writes", "写入额度", "requests", "1,000 次 / 日", 1000, "requests")],
    "cloudflare-r2-webdav": [
        capacity_metric("storage", "包含存储量", "storage", "10 GB-month", 10, "GB-month",
                        note="按月累计的包含存储量；超额可能计费，实际用量未观测。"),
        capacity_metric("class_a", "Class A 请求", "requests", "100 万次 / 月", 1000000, "requests"),
        capacity_metric("class_b", "Class B 请求", "requests", "1,000 万次 / 月", 10000000, "requests")],
    "cloudflare-browser-run": [
        capacity_metric("browser_minutes", "浏览器时长", "runtime", "10 分钟 / 日", 10, "minutes"),
        capacity_metric("concurrency", "并发上限", "concurrency", "3 个浏览器", 3, "browsers")],
    "browserless-free": [
        capacity_metric("units", "历史月额度", "quota", "1,000 units", 1000, "units", "recorded-config"),
        unknown_metric("used_units", "已用额度", "quota")],
    "anchor-free": [
        capacity_metric("credits", "历史月额度", "quota", "5 credits", 5, "credits", "recorded-config"),
        capacity_metric("concurrency", "历史并发上限", "concurrency", "5 个会话", 5, "sessions", "recorded-config")],
    "cloudflare-d1": [
        capacity_metric("storage", "总存储容量", "storage", "5 GB", 5, "GB"),
        capacity_metric("database_storage", "单库容量", "storage", "500 MB", 500, "MB"),
        capacity_metric("reads", "读取额度", "requests", "500 万行 / 日", 5000000, "rows"),
        capacity_metric("writes", "写入额度", "requests", "10 万行 / 日", 100000, "rows")],
    "neon-free": [
        capacity_metric("compute_hours", "计算额度", "runtime", "100 CU-hours / 月", 100, "CU-hours",
                        note="公开方案按项目每月计量；账户实际用量未观测。"),
        capacity_metric("storage", "项目存储", "storage", "1 GB / 项目", 1, "GB")],
    "railway-anonymous-vm": hardware_metrics(
        cpu=capacity_metric("cpu", "CPU", "cpu", "2 vCPU", 2, "vCPU", "recorded-config"),
        memory=capacity_metric("memory", "内存", "memory", "2 GB", 2, "GB", "recorded-config")),
    "backblaze-b2-free": [
        capacity_metric("storage", "免费存储容量", "storage", "前 10 GB", 10, "GB"),
        capacity_metric("egress", "出站额度规则", "network", "月均存储量 × 3",
                        note="公开出站规则；实际可用流量需结合当月存储量核实。")],
    "browserbase-free": [
        capacity_metric("browser_minutes", "浏览器时长", "runtime", "60 分钟 / 月", 60, "minutes"),
        capacity_metric("fetch_requests", "Fetch 额度", "requests", "1,000 次 / 月", 1000, "requests"),
        capacity_metric("concurrency", "并发上限", "concurrency", "3 个会话", 3, "sessions"),
        unknown_metric("proxy_bytes", "代理流量", "network")],
    "instabox-free": hardware_metrics(
        cpu=capacity_metric("cpu", "CPU", "cpu", "4 vCPU", 4, "vCPU", "recorded-config",
                            "2026-11-23 06:03（北京时间）官方 API 配置快照；实例已挂起，实际占用未观测。"),
        memory=capacity_metric("memory", "内存", "memory", "8 GiB", 8, "GiB", "recorded-config",
                               "2026-11-23 06:03（北京时间）官方 API 配置快照，8192 MiB；实例已挂起，实际占用未观测。"),
        storage=capacity_metric("storage", "持久盘", "storage", "20 GiB", 20, "GiB", "recorded-config",
                                "2026-11-23 06:03（北京时间）官方 API 确认的持久盘配置；实际已用空间未观测，不与根盘容量合并。")),
    "northflank-sandbox": [
        capacity_metric("services", "服务配额", "quota", "2 个 services", 2, "services"),
        capacity_metric("jobs", "任务配额", "quota", "2 个 jobs", 2, "jobs"),
        capacity_metric("databases", "数据库配额", "storage", "1 个 database", 1, "databases")],
    "zenrows-free": [
        capacity_metric("plan_credits", "公开月额度", "quota", "5,000 credits", 5000, "credits"),
        unknown_metric("key_usage", "API Key 用量", "quota")],
    "apify-free": [
        capacity_metric("plan_credits", "公开月额度", "quota", "$5", 5, "USD"),
        unknown_metric("monthly_usage_usd", "账户消费", "quota")],
    "firecrawl-free": [unknown_metric("credits", "采集额度", "quota"),
                        unknown_metric("plan_credits", "账期额度", "quota")],
    "render-free": [
        capacity_metric("instance_hours", "实例时长", "runtime", "750 小时 / 月", 750, "instance-hours",
                        note="公开方案按工作区共享计量；2026-11-23 工作区未发现服务、Postgres 或 Key Value 实例，实际用量未观测。"),
        {**unknown_metric("cpu", "CPU", "cpu"), "note": "2026-11-23 未发现已部署实例，无 CPU 负载观测。"},
        {**unknown_metric("memory", "内存", "memory"), "note": "2026-11-23 未发现已部署实例，无内存占用观测。"}],
    "cloudflare-workers-ai": [
        capacity_metric("neurons", "推理额度", "quota", "10,000 Neurons / 日", 10000, "Neurons"),
        unknown_metric("used_neurons", "已用额度", "quota")],
    "upstash-redis-free": [
        capacity_metric("storage", "存储容量", "storage", "250 MB", 250, "MB",
                        note="公开方案上限；2026-11-23 数据库目录为 0 个，尚无实例用量观测。"),
        capacity_metric("commands", "命令额度", "requests", "50 万次 / 月", 500000, "commands",
                        note="公开方案上限；2026-11-23 数据库目录为 0 个，尚无实例用量观测。"),
        capacity_metric("bandwidth", "带宽额度", "network", "10 GB / 月", 10, "GB",
                        note="公开方案上限；2026-11-23 数据库目录为 0 个，尚无实例用量观测。")],
    "groq-free": [unknown_metric("requests", "请求额度", "requests"),
                  unknown_metric("tokens", "Token 额度", "quota")],
    "turso-free": [
        capacity_metric("databases", "数据库配额", "storage", "100 个", 100, "databases"),
        capacity_metric("storage", "总存储容量", "storage", "5 GB", 5, "GB"),
        capacity_metric("reads", "读取额度", "requests", "5 亿行 / 月", 500000000, "rows"),
        capacity_metric("writes", "写入额度", "requests", "1,000 万行 / 月", 10000000, "rows")],
}

OBSERVED_SPECS = {
    "firecrawl-free": {"credits": ("采集额度", "quota", "credits", "账期额度与余额来自账户快照。")},
    "apify-free": {"monthly_usage_usd": ("账户消费", "quota", "USD",
                       "按账户消费上限计量；赠送余额未核实。")},
    "browserbase-free": {
        "browser_minutes": ("浏览器用量", "runtime", "minutes", "已观测绝对用量；统计周期未知。"),
        "proxy_bytes": ("代理流量", "network", "bytes", "已观测绝对用量；统计周期未知。"),
    },
}
CAP_WINDOWS = {"day": "每日", "week": "每周", "month": "每月",
               "billing_period": "账期", "unknown": "周期未知"}


class ExportError(ValueError):
    """A deliberately generic error that does not reveal source values."""


def calendar_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ExportError("Invalid record date")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ExportError("Invalid record date") from None


def utc_timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value
    ):
        raise ExportError("Invalid UTC observation time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.isoformat().replace("+00:00", "Z")
    except ValueError:
        raise ExportError("Invalid UTC observation time") from None


def index_items(document):
    if not isinstance(document, dict) or not isinstance(document.get("items"), list):
        raise ExportError("Input is not a resource document")
    result = {}
    for item in document["items"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ExportError("Invalid resource record")
        if item["id"] in result:
            raise ExportError("Duplicate resource record")
        result[item["id"]] = item
    return result


def number(value):
    return type(value) in (int, float) and 0 <= value <= 10**15 and math.isfinite(value)


def numeric_text(value):
    if 0 < value < 0.000001:
        return f"{value:.6g}"
    return f"{value:,.6f}".rstrip("0").rstrip(".")


def measured_text(value, unit):
    value_text = numeric_text(value)
    if unit == "USD":
        return "$" + value_text
    if unit == "minutes":
        return value_text + " 分钟"
    if unit == "bytes":
        for divider, suffix in ((1024**4, "TiB"), (1024**3, "GiB"),
                                (1024**2, "MiB"), (1024, "KiB")):
            if value >= divider:
                return numeric_text(value / divider) + " " + suffix
    return value_text + " " + unit


def observed_metrics(resource_id, snapshot):
    """Read one normalized observation, with no joins to public plan limits.

    An unavailable snapshot with accepted auth may retain the last successful
    observation, as defined by update-resource-usage.py; its time stays intact.
    Neither successful authentication nor catalog access establishes usage.
    """
    if (not isinstance(snapshot, dict) or snapshot.get("auth") != "accepted"
            or snapshot.get("source") not in {"connected_plugin", "provider_api"}
            or snapshot.get("status") not in {"observed", "unavailable"}
            or resource_id not in {*OBSERVED_SPECS, "zenrows-free"}):
        return [], "unknown"
    raw_metrics = snapshot.get("metrics", [])
    if not isinstance(raw_metrics, list):
        raise ExportError("Invalid usage metrics")
    checked_at = utc_timestamp(snapshot.get("checkedAtUtc"))
    stale = snapshot["status"] == "unavailable"
    results, seen = [], set()
    for raw in raw_metrics:
        if not isinstance(raw, dict) or not isinstance(raw.get("key"), str):
            continue
        key = raw["key"]
        spec = OBSERVED_SPECS.get(resource_id, {}).get(key)
        if resource_id == "zenrows-free":
            match = re.fullmatch(r"key_cap_(day|week|month|billing_period|unknown)_([1-9]|10)", key)
            if match:
                spec = ("API Key 限额 · " + CAP_WINDOWS[match.group(1)], "quota", "credits",
                        "API Key 的显式额度；不代表完整套餐余额。")
        if spec is None:
            continue
        if key in seen:
            raise ExportError("Duplicate usage metric")
        seen.add(key)
        label, kind, unit, note = spec
        if raw.get("unit") != unit:
            continue
        values = {field: raw[field] for field in ("used", "limit", "remaining")
                  if number(raw.get(field))}
        # This endpoint reports absolute counts with no documented plan/cycle.
        # Ignore injected denominators rather than combining with public plans.
        if resource_id == "browserbase-free":
            values = {"used": values["used"]} if "used" in values else {}
        if not values:
            continue
        reset_at = None
        if raw.get("resetAtUtc") is not None:
            try:
                reset_at = utc_timestamp(raw["resetAtUtc"])
            except ExportError:
                pass
        inconsistent = False
        if "remaining" in values and "limit" in values and values["remaining"] > values["limit"]:
            values.pop("used", None)
            note += " 余额高于账期额度；额外额度来源未核实，已用量未推算。"
            inconsistent = True
        elif all(field in values for field in ("used", "limit", "remaining")):
            inconsistent = not math.isclose(values["used"] + values["remaining"], values["limit"],
                                            rel_tol=1e-8, abs_tol=1e-6)
            if inconsistent:
                note += " 用量、余额与额度不一致；不绘制消耗比例。"
        if "used" in values:
            mode, value = "usage", values["used"]
        elif "remaining" in values:
            mode, value = "balance", values["remaining"]
        else:
            mode, value = "capacity", values["limit"]
        metric = {"key": key, "label": label, "kind": kind, "mode": mode,
                  "displayValue": measured_text(value, unit), "unit": unit,
                  **values, "basis": "observed", "checkedAt": checked_at}
        if mode == "capacity":
            metric["value"] = value
        if (not inconsistent and reset_at is not None and "used" in values
                and values.get("limit", 0) > 0 and resource_id != "browserbase-free"):
            percentage = values["used"] / values["limit"] * 100
            if math.isfinite(percentage):
                metric["percent"] = percentage
        elif "used" in values and resource_id != "browserbase-free" and not inconsistent:
            note += " 同周期的完整额度读数尚未取得。"
        if stale:
            note = "刷新未取得新用量；保留上次有效观测。 " + note
        metric["note"] = note
        if resource_id != "firecrawl-free" or mode != "capacity":
            results.append(metric)
        if resource_id == "firecrawl-free" and "limit" in values:
            plan = capacity_metric("plan_credits", "账期额度", "quota",
                measured_text(values["limit"], unit), values["limit"], unit, "observed",
                "同次账户快照中的账期额度；与余额分开显示。")
            plan["checkedAt"] = checked_at
            if stale:
                plan["note"] = "保留上次有效观测。 " + plan["note"]
            results.append(plan)
    return results, ("stale" if stale else "observed") if results else "unknown"


def resource_metrics(resource_id, snapshot):
    if resource_id not in VISUAL_PROFILES:
        raise ExportError("A selected resource needs reviewed visual metrics")
    defaults = deepcopy(VISUAL_PROFILES[resource_id])
    observed, status = observed_metrics(resource_id, snapshot)
    if not observed:
        return defaults, status
    keys = {metric["key"] for metric in observed}
    # Prioritize measured values, retain distinct configuration cards, and keep
    # the compact 2–4 cell layout. Hardware has no accepted usage source yet.
    return (observed + [metric for metric in defaults if metric["key"] not in keys])[:4], status


def firecrawl_quota(snapshot):
    if not snapshot or snapshot.get("status") != "observed" or snapshot.get("auth") != "accepted":
        return None
    if snapshot.get("source") not in {"connected_plugin", "provider_api"}:
        return None
    metrics = snapshot.get("metrics", [])
    if not isinstance(metrics, list):
        raise ExportError("Invalid usage metrics")
    credits = [m for m in metrics if isinstance(m, dict) and m.get("key") == "credits"]
    if (len(credits) != 1 or credits[0].get("unit") != "credits"
            or not number(credits[0].get("remaining"))):
        return None
    metric = credits[0]
    value = numeric_text(metric["remaining"])
    note = "历史快照，非当前余额。"
    if number(metric.get("limit")) and metric["remaining"] > metric["limit"]:
        note += "余额高于账期额度，额外额度来源未核实。"
    return {
        "label": "已记录余额",
        "value": value + " credits",
        "checkedAt": utc_timestamp(snapshot.get("checkedAtUtc")),
        "note": note,
    }


def export_resources(benefits, catalog, usage, source_checked_at=None):
    ledger = index_items(benefits)
    plans = index_items(catalog)
    snapshots = index_items(usage)
    if set(ledger) != set(plans) or not set(snapshots).issubset(ledger):
        raise ExportError("Resource input IDs disagree")
    chosen = {}
    for resource_id, item in ledger.items():
        status = item.get("status")
        acquisition = plans[resource_id].get("acquisition")
        if status not in STATUSES or acquisition not in ACQUISITIONS:
            raise ExportError("Invalid resource status")
        if status == "claimed" and acquisition == "registered":
            raise ExportError("Claimed and registered states conflict")
        claim_status = "claimed" if status == "claimed" else "registered" if acquisition == "registered" else None
        if claim_status:
            if resource_id not in DISPLAY:
                raise ExportError("A selected resource needs a reviewed public display profile")
            chosen[resource_id] = claim_status

    resources = []
    for resource_id, display in DISPLAY.items():
        if resource_id not in chosen:
            continue
        item, plan = ledger[resource_id], plans[resource_id]
        claim_status = chosen[resource_id]
        proof = item.get("proofLevel")
        if proof not in EVIDENCE:
            raise ExportError("Selected resource has no supported evidence category")
        evidence_type = EVIDENCE[proof]
        evidence_label = {
            "runtime": "历史运行记录", "screenshot": "历史截图确认",
            "account": "账户记录", "user-confirmed": "用户确认领取" if claim_status == "claimed" else "用户确认注册",
        }[evidence_type]
        if claim_status == "registered":
            availability = "awaiting-setup"
        elif plan["acquisition"] == "historical":
            availability = "historical"
        elif plan["acquisition"] == "blocked":
            availability = "restricted"
        else:
            availability = "recorded" if evidence_type == "runtime" else "unverified"
        card = {
            "id": resource_id,
            **deepcopy(display),
            "claimStatus": claim_status,
            "claimLabel": "已领取" if claim_status == "claimed" else "待接入",
            "recordedAt": calendar_date(item.get("date")),
            "evidenceType": evidence_type,
            "evidenceLabel": evidence_label,
            "availability": availability,
            "availabilityLabel": display.get("availabilityLabel", AVAILABILITY[availability]),
        }
        if resource_id in CONSOLES:
            card["consoleUrl"], card["consoleLabel"] = CONSOLES[resource_id]
        card["metrics"], card["usageStatus"] = resource_metrics(resource_id, snapshots.get(resource_id))
        if resource_id == "firecrawl-free":
            quota = firecrawl_quota(snapshots.get(resource_id))
            if quota:
                card["quota"] = quota
        resources.append(card)
    claimed = sum(card["claimStatus"] == "claimed" for card in resources)
    registered = sum(card["claimStatus"] == "registered" for card in resources)
    now = source_checked_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "schemaVersion": 1,
        "updatedAt": calendar_date(benefits.get("updated")),
        "sourceCheckedAt": utc_timestamp(now),
        "notice": "硬件与方案额度按记录展示；用量保留账户快照的观测时间，未观测项不推算。",
        "summary": {"claimed": claimed, "registered": registered, "total": len(resources)},
        "categories": deepcopy(CATEGORIES),
        "resources": resources,
    }


def read_document(path):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ExportError("Duplicate JSON property")
            result[key] = value
        return result

    def invalid_number(_value):
        raise ExportError("Invalid JSON number")

    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object,
                          parse_constant=invalid_number)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ExportError("Unable to read a valid resource input") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benefits", required=True, type=Path)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--usage", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-checked-at", help="UTC time when the input snapshots were read")
    args = parser.parse_args()
    try:
        if args.output.resolve() in {p.resolve() for p in (args.benefits, args.catalog, args.usage)}:
            raise ExportError("Output must not overwrite a source input")
        result = export_resources(read_document(args.benefits), read_document(args.catalog),
                                  read_document(args.usage), args.source_checked_at)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, **result["summary"]}))
        return 0
    except ExportError as error:
        print("ERROR: " + str(error), file=sys.stderr)
    except (OSError, TypeError, ValueError, OverflowError):
        print("ERROR: Unable to export public resource data", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

