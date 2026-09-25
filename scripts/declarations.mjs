import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

for (const entry of await readdir("dist", { recursive: true })) {
  if (!entry.endsWith(".d.ts")) continue;
  const input = await readFile(join("dist", entry), "utf8");
  const output = input.replace(/(from\s+['"]\.[^'"]+)\.js(['"])/g, "$1.cjs$2");
  await writeFile(join("dist", entry.replace(/\.d\.ts$/, ".d.cts")), output);
}
