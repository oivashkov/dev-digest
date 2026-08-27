#!/usr/bin/env node
/**
 * collect-deps.mjs — deterministic offline data collection for one package.
 *
 * dev-digest is NOT a monorepo workspace: each package (server/, client/,
 * reviewer-core/, e2e/, mcp-server/, evals/) has its own package.json and its
 * own lockfile, and some use pnpm while others use npm (see AGENTS.md). This
 * script exists so the dependency-checker skill never has to guess which
 * package manager owns a directory or hand-parse `du`/`audit`/`outdated`
 * output inline in a prompt — it does that once, deterministically, and
 * prints one JSON object per package to stdout.
 *
 * Usage: node collect-deps.mjs <package-dir>
 *   e.g. node collect-deps.mjs ../../../server
 *
 * Everything here is best-effort: a missing node_modules, an audit that
 * needs registry reachability, or a slow/unavailable depcheck must degrade
 * to a clearly-flagged `null`/`{ error }` field, never throw and abort the
 * whole collection run — one package's failure shouldn't blank the report.
 */
import { existsSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rawDir = process.argv[2];
if (!rawDir || !existsSync(join(rawDir, "package.json"))) {
  console.error(
    "usage: node collect-deps.mjs <package-dir>  (must contain package.json)",
  );
  process.exit(1);
}
// Resolve to absolute up front: every path below is built with join(dir, ...)
// and some are also passed to spawnSync with `cwd: dir` — mixing a relative
// dir with cwd there double-joins (e.g. "mcp-server/mcp-server/node_modules").
const dir = resolve(rawDir);

const pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
const name = pkgJson.name ?? basename(dir);

const pm = existsSync(join(dir, "pnpm-lock.yaml"))
  ? "pnpm"
  : existsSync(join(dir, "package-lock.json"))
    ? "npm"
    : null;

const deps = {
  prod: Object.keys(pkgJson.dependencies ?? {}),
  dev: Object.keys(pkgJson.devDependencies ?? {}),
  peer: Object.keys(pkgJson.peerDependencies ?? {}),
};

const nodeModulesDir = join(dir, "node_modules");
const hasNodeModules = existsSync(nodeModulesDir);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeout ?? 30_000,
  });
  return res; // caller inspects status/stdout/stderr — non-zero is often normal (audit/outdated exit 1 when findings exist)
}

