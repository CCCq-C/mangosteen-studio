# 山竹官方社区目录

`catalog.json` 是山竹漫剧客户端读取的官方 Skill、模板与工作流目录。提交内容前，请先上传文件，再把条目加入 `items`。

每个条目包含：

- `id`：长期稳定且不重复的小写短横线 ID；Skill 条目应与 `SKILL.md` 的 `name` 一致，以便客户端识别安装状态。
- `type`：`skill`、`template` 或 `workflow`。
- `name`、`description`、`version`、`author`：用户看到的名称、说明、版本和作者。
- `fileName`：下载文件名；Skill 支持 `.md`、`.zip`、`.tar`、`.tar.gz`、`.tgz`，模板与工作流使用 `.json`。
- `urls`：同一文件的 `gitee` 与 `github` 原始下载地址。
- `sha256`：下载文件的 SHA-256；`minAppVersion`：最低客户端版本；`tags`：可选标签数组。

生成校验值：

```bash
shasum -a 256 <file>
```

发布前确认两个下载地址内容一致、校验值正确，并更新根目录的 `updatedAt`。客户端先读 Gitee，再回退 GitHub；在线源都不可用时才使用本地最近一次成功目录。
