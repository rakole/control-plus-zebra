import fs from "node:fs";
import path from "node:path";

const plistPath = path.join(
  process.cwd(),
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "Info.plist"
);

if (process.platform !== "darwin" || !fs.existsSync(plistPath)) {
  process.exit(0);
}

const plist = fs.readFileSync(plistPath, "utf8");

const updatedPlist = plist
  .replace(
    "<key>CFBundleDisplayName</key>\n\t<string>Electron</string>",
    "<key>CFBundleDisplayName</key>\n\t<string>Control + Zebra</string>"
  )
  .replace(
    "<key>CFBundleName</key>\n\t<string>Electron</string>",
    "<key>CFBundleName</key>\n\t<string>Control + Zebra</string>"
  );

if (updatedPlist !== plist) {
  fs.writeFileSync(plistPath, updatedPlist);
  console.log("Patched Electron dev app name for macOS Dock.");
}
