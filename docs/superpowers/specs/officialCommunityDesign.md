# 官方精选社区设计

## 目标

在客户端插件市场中增加“官方社区”，让用户每次启动后自动从 Gitee/GitHub 获取由山竹维护的 Skill、模板与工作流目录，并复用现有安装能力完成一键安装或导入。首版不开放用户投稿、评论、登录、收藏或排行榜。

## 内容源

官方目录固定为：

1. `https://gitee.com/Chance-Ccc/mangosteen-studio/raw/main/community/catalog.json`
2. `https://raw.githubusercontent.com/CCCq-C/mangosteen-studio/main/community/catalog.json`
3. 本地最近一次成功目录

每次客户端进程首次打开社区时先尝试 Gitee，失败后尝试 GitHub，两者都失败才使用本地缓存。响应明确返回实际来源和是否为缓存，客户端不伪装在线状态。

## 目录契约

`community/catalog.json` 使用版本化结构：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-20T00:00:00.000Z",
  "items": []
}
```

条目类型为 `skill`、`template` 或 `workflow`，包含稳定 ID、显示名、说明、版本、作者、文件名、Gitee/GitHub 下载地址、SHA-256、最低客户端版本和可选标签。目录与下载文件均限制大小并严格校验字段。

## 安装与导入

- Skill：服务端按条目 ID 读取当前官方目录，下载 Gitee 地址，失败后下载 GitHub 地址；SHA-256 一致后复用现有 `installSkill`。
- 模板、工作流：官方文件是单个山竹画布 JSON；校验 `toonflowCanvas`、节点、连线和视口后，以不覆盖方式写入当前项目。重名时使用 `名称 2.json`、`名称 3.json`。
- 没有打开项目时，模板和工作流按钮显示“请先打开项目”，Skill 仍可安装。
- 目录中的 URL 不能由前端替换；安装接口只接收官方条目 ID，避免把官方入口变成任意下载代理。

## 客户端界面

插件市场顶部显示“官方社区 / 已安装 / FFmpeg”。官方社区内部只显示“全部 / Skill / 模板 / 工作流”和搜索框，不再要求 TF-Router API Key，也不显示原 Toonflow 收藏与发布功能。

每张卡片显示名称、类型、作者、版本、说明、标签和兼容状态。Skill 使用“安装/更新/已安装”，模板与工作流使用“导入当前项目”。

## 缓存与安全

- 目录缓存写入应用数据目录，使用原子覆盖；格式或网络失败不能覆盖上次成功缓存。
- 目录最大 2 MB；内容包最大 20 MB；画布最大 5 MB。
- 所有内容必须通过 SHA-256；不匹配时停止安装并显示中文错误。
- `minAppVersion` 高于当前客户端时禁止安装，并提示需要的版本。

## 验收标准

1. 不填写任何第三方 API Key 即可打开官方社区。
2. Gitee 不可用时自动回退 GitHub，两者不可用时显示最近缓存来源。
3. Skill 复用现有安全安装器；模板和工作流只导入当前项目且不覆盖现有文件。
4. 空目录显示真实空状态，不添加虚构模板。
5. 全仓类型检查、Web/Server 构建通过；不新增测试模块。
