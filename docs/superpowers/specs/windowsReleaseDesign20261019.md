# 山竹漫剧 Windows 版本设计

## 目标

在不更换现有 Electrobun 桌面框架的前提下，修复 Windows 平台的应用标识、协议注册和公开发布命名，生成可安装的 Windows x64 安装包，在纯净 Windows 11 虚拟机完成安装与核心功能验收后，把 Windows 安装包及更新文件补充到 GitHub `v0.1.1` Release。

## 当前状态

- 仓库已有完整的 Windows x64 构建链：Electrobun 应用、NSIS 安装器、WebView2 检测、C# 原生启动辅助程序、Windows 更新器和 GitHub Actions 构建矩阵。
- 2026-10-16 的 GitHub Actions 已成功生成 Windows `0.1.0` 安装包，说明基础构建模板可复用。
- 现有 `v0.1.1` Release 仅包含 macOS Apple Silicon DMG，没有 Windows 安装包或 Windows 更新文件。
- 旧 Windows 安装包没有 Authenticode 数字签名。纯净系统可能显示 SmartScreen 提示，但这不等同于安装失败。

## 已确认的问题

### 协议标识不一致

当前应用配置和 TypeScript 解析器使用 `mangosteen-studio://`，但 NSIS 安装器与 Windows `protocolLauncher.exe` 仍注册和接受 `toonflow://`。干净安装后，网页或外部应用无法用当前协议唤起山竹漫剧。

统一规则：

- URL scheme：`mangosteen-studio`
- 安装链接：`mangosteen-studio://install?type=<type>&url=<encodedUrl>`
- 注册表路径：`HKCU\Software\Classes\mangosteen-studio`

### 更新标识不一致

Electrobun 生成的 Windows 更新清单使用 `com.mangosteen.studio`，但 TypeScript 更新器和 C# 更新辅助程序仍要求 `local.toonflow.desktop`。这会使合法的山竹漫剧更新包在下载或应用阶段被拒绝。

统一规则：应用标识只使用 `com.mangosteen.studio`。

### Windows 发布命名残留旧品牌

公开安装包仍命名为 `toonflow-<version>-Setup.exe`。本次只修改用户可见的 Windows 安装包名称，不批量重命名内部工作区包、环境变量或 Electrobun 兼容文件。

公开安装包名称：`MangosteenStudio-Windows-x64-v<version>-Setup.exe`。

## 实现范围

修改以下现有链路，不引入新框架或依赖：

- `apps/desktop/installer/installer.nsi`：注册和卸载 `mangosteen-studio://`。
- `apps/desktop/native/protocolLauncher.cs`：只接受 `mangosteen-studio://install`。
- `apps/desktop/src/update/windowsUpdater.ts`：校验 `com.mangosteen.studio`。
- `apps/desktop/native/updateHelper.cs`：校验 `com.mangosteen.studio`。
- `apps/desktop/scripts/packageWindows.ts`、`apps/desktop/scripts/release.ts`、`.github/workflows/release.yml`：统一 Windows 公开文件名和 Release 展示名。
- `README.md`：增加 Windows x64 下载与安装说明。

如果构建或虚拟机验证发现新的 Windows 阻断问题，只修复能复现且直接阻断本次交付的问题；不顺带重构无关模块。

## 构建与检查

仓库规范禁止新增测试模块，因此不添加 `.test.ts`、`.spec.ts`、自检脚本、测试框架或测试依赖。验证使用现有检查入口和真实产物：

1. 安装锁定依赖并准备 Electrobun SDK。
2. 运行全仓 `bun run typecheck`。
3. 使用 Windows x64 环境执行桌面发布构建和 NSIS 打包。
4. 检查安装包 SHA256、Authenticode 状态、更新清单版本/平台/架构/标识，以及压缩包内 `Resources/version.json`。
5. 确认最终发布目录只有当前版本的 Windows 安装器和其所需更新文件。

## 纯净虚拟机验收

使用一次性 Windows 11 x64 Hyper-V 虚拟机；基于只读纯净基础盘创建差分盘，不改动现有持久测试机。安装包复制到来宾桌面后验证：

1. 交互安装完成，WebView2 检测可通过或按安装器提示完成修复；记录 SmartScreen 实际表现。
2. 首次启动无控制台黑框，主窗口和本地服务正常，任务管理器中没有异常重复进程。
3. 新建本地工作目录，创建并保存画布，退出后重新打开并恢复项目。
4. 用 `mangosteen-studio://install` 唤起已安装应用，确认协议进入应用而不是报“找不到应用”。
5. 更新检查不会因应用标识错误失败；卸载程序能运行，用户数据选项按界面选择执行。

账号登录、模型目录和余额接口验证到不产生费用的阶段。图片、视频及语言模型的真实生成会产生第三方费用，除非用户另行提供测试账号并明确授权扣费，否则不执行付费生成。

## 发布流程

1. 在 `codex/windows-v0.1.1` 分支完成修改和验证。
2. 验证通过后推送分支，创建并合并 GitHub Pull Request，使 Windows 修复进入 `main`。
3. 从合并提交构建版本号为 `0.1.1` 的 Windows 安装器、完整更新包和更新清单。
4. 不移动或重写已经公开的 `v0.1.1` 标签；在现有 Release 中补充 Windows 文件，并在 Release 正文注明 Windows 构建提交和 SHA256。
5. 发布后重新下载 GitHub 上的安装器，核对哈希及文件大小，确保上传内容与虚拟机验收版本一致。

`v0.1.1` 的 Windows 产物将来自标签之后的 Windows 修复提交。Release 正文必须明确记录该提交，避免把旧标签误当作 Windows 构建源码。后续跨平台版本应恢复为一个标签对应全部平台同一提交。

## 不在本次范围内

- 不迁移到 Electron、Tauri 或其他桌面框架。
- 不增加 Windows ARM64、Windows 7/8 或 Microsoft Store 包。
- 不购买、申请或部署 Windows 代码签名证书。
- 不执行产生模型费用的图片、视频或语言模型生成。
- 不修复与 Windows 交付无关的历史代码问题。

## 完成标准

- Windows 协议、更新标识和公开安装包名称与山竹漫剧一致。
- 全仓类型检查和 Windows 发布构建退出码为零。
- 真实安装包在纯净 Windows 11 x64 虚拟机完成上述五项验收。
- GitHub `v0.1.1` Release 包含经虚拟机验证的 Windows 安装器及更新文件。
- 从 GitHub 重新下载的安装器 SHA256 与发布前验收文件一致。
