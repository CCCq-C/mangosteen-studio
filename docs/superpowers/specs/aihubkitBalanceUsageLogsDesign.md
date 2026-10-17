# 山竹漫剧 AIHubKit 余额与使用日志设计

- 状态：已实施并验收
- 确认日期：2026-10-18
- 采用方案：A（画布直接显示当前账户余额；设置中提供当前账户使用日志）
- 上游文档：`https://86bdknokqu.apifox.cn/9446929m0`

## 1. 目标与边界

本批把画布右上角原有的供应商 API Key/充值入口替换为当前山竹登录账户的余额，并在设置中增加“使用日志”面板。余额和日志都由 Server 使用已经保存在系统钥匙串中的登录会话请求 AIHubKit，Web 不接触 Access Token、Cookie、分组 Key 或用户填写的 API Key。

本批不实现充值、导出日志、跨用户汇总、日志搜索、账单统计或客户端运行错误日志。原有第三方供应商高级配置保留；只移除画布右上角面向用户的 TF-Router 余额与 API Key 入口。

## 2. 已确认的上游契约

1. 余额使用 `GET /api/user/self`，请求头为 `Authorization: Bearer <accessToken>` 与 `New-Api-User: <userId>`；展示额度为返回 `data.quota / 500000`。
2. 使用日志使用 `GET /api/log/self`，支持 `p`、`page_size`、`start_timestamp`、`end_timestamp`；单条实际费用为 `data.items[i].quota / 500000`。
3. 日志包含创建时间、类型、模型、分组、输入/输出 Token、耗时、请求编号等字段。界面不返回或展示 `user_id`、`username`、`token_id`、`channel`、`ip` 和原始 `other`。

## 3. 模块边界

```text
AIHubKit account（会话与凭据唯一所有者）
  └── usage（余额、使用日志读取与响应规范化）
      ├── POST /api/desktop/account/balance
      └── POST /api/desktop/account/logs

Web aihubkitUsage（账户用量读取模型）
  ├── 画布右上角：余额、刷新状态、错误提示
  └── 设置 → 使用日志：分页日志表、刷新状态、错误提示
```

`pricingHistory` 可以继续独立读取同一个上游日志接口以维护价格样本；它不依赖使用日志面板，也不向界面泄漏持久化样本。后续若统一网络请求，可在不改变公开接口的情况下复用 `usage` 的内部解析函数，本批不为此做额外重构。

## 4. Server 公开数据

```ts
interface AihubkitBalance {
  amount: number;
  unit: "额度";
  updatedAt: number;
}

interface AihubkitUsageLog {
  id: number;
  createdAt: number;
  type: number;
  modelName: string;
  groupName: string;
  promptTokens: number;
  completionTokens: number;
  useTime: number;
  amount: number;
  requestId: string;
  detailMessage: string;
  errorCode: string;
  errorType: string;
  statusCode?: number;
}

interface AihubkitUsageLogPage {
  page: number;
  pageSize: number;
  total: number;
  items: AihubkitUsageLog[];
}
```

所有数字必须是有限非负数；页码与数量必须是安全整数；字符串裁剪长度。格式不正确时返回可读错误，不把上游原始响应透传给 Web。

## 5. 界面行为

### 5.1 画布余额

- 显示为“余额 2.877866 额度”，最多六位小数。
- 进入画布自动读取一次；点击余额手动刷新。
- 加载中沿用按钮 loading；请求失败时保留最近一次成功值并在悬浮提示中显示错误。
- 不再弹出 API Key、余额充值或 TF-Router 供应商面板。

### 5.2 设置使用日志

- 设置侧栏新增“账户”分组，包含“使用日志”。
- 表格列为：时间、模型、分组、状态、用量、耗时、实际扣费，并支持点击任意一行或“详情”。
- 错误记录在详情抽屉中展示上游 `content`、`status_code`、`error_code` 与 `error_type`；成功记录展示本次用量和请求编号。
- 文本请求的用量显示输入与输出 Token；媒体请求没有 Token 时显示“—”。
- 实际扣费按 `quota / 500000` 显示，最多六位小数，单位为“额度”。
- 每页 20 条，使用上游总数和分页；打开面板加载，用户可手动刷新。
- 首次无记录显示 Element Plus 标准空状态；错误显示可重试提示，不伪造数据。

## 6. 安全与降级

- 所有请求仅从 Server 端读取当前登录会话，浏览器无法指定其他用户 ID。
- Server 响应设置 `Cache-Control: no-store`。
- 退出登录后不在 Web 持久化余额或日志；组件卸载即释放日志列表。
- 上游余额或日志故障不影响模型目录、画布编辑与生成链路。

## 7. 验收

1. 画布右上角只显示当前山竹账户余额，不出现 TF-Router、API Key 或充值入口。
2. 当前真实账户余额与 `/api/user/self` 的 `quota / 500000` 一致。
3. 设置中可以打开“使用日志”，分页数据来自 `/api/log/self`。
4. 任一日志的实际扣费与上游 `quota / 500000` 一致，模型和分组字段一致。
5. 错误日志可以打开详情，并与上游错误正文、状态码、错误代码和错误类型一致。
6. Web 响应和界面不出现 Access Token、Cookie、分组 Key、用户 IP、Token ID、渠道信息或原始 `other`。
7. Server/Web typecheck、全量 build、macOS 安装包构建与已安装客户端界面检查通过。
