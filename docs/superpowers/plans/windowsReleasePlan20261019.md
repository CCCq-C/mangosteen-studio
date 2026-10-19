# 山竹漫剧 Windows 版本实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 逐项实施；每项完成后检查差异和验证结果再继续。

**目标：** 修复现有 Windows x64 安装、协议、更新和公开发布链路，在纯净 Windows 11 虚拟机验收真实安装包后，将 Windows 产物补充到 GitHub `v0.1.1` Release。

**架构：** 保留现有 Electrobun、Bun、NSIS、WebView2 和 C# 原生辅助程序。只统一已经分叉的应用标识与协议，并让现有构建/发布脚本输出山竹漫剧命名的 Windows 安装包；验证以真实构建产物和一次性 Hyper-V 虚拟机为准。

**技术栈：** TypeScript、Bun 1.3.14、Electrobun 2.0.1、C#/.NET Framework、NSIS、GitHub Actions、Hyper-V Windows 11 x64。

**设计：** `docs/superpowers/specs/windowsReleaseDesign20261019.md`

## 全局约束

- 新文件和目录使用小驼峰命名；不新增短横线文件名。
- 不新增测试模块、自检脚本、测试框架、测试依赖或 CI 测试入口。
- 使用现有 `@toonflow/file`、Electrobun 和 NSIS 链路，不新增桌面框架或依赖。
- 只支持 Windows x64；不增加 Windows ARM64、Store 包或旧系统适配。
- 应用标识固定为 `com.mangosteen.studio`，URL scheme 固定为 `mangosteen-studio`。
- 公开安装包固定为 `MangosteenStudio-Windows-x64-v<version>-Setup.exe`。
- 不移动或重写已经公开的 `v0.1.1` 标签；Release 正文记录 Windows 构建提交。
- 不执行会产生第三方模型费用的生成请求。
- 保留工作区中已有且非本任务产生的 README 营销文案；只有用户确认后才把这些 README 改动与 Windows 下载说明一起纳入 PR。

## 重点复核

- 全新安装时没有旧注册表兜底：协议必须直接注册为 `mangosteen-studio://`，由任务 1 的虚拟机步骤验证。
- 更新清单标识为 `com.mangosteen.studio`：TypeScript 与 C# 两层都必须接受，由任务 2 的产物检查和任务 5 的更新检查验证。
- 安装器未签名：SmartScreen 提示不能误报为安装失败，由任务 5 记录实际行为。
- Windows 文件名大小写和品牌名称：构建脚本、快照脚本、Release 工作流必须一致，由任务 3 的引用扫描和任务 4 的产物清单验证。
- 虚拟机验证必须使用最终 GitHub Actions 产物，不使用本地临时替代文件，由任务 5 的 SHA256 对照验证。

---

### 任务 1：统一 Windows URL 协议

**文件：**

- 修改：`apps/desktop/installer/installer.nsi:208-212,276-279`
- 修改：`apps/desktop/native/protocolLauncher.cs:18-24`

**接口：**

- 输入：`mangosteen-studio://install?type=<type>&url=<encodedUrl>`
- 产出：安装器注册 `HKCU\Software\Classes\mangosteen-studio`，启动器只接受 `mangosteen-studio` scheme 与 `install` host。

- [ ] **步骤 1：修改 NSIS 协议注册和卸载清理**

  将注册表键、安装步骤文案和卸载检查中的 `toonflow` scheme 改为 `mangosteen-studio`；保留内部 `toonflow.ini` 和兼容环境变量，不做无关重命名。

- [ ] **步骤 2：修改 Windows 协议启动器校验**

  将 `protocolLauncher.cs` 的 scheme 与错误消息改为 `mangosteen-studio`；host 继续要求 `install`，URL 长度和参数校验保持不变。

