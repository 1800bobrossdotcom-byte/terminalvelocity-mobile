// Tiny build step: copies web/ → www/ which is what Capacitor syncs into the
// native projects. Lets us keep authoring under web/ without yet another
// bundler.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "web");
const out = resolve(root, "www");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });
console.log(`[build-web] copied ${src} -> ${out}`);
