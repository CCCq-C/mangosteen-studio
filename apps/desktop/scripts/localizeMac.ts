import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "@toonflow/file";
import { join } from "node:path";

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
    await $`xattr -cr ${bundlePath}`;
    await $`codesign --force --deep --sign - ${bundlePath}`;
    console.log(`已为本地 macOS 测试包添加临时签名：${bundlePath}`);
  }
  console.log(`已设置 macOS 简体中文本地化：${bundlePath}`);
}
