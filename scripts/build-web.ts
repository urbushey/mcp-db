/**
 * Builds the web dashboard. The Tailwind plugin can't be passed to the
 * `bun build` CLI, so the build goes through Bun.build here instead.
 * Usage: bun run scripts/build-web.ts [--watch]
 */
import { watch } from "node:fs";
import tailwind from "bun-plugin-tailwind";

async function build() {
  const result = await Bun.build({
    entrypoints: ["web/index.html"],
    outdir: "web/dist",
    minify: true,
    plugins: [tailwind],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    if (!process.argv.includes("--watch")) process.exit(1);
  } else {
    console.log(`Built ${result.outputs.length} files to web/dist`);
  }
}

await build();

if (process.argv.includes("--watch")) {
  let pending = false;
  watch("web", { recursive: true }, () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      void build();
    }, 100);
  });
  console.log("Watching web/ for changes...");
}