function duSizeBytes(target) {
  if (!existsSync(target)) return null;
  // pnpm links node_modules/<dep> to its content-addressed store, so a plain
  // `du` (no -L) sees only the symlink itself and reports ~0 bytes for every
  // pnpm-managed package. The fix is NOT `du -L`: pnpm's store packages also
  // nest their *own* dependencies as symlinks (e.g. next's resolved dir has
  // node_modules/{react,postcss,styled-jsx,...} as further symlinks) — `-L`
  // follows those recursively too, so a single top-level dep's reported size
  // silently balloons to include its whole transitive tree (confirmed: this
  // inflated client/'s total from the real 620 MB to 1.8 GB — a ~3x
  // overcount, not a rounding error). The correct approach is to resolve
  // only the *one* symlink from node_modules/<dep> to its real directory,
  // then measure that directory plain (no -L) — this reports the package's
  // own installed content once, matching how npm's real (non-symlinked)
  // hoisted directories already behave, without re-descending into whatever
  // it points at internally.
  let resolved = target;
  try {
    if (lstatSync(target).isSymbolicLink()) resolved = realpathSync(target);
  } catch {
    return null; // broken symlink or race with a concurrent install
  }
  const res = run("du", ["-sk", resolved]); // -k: portable across BSD (macOS) and GNU du
  if (res.status !== 0 || !res.stdout) return null;
  const kb = parseInt(res.stdout.split(/\s+/)[0], 10);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

function humanSize(bytes) {
  if (bytes == null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)}${units[i]}`;
}

// --- total installed size ---
const totalBytes = hasNodeModules ? duSizeBytes(nodeModulesDir) : null;

// --- per top-level dependency size (direct deps only, not the full tree) ---
let topHeaviest = [];
if (hasNodeModules) {
  const allDepNames = [...deps.prod, ...deps.dev];
  const sized = allDepNames
    .map((depName) => {
      // scoped packages (@scope/name) live at node_modules/@scope/name
      const target = join(nodeModulesDir, depName);
      const bytes = duSizeBytes(target);
      return bytes == null ? null : { name: depName, bytes, size: humanSize(bytes) };
    })
    .filter(Boolean);
  sized.sort((a, b) => b.bytes - a.bytes);
  topHeaviest = sized.slice(0, 15);
}

// --- outdated ---
let outdated = { error: null, entries: [] };
if (!hasNodeModules) {
  outdated.error = "node_modules not installed — run the package's install command first";
} else if (!pm) {
  outdated.error = "no lockfile found (pnpm-lock.yaml or package-lock.json) — cannot determine package manager";
} else {
  const res = run(pm, ["outdated", "--json"], { timeout: 60_000 });
  try {
    const parsed = JSON.parse(res.stdout || "{}");
    outdated.entries = Object.entries(parsed).map(([depName, info]) => ({
      name: depName,
      current: info.current ?? null,
      wanted: info.wanted ?? null,
      latest: info.latest ?? null,
    }));
  } catch {
    // empty stdout (nothing outdated) is common and not an error; only flag
    // if stderr suggests a real failure (e.g. registry unreachable)
    if (res.stderr && res.stderr.trim()) outdated.error = res.stderr.trim().slice(0, 500);
  }
}

// --- audit ---
let audit = { error: null, vulnerabilities: null, advisories: [] };
if (!hasNodeModules) {
  audit.error = "node_modules not installed — run the package's install command first";
} else if (!pm) {
  audit.error = "no lockfile found — cannot determine package manager";
} else {
  const res = run(pm, ["audit", "--json"], { timeout: 60_000 });
  try {
    const parsed = JSON.parse(res.stdout || "{}");
    if (pm === "npm") {
      audit.vulnerabilities = parsed.metadata?.vulnerabilities ?? null;
      audit.advisories = Object.values(parsed.vulnerabilities ?? {}).map((v) => ({
        name: v.name,
        severity: v.severity,
        fixAvailable: Boolean(v.fixAvailable),
        via: Array.isArray(v.via) ? v.via.filter((x) => typeof x === "string") : [],
      }));
    } else {
      // pnpm audit --json shape
      audit.vulnerabilities = parsed.metadata?.vulnerabilities ?? null;
      audit.advisories = Object.values(parsed.advisories ?? {}).map((v) => ({
        name: v.module_name,
        severity: v.severity,
        fixAvailable: v.patched_versions !== "<0.0.0",
        title: v.title,
      }));
    }
  } catch {
    audit.error =
      (res.stderr && res.stderr.trim().slice(0, 500)) ||
      "audit did not return parseable JSON (registry unreachable?)";
  }
}

// --- unused deps (depcheck), best-effort, skipped if it would need a network fetch of the tool itself ---
let unused = { skipped: "depcheck not run (invoke collect-deps.mjs --with-depcheck to attempt it)" };
if (process.argv.includes("--with-depcheck") && hasNodeModules) {
  const localDepcheck = join(nodeModulesDir, ".bin", "depcheck");
  if (existsSync(localDepcheck)) {
    const res = run(localDepcheck, ["--json"], { timeout: 45_000 });
    try {
      const parsed = JSON.parse(res.stdout || "{}");
      unused = {
        dependencies: parsed.dependencies ?? [],
        devDependencies: parsed.devDependencies ?? [],
      };
    } catch {
      unused = { error: "depcheck ran but did not return parseable JSON" };
    }
  } else {
    unused = { error: "depcheck not installed locally (no node_modules/.bin/depcheck) — not fetched over network" };
  }
}

const result = {
  name,
  dir,
  packageManager: pm,
  hasNodeModules,
  deps: {
    prod: deps.prod,
    dev: deps.dev,
    peer: deps.peer,
    counts: { prod: deps.prod.length, dev: deps.dev.length, peer: deps.peer.length },
  },
  size: { totalBytes, total: humanSize(totalBytes), topHeaviest },
  outdated,
  audit,
  unused,
};

console.log(JSON.stringify(result, null, 2));
