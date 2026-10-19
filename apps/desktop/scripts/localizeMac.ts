import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "@toonflow/file";
import { basename, join } from "node:path";

if (process.env.ELECTROBUN_OS === "macos") {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  if (!buildDir) throw new Error("缺少 ELECTROBUN_BUILD_DIR，无法设置 macOS 应用语言。");

  const bundlePath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH ?? readdirSync(buildDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => join(buildDir, entry.name))
    .find((path) => existsSync(join(path, "Contents", "Info.plist")));
  if (!bundlePath) throw new Error(`未找到待本地化的 macOS 应用：${buildDir}`);

  const plistPath = join(bundlePath, "Contents", "Info.plist");
  let plist = readFileSync(plistPath, "utf8");
  // ACT: 两套 SDK 当前生成 XML；如果改为二进制 plist，应改用 macOS 的 plutil。
  if (!/<\/dict>\s*<\/plist>\s*$/.test(plist)) throw new Error(`不支持的 Info.plist 格式：${plistPath}`);
  for (const [key, value] of [
    ["CFBundleName", "<string>山竹漫剧</string>"],
    ["CFBundleDisplayName", "<string>山竹漫剧</string>"],
    ["CFBundleDevelopmentRegion", "<string>zh-Hans</string>"],
    ["CFBundleLocalizations", "<array><string>zh-Hans</string></array>"],
  ]) {
    const existing = new RegExp(`<key>${key}</key>\\s*<(string|array)>[\\s\\S]*?</\\1>`);
    if (existing.test(plist)) {
      plist = plist.replace(existing, `<key>${key}</key>${value}`);
    } else {
      plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `  <key>${key}</key>\n  ${value}\n</dict>\n</plist>`);
    }
  }
  writeFileSync(plistPath, plist);

  const resourceDir = join(bundlePath, "Contents", "Resources", "zh-Hans.lproj");
  mkdirSync(resourceDir, { recursive: true });
  writeFileSync(join(resourceDir, "InfoPlist.strings"),
    `CFBundleName = ${JSON.stringify("山竹漫剧")};\nCFBundleDisplayName = ${JSON.stringify("山竹漫剧")};\n`);

  // ACT: 本地测试包没有 Developer ID。清除构建目录元数据后补上临时签名，
  // 避免 macOS 把构建器遗留的不完整签名判断为“应用已损坏”。CI 仍使用正式签名。
  if (process.env.macCodesign !== "1") {
    // ACT: Electrobun 会在 postBuild 后改写 version.json，再于 postWrap 前生成更新归档。
    // postWrap 阶段签署归档里的完整应用，并同步替换启动外壳内的同一份归档。
    const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR;
    if (process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH && artifactDir && existsSync(artifactDir)) {
      const archives = readdirSync(artifactDir).filter((name) => name.endsWith(".app.tar.zst"));
      if (archives.length !== 1) throw new Error(`macOS 更新归档数量应为 1，实际为 ${archives.length}`);
      const archivePath = join(artifactDir, archives[0]!);
      const temporaryDirectory = join(artifactDir, `.signed-${process.pid}`);
      const temporaryArchive = join(artifactDir, `.signed-${process.pid}.tar.zst`);
      rmSync(temporaryDirectory, { recursive: true, force: true });
      rmSync(temporaryArchive, { force: true });
      mkdirSync(temporaryDirectory);
      try {
        await $`tar -xf ${archivePath} -C ${temporaryDirectory}`;
        const updateBundles = readdirSync(temporaryDirectory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
        if (updateBundles.length !== 1) throw new Error(`macOS 更新应用数量应为 1，实际为 ${updateBundles.length}`);
        const updateBundlePath = join(temporaryDirectory, updateBundles[0]!.name);
        await $`xattr -cr ${updateBundlePath}`;
        await $`codesign --force --deep --sign - ${updateBundlePath}`;
        await $`tar -caf ${temporaryArchive} ${basename(updateBundlePath)}`.cwd(temporaryDirectory);
        renameSync(temporaryArchive, archivePath);

        const wrapperResourceDir = join(bundlePath, "Contents", "Resources");
        const embeddedArchives = readdirSync(wrapperResourceDir).filter((name) => name.endsWith(".tar.zst"));
        if (embeddedArchives.length !== 1) throw new Error(`macOS 内嵌归档数量应为 1，实际为 ${embeddedArchives.length}`);
        copyFileSync(archivePath, join(wrapperResourceDir, embeddedArchives[0]!));
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
        rmSync(temporaryArchive, { force: true });
      }
      console.log(`已重签并重建 macOS 更新归档：${archivePath}`);
    }

    await $`xattr -cr ${bundlePath}`;
    await $`codesign --force --deep --sign - ${bundlePath}`;
    console.log(`已为本地 macOS 测试包添加临时签名：${bundlePath}`);
  }
  console.log(`已设置 macOS 简体中文本地化：${bundlePath}`);
}