- [ ] **步骤 3：编译 C# 启动器**

  运行：

  ```powershell
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /out:"$env:TEMP\mangosteenProtocolLauncher.exe" apps/desktop/native/protocolLauncher.cs
  ```

  预期：退出码为 0，生成临时 EXE；后续任务 5 用实际安装器验证注册表和唤起行为。

- [ ] **步骤 4：检查差异并提交**

  ```powershell
  git diff --check
  git add apps/desktop/installer/installer.nsi apps/desktop/native/protocolLauncher.cs
  git commit -m "fix: register Mangosteen Windows protocol"
  ```

### 任务 2：统一 Windows 更新标识

**文件：**

- 修改：`apps/desktop/src/update/windowsUpdater.ts:96-104`
- 修改：`apps/desktop/native/updateHelper.cs:58-64`

**接口：**

- 输入：Electrobun `version.json` 和 `stable-win-x64-update.json`。
- 产出：TypeScript 更新器与 C# 更新辅助程序都只接受 `com.mangosteen.studio`。

- [ ] **步骤 1：修改 TypeScript 更新器标识**

  将本地版本信息校验中的旧标识改为 `com.mangosteen.studio`，保留通道、版本、Hash、平台和架构校验。

- [ ] **步骤 2：修改 C# 更新辅助程序标识**

  将更新计划校验中的旧标识改为 `com.mangosteen.studio`，不改变目录保护、签名哈希、进程退出和回滚逻辑。

- [ ] **步骤 3：编译 C# 更新辅助程序**

  运行：

  ```powershell
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:Microsoft.CSharp.dll /out:"$env:TEMP\mangosteenUpdateHelper.exe" apps/desktop/native/updateHelper.cs
  ```

  预期：退出码为 0，生成临时 EXE；TypeScript 在任务 4 运行全仓 typecheck。

- [ ] **步骤 4：检查差异并提交**

  ```powershell
  git diff --check
  git add apps/desktop/src/update/windowsUpdater.ts apps/desktop/native/updateHelper.cs
  git commit -m "fix: accept Mangosteen Windows updates"
  ```

### 任务 3：统一 Windows 发布命名和下载说明

**文件：**

- 修改：`apps/desktop/scripts/packageWindows.ts:16`
- 修改：`apps/desktop/scripts/release.ts:90-98`
- 修改：`.github/workflows/release.yml:76-132,166-188`
- 修改：`README.md:11-27`

**接口：**

- 产出：公开安装包名为 `MangosteenStudio-Windows-x64-v0.1.1-Setup.exe`。
- 消费方：本地发布快照、GitHub Release 下载说明和更新托管文件归属检查。

- [ ] **步骤 1：修改本地 Windows 安装包和快照名称**

  `packageWindows.ts` 与 `release.ts` 使用同一个固定格式：`MangosteenStudio-Windows-x64-v${version}-Setup.exe`。

- [ ] **步骤 2：修改 GitHub Release 工作流**

  更新 Windows 安装器匹配规则、更新托管归属检查和公开 Release 名称。保留内部 workspace、artifact 名称和 macOS/Android 兼容文件名，避免扩大范围。

- [ ] **步骤 3：更新 README 下载与安装说明**

  以工作区现有 README 营销文案为基线，原样保留 Zmodel、核心能力、数据安全和开源说明；只把平台能力改为 Windows x64 与 Apple Silicon macOS，并在下载段增加 Windows 安装器和 SmartScreen 说明，继续声明 `v0.1.1` 使用手动下载。用户确认前不提交现有 README 改动。

- [ ] **步骤 4：扫描旧的公开 Windows 文件名引用**

  运行：

  ```powershell
  rg -n 'toonflow-\$\{?version\}?-Setup\.exe|toonflow-[0-9.]+-Setup\.exe|name: Toonflow' apps/desktop/scripts .github/workflows README.md
  ```

  预期：没有旧 Windows 公开安装包名称或旧 Release 标题；允许内部 `@toonflow/*` 包名和兼容文件继续存在。

