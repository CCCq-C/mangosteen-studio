# 山竹漫剧（Mangosteen Studio）

<p align="center">
  <img src="./packages/assets/mangosteenAvatar.png" alt="山竹漫剧" width="112" height="112" />
</p>

山竹漫剧是一款面向短剧、漫剧创作的本地优先 AI 工作台。它把剧本、素材、图片生成和视频生成组织在同一张无限画布中，并通过用户登录后的账号权限动态同步可用模型、渠道分组与价格信息。

> 当前处于早期开发阶段，功能和数据结构仍可能调整。调用图片、视频或语言模型可能产生第三方服务费用，请在提交任务前确认预计消耗。

## 当前能力

- macOS 桌面客户端，支持注册、登录、自动恢复会话、余额、兑换码和使用日志。
- 无限画布与本地工作目录，项目文件和创作素材由用户自行保管。
- 图片、视频及语言模型目录按账号动态同步，不在客户端写死渠道列表。
- 图片生成、参考图编辑、视频生成及任务状态查询。
- 开发者可添加通用文本供应商或自定义媒体适配器。

## 下载

已发布的 macOS 安装包位于 [GitHub Releases](https://github.com/CCCq-C/mangosteen-studio/releases)。`main` 分支可能包含尚未打包发布的开发版本。

## 本地开发

需要 [Bun](https://bun.sh/) 1.3.14 或兼容版本。

```bash
git clone https://github.com/CCCq-C/mangosteen-studio.git
cd mangosteen-studio
bun install
bun run dev
```

常用命令：

```bash
bun run typecheck
bun run build
bun run package:desktop
```

仓库不包含用户密码、会话令牌或模型 API Key。桌面端登录凭据通过系统安全存储保存；请勿在 Issue、日志或提交中上传个人令牌和私有素材。

## 与 Toonflow 的关系

本项目基于 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) `v2.0.6` 对应提交 [`c6756b9`](https://github.com/HBAI-Ltd/Toonflow-app/commit/c6756b9c23e87aff1ecafad6ebf8dfbe015a74a2) 开发，并保留原项目的 MIT 版权声明。

山竹漫剧是独立维护的衍生项目，不是 HBAI-Ltd 官方发行版。仓库保留 `upstream` 远程地址，以便人工评估上游更新；不会自动覆盖本项目的定制功能。

## 许可证

代码按 [MIT License](./LICENSE) 发布。MIT 允许使用、修改、发布、分发和商业使用，但必须保留原版权与许可声明。第三方依赖、素材以及外部模型/API 服务仍分别受各自许可证、版权与服务条款约束。
