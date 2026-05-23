import path from "node:path";

export function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

export function isPathWithinDirectory(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