- [ ] **步骤 5：检查差异并提交**

  ```powershell
  git diff --check
  git add apps/desktop/scripts/packageWindows.ts apps/desktop/scripts/release.ts .github/workflows/release.yml README.md
  git commit -m "chore: brand Windows release artifacts"
  ```

### 任务 4：安装锁定工具并构建真实 Windows 产物

**文件：**

- 读取：`package.json`、`bun.lock`、`electrobun.config.ts`
- 生成但不提交：`node_modules/`、`.hutch/`、`build/desktop/releases/0.1.1/`

**接口：**

- 输入：任务 1 至 3 的源代码和锁定依赖。
- 产出：Windows 安装器、完整更新包和 `stable-win-x64-update.json`。

- [ ] **步骤 1：用临时 Bun 1.3.14 运行环境安装依赖**

  运行：

  ```powershell
  npx --yes bun@1.3.14 --version
  npx --yes bun@1.3.14 install --frozen-lockfile
  npx --yes bun@1.3.14 apps/desktop/node_modules/electrobun/bin/electrobun.cjs prepare
  ```

  预期：版本输出 `1.3.14`；安装和 SDK 准备退出码为 0。

- [ ] **步骤 2：运行全仓类型检查**

  运行：`npx --yes bun@1.3.14 run typecheck`

  预期：退出码为 0；如有基线失败，记录具体 workspace 和错误，先判断是否由本次修改引入。

- [ ] **步骤 3：构建首次 Windows 0.1.1 发布快照**

  运行：

  ```powershell
  $env:NSIS_PATH='C:\Program Files (x86)\NSIS\makensis.exe'
  npx --yes bun@1.3.14 run release:desktop 0.1.1 --initial
  ```

  预期：`build/desktop/releases/0.1.1/` 包含且只包含安装器、完整 `.tar.zst` 更新包和更新清单。

- [ ] **步骤 4：审计实际产物**

  检查：

  - 安装器名精确为 `MangosteenStudio-Windows-x64-v0.1.1-Setup.exe`。
  - 清单的 `identifier`、`channel`、`version`、`platform`、`arch` 分别为 `com.mangosteen.studio`、`stable`、`0.1.1`、`win`、`x64`。
  - 清单引用的 `.tar.zst` 文件存在且非空。
  - 解压后的 `Resources/version.json` 与清单一致，`bin/launcher.exe`、协议启动器、保存对话框和更新辅助程序存在。
  - `Get-AuthenticodeSignature` 明确记录 `NotSigned`，不伪报为已签名。

- [ ] **步骤 5：确认源码树没有构建产物污染**

  运行：`git status --short`

  预期：只有计划内源文件提交；`node_modules/`、`.hutch/` 和 `build/` 不进入 Git。

### 任务 5：构建 GitHub Actions 产物并在纯净 Win11 验收

**文件：**

- GitHub Actions 产物：`toonflow-0.1.1-windowsX64`
- 本地验证包：`build/qa/windows011/`
- 虚拟机：一次性 Windows 11 x64 差分盘虚拟机。

**接口：**

- 输入：已推送的 `codex/windows-v0.1.1` 分支。
- 产出：与最终发布完全相同的 GitHub Actions Windows 文件和虚拟机验收记录。

- [ ] **步骤 1：推送分支并创建 Draft Pull Request**

  推送当前分支，创建指向 `main` 的 Draft PR；PR 描述列出三个修复点、未签名状态和验证计划。创建成功后把 PR 附加到当前任务。

- [ ] **步骤 2：触发 Windows-only GitHub Actions 构建**

  运行：

  ```powershell
  gh workflow run debug.yml --repo CCCq-C/mangosteen-studio --ref codex/windows-v0.1.1 -f target=windowsX64 -f ref=codex/windows-v0.1.1 -f version=0.1.1 -f generatePatch=false
  ```

  等待运行完成；要求 Windows job 成功，再下载 `toonflow-0.1.1-windowsX64` artifact。

