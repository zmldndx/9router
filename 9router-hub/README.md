# 9router-hub

模型联邦控制面（独立进程）：注册、schedule、`creditUSD`、双边 `ledger/report` 对账。

设计见 [docs/DESIGN-model-federation.md](../docs/DESIGN-model-federation.md)。

## 快速启动

```bash
cd 9router-hub
cp .env.example .env
npm install
npm start
```

默认 `http://127.0.0.1:30200`。启动日志会打印 **Database:** 的绝对路径（数据目录随 **当前工作目录** 变化，请务必在 `9router-hub/` 下执行 `npm start`）。

### 清空数据（必读）

SQLite 使用 WAL 模式。**必须先停掉 Hub 进程，再删库**；否则旧进程仍占用 `:30200`，内存/WAL 里仍是旧数据，磁盘上的新 `hub.db` 反而是空的，运营台仍显示旧用户数。

```bash
# 1. 停掉所有 Hub（任选一种）
lsof -ti:30200 | xargs kill
# 或 Ctrl+C 停掉你启动 hub 的那个终端

# 2. 删除数据库三件套（在 9router-hub 目录下）
rm -f data/hub.db data/hub.db-wal data/hub.db-shm

# 3. 重新启动
npm start
```

开发阶段大盘里的 7 个用户、`glm-4` 成交，来自此前 `curl` 联调测试，**不是** 9router `federate join` 产生的。

## 运营台 UI

浏览器打开 **`http://127.0.0.1:30200/`**：

- **大盘**：注册用户数、确认成交、总 Token、借入/借出 creditUSD、模型 Top 10
- **可借模型**：按逻辑模型聚合出借方数量、可调度供给、各借出方 TTFT（启动/接入/恢复探测 + 实盘采样）
- **用户**：每人可借模型、按模型的借入/借出 Token 与 creditUSD

默认每 **8s** 刷新（`UI_REFRESH_MS`）。未设置 `HUB_ADMIN_TOKEN` 时仅本机可访问；生产请设置 token 后使用 `?token=...` 或页头输入框。

```bash
# 生产示例
HUB_ADMIN_TOKEN=secret npm start
# 访问 http://host:30200/?token=secret
```

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/auth/register` | 注册 + welcome |
| POST | `/v1/auth/token` | 登录 |
| POST | `/v1/devices/register` | 绑定 deviceId |
| POST | `/v1/devices/heartbeat` | 心跳 |
| POST | `/v1/federation/schedule` | 借入调度 |
| POST | `/v1/ledger/report` | 借出/借入上报（`reporterRole`） |
| GET | `/v1/me/summary` | 余额与账本摘要 |

鉴权：`Authorization: Bearer <hubAccessToken>`；账本上报额外建议 `X-Device-Id: <16位hex>`。

## 与 9Router 边缘

边缘通过 `src/lib/federation/*` 对接；模型前缀 `federation:<logicalModel>` 走借入直连。Hub 与边缘需共用 `FEDERATION_JWT_SECRET`（边缘验 lend 侧 token）。

```bash
# 边缘
export FEDERATION_JWT_SECRET=change-me-federation-token
export HUB_URL=http://127.0.0.1:30200
9router federate join --hub $HUB_URL --email you@example.com
```
