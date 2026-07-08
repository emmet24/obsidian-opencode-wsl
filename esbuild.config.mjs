import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const production = process.argv.includes("--production");

const banner = "/* THIS IS A GENERATED BUNDLE FILE\n * Source: https://github.com/emmet24/obsidian-opencode-wsl\n */\n";

async function main() {
  const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...builtinModules,
    ],
    banner: { js: banner },
    format: "cjs",
    target: "es2018",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    minify: production,
  });

  if (production) {
    await context.rebuild();
    await context.dispose();
  } else {
    await context.watch();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