- [ ] **步骤 3：建立虚拟机传输包**

  将 Action artifact 中唯一的 `*Setup.exe` 复制到 `build/qa/windows011/`，生成根目录 `SHA256SUMS`。保存安装器 SHA256，并确认与任务 4 的本地产物差异不会被误当作功能差异。

- [ ] **步骤 4：先检查一次性虚拟机计划**

  运行：

  ```powershell
  pwsh -NoProfile -File C:\Users\c1773\.codex\skills\launch-clean-windows-test-vm\scripts\Start-CleanWindowsTestVm.ps1 -OsVersion Win11 -PackageRoot 'C:\Users\c1773\Documents\Admin\mangosteen-studio\build\qa\windows011' -PlanOnly
  ```

  预期：`launchMode` 为 `differencing`，`baseVhdPath` 存在，且目标 VM/磁盘位于脚本配置的 disposable root。若基础盘缺失，只按技能流程从保留 ISO 准备一次，不修改 ISO。

- [ ] **步骤 5：启动虚拟机并完成五项验收**

  启动同一命令但移除 `-PlanOnly`。在虚拟机中逐项确认：

  1. 交互安装完成；记录 SmartScreen 与 WebView2 行为。
  2. 首次启动无黑框，窗口和本地服务正常。
  3. 新建工作目录，创建/保存画布，退出重开后内容仍在。
  4. 打开 `mangosteen-studio://install?...` 时系统能唤起山竹漫剧并进入安装确认链路。
  5. 更新检查不再报告应用标识不一致；卸载入口可正常打开。

  发现问题时保留日志和虚拟机，回到对应任务修复；不跳过阻断安装、启动、数据保存或协议唤起的问题。

- [ ] **步骤 6：记录精确验收结果**

  记录 VM 名称、Windows 版本、安装器 SHA256、安装路径、每项结果、警告和未执行的付费功能。关闭虚拟机后确认 disposable VM 自动清理，基础 VHDX 保持只读且未修改。

### 任务 6：合并并发布 Windows v0.1.1

**文件：**

- GitHub PR：任务 5 创建的 Draft PR。
- GitHub Release：`v0.1.1`。
- 发布资产：安装器、完整更新包、更新清单。

**接口：**

- 输入：任务 5 已通过虚拟机验收的 GitHub Actions artifact。
- 产出：GitHub `v0.1.1` Release 中可下载且哈希可核对的 Windows 版本。

- [ ] **步骤 1：完成分支复核**

  运行：

  ```powershell
  git status --short
  git log --oneline origin/main..HEAD
  git diff --check origin/main...HEAD
  ```

  重读设计和计划，确认所有范围内要求都有证据，未提交构建产物或凭据。

- [ ] **步骤 2：将 PR 标记为 Ready 并合并**

  只有任务 4 和任务 5 全部通过时才合并；使用保留分支提交历史的合并方式，使 Windows 构建提交仍可追踪。

- [ ] **步骤 3：补充现有 v0.1.1 Release**

  上传任务 5 验收过的三个 Windows 文件，不删除或替换现有 macOS DMG。Release 正文增加 Windows x64 下载链接、Windows 构建提交、安装器 SHA256、未签名说明和本次虚拟机验收摘要。

- [ ] **步骤 4：从 GitHub 重新下载并核对**

  从公开 Release 重新下载 Windows 安装器，运行 `Get-FileHash -Algorithm SHA256`，要求与任务 5 记录完全一致；再读取 Release 资产列表，确认文件大小非零且三个 Windows 文件均存在。

- [ ] **步骤 5：最终报告**

  报告 PR、合并提交、Release 链接、安装器文件名/SHA256、虚拟机五项结果、SmartScreen 状态和未执行的付费生成测试。若任何核心项失败，不发布并明确指出失败位置、原因和下一修复动作。
