> 感谢 Zmodel（AIHubKit）对本项目的大力支持。当前版本的 AI API 调用均基于 Zmodel（AIHubKit）提供的服务，重点接入高性价比的图片与视频生成渠道。**超值低价，限时抢购。**

# 山竹漫剧（Mangosteen Studio）

<p align="center">
  <img src="./packages/assets/mangosteenAvatar.png" alt="山竹漫剧" width="112" height="112" />
</p>

山竹漫剧是一款面向短剧、漫剧创作者的本地优先 AI 工作台。它把剧本、创作素材、图片生成和视频生成集中到同一张无限画布中，让创意整理、内容生成和素材管理保持在一个完整的工作流里。

## 核心能力

- **无限画布创作**：自由组织剧本、分镜、图片、视频和其他素材。
- **AI 图片生成**：支持文生图、参考图编辑及生成任务查询。
- **AI 视频生成**：支持视频生成、任务进度查看和结果管理。
- **账号服务同步**：登录后动态获取可用模型、渠道分组、价格、余额和使用记录。
- **本地项目管理**：项目文件与创作素材保存在用户选择的本地目录中。

## API 服务

当前版本的 AI API 调用均基于 **Zmodel（AIHubKit）** 提供的服务，主要面向图片与视频生成场景，提供高性价比的模型调用渠道。

模型、渠道和价格信息会根据登录账号动态同步，不在客户端写死。实际可用模型与费用以账号中显示的信息为准，请在提交生成任务前确认预计消耗。

## 下载安装

当前稳定版为 **v0.1.1**，支持 Windows x64 和 Apple Silicon（M1/M2/M3/M4）Mac。

1. 前往 [GitHub Releases](https://github.com/CCCq-C/mangosteen-studio/releases/latest)。
2. Windows x64 下载 `MangosteenStudio-Windows-x64-v0.1.1-Setup.exe` 并运行安装；macOS 下载 DMG 并将“山竹漫剧”拖入“应用程序”文件夹。
3. 启动应用并登录，即可查看当前账号可用的模型与渠道。

当前测试版的 Windows 安装器尚未进行代码签名，Windows Defender SmartScreen 可能显示“Windows 已保护你的电脑”；确认文件来自本仓库 Release 后，可选择“更多信息 → 仍要运行”。macOS 版本尚未经过 Apple 公证，如果首次阻止打开，请前往“系统设置 → 隐私与安全性”，选择“仍要打开”。

v0.1.1 采用 GitHub Release 手动下载安装。客户端自动更新将在 Windows 代码签名以及 Apple Developer ID 签名与公证完成后开放。`main` 分支可能包含尚未打包发布的开发版本。

## 本地开发

需要安装 [Bun](https://bun.sh/) 1.3.14 或兼容版本。

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

## 数据与安全

- 仓库不包含用户密码、会话令牌或模型 API Key。
- 桌面端登录凭据通过系统安全存储保存。
- 请勿在 Issue、日志或代码提交中上传个人令牌、账户信息和私有素材。

## 开源说明

本项目基于 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) `v2.0.6` 对应提交 [`c6756b9`](https://github.com/HBAI-Ltd/Toonflow-app/commit/c6756b9c23e87aff1ecafad6ebf8dfbe015a74a2) 开发，并保留原项目的 MIT 版权声明。

山竹漫剧是独立维护的衍生项目，并非 HBAI-Ltd 官方发行版。仓库保留 `upstream` 远程地址，便于人工评估上游更新，不会自动覆盖本项目的定制功能。

## 许可证

项目代码按 [MIT License](./LICENSE) 发布。MIT 允许使用、修改、发布、分发和商业使用，但必须保留原版权与许可声明。第三方依赖、素材以及外部模型/API 服务仍分别受各自许可证、版权和服务条款约束。
