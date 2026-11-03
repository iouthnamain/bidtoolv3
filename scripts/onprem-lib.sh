#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

COMPOSE_FILE="${BIDTOOL_ONPREM_COMPOSE_FILE:-$ROOT_DIR/compose.production.yml}"
ENV_FILE="${BIDTOOL_ONPREM_ENV_FILE:-$ROOT_DIR/deploy/onprem/.env.customer}"
ENV_EXAMPLE_FILE="$ROOT_DIR/deploy/onprem/.env.customer.example"
PROJECT_NAME="${BIDTOOL_ONPREM_PROJECT:-bidtool-onprem}"

log() {
  printf '\n[bidtool-onprem] %s\n' "$*"
}

fail() {
  printf '\n[bidtool-onprem] %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" "$@"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi

  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
}

replace_env_value() {
  key="$1"
  value="$2"
  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" >"$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  [ -f "$ENV_EXAMPLE_FILE" ] || fail "Missing template: $ENV_EXAMPLE_FILE"

  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  replace_env_value "POSTGRES_PASSWORD" "$(random_secret)"

  log "Created customer env file at $ENV_FILE"
  log "Review APP_BASE_URL, BIDTOOL_SITE_ADDRESS, and host ports before exposing this server."
}

load_env_file() {
  ensure_env_file
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
}

check_docker() {
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is unavailable."
  docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
}

backup_dir() {
  load_env_file
  printf '%s\n' "${BIDTOOL_BACKUP_DIR:-$ROOT_DIR/backups/onprem}"
}

print_stack_summary() {
  load_env_file
  compose ps
  printf '\nBidTool URL: %s\n' "${APP_BASE_URL:-http://localhost:13000}"
  printf 'Customer env: %s\n' "$ENV_FILE"
}

# Kept here so the existing on-prem release bundle carries the whole protocol.
# Host Node handles structured manifests without evaluating customer data as shell.
storage_operation() {
  require_command node
  BIDTOOL_STORAGE_ROOT="$ROOT_DIR" BIDTOOL_STORAGE_COMPOSE="$COMPOSE_FILE" \
  BIDTOOL_STORAGE_ENV="$ENV_FILE" BIDTOOL_STORAGE_PROJECT="$PROJECT_NAME" \
  node - "$@" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const [operation, ...args] = process.argv.slice(2);
const envFile = process.env.BIDTOOL_STORAGE_ENV;
const project = process.env.BIDTOOL_STORAGE_PROJECT;
const composeArgs = [
  "compose",
  "--env-file",
  envFile,
  "-f",
  process.env.BIDTOOL_STORAGE_COMPOSE,
  "-p",
  project,
];
const backupRoot = path.resolve(
  process.env.BIDTOOL_BACKUP_DIR || path.join(process.env.BIDTOOL_STORAGE_ROOT, "backups/onprem"),
);
const token = Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
let stopped = false;
let replacing = false;
let wasRunning = false;
let container;
let lock;
let ownsLock = false;
let config;
function fail(message) {
  throw new Error(message);
}
function run(command, options = {}) {
  const result = spawnSync("docker", command, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(
      `Docker command failed (${command[0]}): ${result.error?.message || result.stderr || result.status}`,
    );
    error.exitCode = result.status || 1;
    throw error;
  }
  return result.stdout?.trim() || "";
}
function compose(command, options) {
  return run([...composeArgs, ...command], options);
}
function json(text) {
  return JSON.parse(text);
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
function hash(file) {
  const digest = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, size));
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest("hex");
}
function inventory(root, prefix = "") {
  return fs
    .readdirSync(path.join(root, prefix))
    .sort()
    .flatMap((name) => {
      if (/^\.env(?:\.|$)/.test(name))
        fail(`Secret env file in data tree: ${prefix}/${name}; relocate it before backup.`);
      const relative = path.posix.join(prefix, name);
      const file = path.join(root, relative);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        fail(`Unsupported data entry: ${relative}`);
      if (stat.isDirectory())
        return [{ path: relative, kind: "directory" }, ...inventory(root, relative)];
      return [{ path: relative, kind: "file", size: stat.size, sha256: hash(file) }];
    });
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !path.isAbsolute(relative)
  );
}
function environment(list) {
  return Object.fromEntries(
    (list || []).map((entry) => {
      const i = entry.indexOf("=");
      return [entry.slice(0, i), entry.slice(i + 1)];
    }),
  );
}
const dbUser = () => config.services.postgres.environment.POSTGRES_USER || "bidtool";
const dbName = () => config.services.postgres.environment.POSTGRES_DB || "bidtoolv3";
function db(sql, database = dbName()) {
  return compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    dbUser(),
    "-d",
    database,
    "-At",
    "-c",
    sql,
  ]);
}
const ident = (value) => '"' + value.replaceAll('"', '""') + '"';
function snapshot(database = dbName()) {
  // Fail on a missing table/column: an unknown schema is not a complete backup.
  return json(
    db(
      `SELECT json_build_object(
    'schema', (SELECT coalesce(json_agg(m ORDER BY id), '[]') FROM drizzle.__drizzle_migrations m),
    'settings', (SELECT coalesce(json_object_agg(key,value ORDER BY key), '{}') FROM app_settings WHERE key IN ('bidtool_excel_research_dir','bidtool_material_profile_export_dir')),
    'references', (SELECT coalesce(json_agg(r ORDER BY tree, path), '[]') FROM (
      SELECT 'catalog-pdfs' AS tree, local_file_path AS path, file_size AS size, checksum FROM material_catalog_documents WHERE local_file_path IS NOT NULL
      UNION ALL SELECT 'excel-research', local_file_path, file_size, checksum FROM excel_research_file_artifacts
      UNION ALL SELECT 'material-profiles', source_workbook_path, NULL, NULL FROM excel_workspaces WHERE source_workbook_path IS NOT NULL
    ) r),
    'externalOutputs', (SELECT coalesce(json_agg(DISTINCT output_dir_path ORDER BY output_dir_path), '[]') FROM excel_workspaces WHERE output_dir_path IS NOT NULL)
  )`,
      database,
    ),
  );
}
function roots(appEnv, cwd, metadata) {
  const root = path.resolve(cwd, appEnv.BIDTOOL_DATA_DIR?.trim() || "data");
  const result = { root, trees: {} };
  const settings = metadata.settings;
  for (const [tree, value] of [
    ["catalog-pdfs", appEnv.BIDTOOL_CATALOG_PDF_DIR],
    [
      "excel-research",
      appEnv.BIDTOOL_EXCEL_RESEARCH_DIR?.trim() || settings.bidtool_excel_research_dir,
    ],
    [
      "material-profiles",
      appEnv.BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR?.trim() ||
        settings.bidtool_material_profile_export_dir,
    ],
  ]) {
    const effective = value?.trim() ? path.resolve(cwd, value.trim()) : path.join(root, tree);
    console.log(`[storage] ${tree}: ${effective}`);
    if (!inside(root, effective))
      fail(
        `Complete backup refuses server-managed path outside ${root}: ${effective}. Move it into the durable root first.`,
      );
    result.trees[tree] = path.relative(root, effective);
  }
  return result;
}
function verifyReferences(
  bundle,
  manifest,
  metadata = manifest.database,
  effective = manifest.paths,
) {
  const files = new Map(
    manifest.entries.filter((entry) => entry.kind === "file").map((entry) => [entry.path, entry]),
  );
  const errors = [];
  for (const reference of metadata.references) {
    const tree = path.join(effective.root, effective.trees[reference.tree]);
    const absolute = path.resolve(tree, reference.path);
    if (!inside(tree, absolute)) {
      errors.push(`${reference.tree}: outside effective tree: ${reference.path}`);
      continue;
    }
    const relative = path.relative(effective.root, absolute);
    const entry = files.get(relative);
    if (!entry || !fs.existsSync(path.join(bundle, "files", relative)))
      errors.push(`Missing referenced file: ${reference.path}`);
    else if (
      (reference.size !== null && Number(reference.size) !== entry.size) ||
      (reference.checksum && reference.checksum !== entry.sha256)
    )
      errors.push(`Referenced bytes differ: ${reference.path}`);
  }
  if (errors.length) fail(errors.join("\n"));
}
function verifyBundle(bundle) {
  if (!fs.lstatSync(bundle).isDirectory() || fs.lstatSync(bundle).isSymbolicLink())
    fail("Bundle must be a directory, not a symlink.");
  for (const [name, directory] of [
    ["manifest.json", false],
    ["database.dump", false],
    ["files", true],
  ]) {
    const stat = fs.lstatSync(path.join(bundle, name));
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
      fail(`Invalid bundle entry: ${name}`);
  }
  const manifest = json(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  if (
    manifest.format !== "bidtool-complete" ||
    manifest.version !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.image)
  )
    fail("Unsupported bundle format or image identifier.");
  if (hash(path.join(bundle, "database.dump")) !== manifest.dumpSha256)
    fail("Database dump checksum mismatch.");
  const entries = inventory(path.join(bundle, "files"));
  if (JSON.stringify(entries) !== JSON.stringify(manifest.entries))
    fail("File tree, size or checksum mismatch.");
  for (const tree of ["catalog-pdfs", "excel-research", "material-profiles"]) {
    const relative = manifest.paths.trees[tree];
    if (
      typeof relative !== "string" ||
      !inside(manifest.paths.root, path.resolve(manifest.paths.root, relative)) ||
      !fs.statSync(path.join(bundle, "files", relative)).isDirectory()
    )
      fail(`Missing or invalid tree: ${tree}`);
  }
  verifyReferences(bundle, manifest);
  return manifest;
}
function currentApp() {
  const id = compose(["ps", "-a", "-q", "app"]);
  if (!id || id.includes("\n"))
    fail("Expected one existing app container; no data discovery is possible.");
  container = json(run(["inspect", id]))[0];
  const actualDatabase = environment(container.Config.Env).DATABASE_URL;
  const expectedDatabase = config.services.app.environment.DATABASE_URL;
  if (!actualDatabase || actualDatabase !== expectedDatabase)
    fail(
      "Old container DATABASE_URL differs from effective Compose configuration; preserve the original database configuration before backup.",
    );
  const databaseUrl = new URL(expectedDatabase);
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.hostname !== "postgres" ||
    (databaseUrl.port && databaseUrl.port !== "5432") ||
    decodeURIComponent(databaseUrl.pathname.slice(1)) !== dbName() ||
    decodeURIComponent(databaseUrl.username) !== dbUser()
  )
    fail("App database target must match the bundled PostgreSQL service before complete backup.");
  wasRunning = container.State.Running;
  return id;
}
function stop() {
  compose(["stop", "app"]); // A failed stop forbids every subsequent write/start.
  stopped = true;
}
function copyDump(target, database = dbName()) {
  const fd = fs.openSync(target, "wx", 0o600);
  try {
    compose(["exec", "-T", "postgres", "pg_dump", "-U", dbUser(), "-d", database, "-Fc"], {
      stdio: ["ignore", fd, "pipe"],
    });
  } finally {
    fs.closeSync(fd);
  }
  if (fs.statSync(target).size === 0) fail("Empty database dump.");
  const readFd = fs.openSync(target, "r");
  try {
    compose(["exec", "-T", "postgres", "pg_restore", "--list"], {
      stdio: [readFd, "pipe", "pipe"],
    });
  } finally {
    fs.closeSync(readFd);
  }
}
function backup(id) {
  const directory = fs.mkdtempSync(path.join(backupRoot, ".incomplete-"));
  for (const mount of container.Mounts || []) {
    if (
      mount.Source &&
      (path.resolve(backupRoot) === path.resolve(mount.Source) ||
        inside(path.resolve(mount.Source), path.resolve(backupRoot)))
    )
      fail("Backup directory must be outside existing application mounts.");
  }
  const metadata = snapshot();
  const paths = roots(
    environment(container.Config.Env),
    container.Config.WorkingDir || "/app",
    metadata,
  );
  const files = path.join(directory, "files");
  fs.mkdirSync(files);
  const free = fs.statfsSync(backupRoot);
  const databaseBytes = Number(db("SELECT pg_database_size(current_database())"));
  if (
    !Number.isFinite(databaseBytes) ||
    Number(free.bavail) * Number(free.bsize) <
      databaseBytes * 2 + (container.rootProbe?.size || 0) * 2
  )
    fail("Insufficient disk space for database and file staging.");
  run(["cp", `${id}:${paths.root}/.`, files]);
  for (const tree of Object.values(paths.trees))
    fs.mkdirSync(path.join(files, tree), { recursive: true });
  copyDump(path.join(directory, "database.dump"));
  const manifest = {
    format: "bidtool-complete",
    version: 1,
    createdAt: new Date().toISOString(),
    image: container.Image,
    appVersion: environment(container.Config.Env).BIDTOOL_APP_VERSION || null,
    paths,
    previousMounts: (container.Mounts || []).map((mount) => ({
      type: mount.Type,
      name: mount.Name || null,
      source: mount.Source || null,
      destination: mount.Destination,
    })),
    database: metadata,
    externalOutputs: metadata.externalOutputs.map((output) => ({ path: output, included: false })),
    entries: inventory(files),
    dumpSha256: hash(path.join(directory, "database.dump")),
  };
  writeJson(path.join(directory, "manifest.json"), manifest);
  verifyBundle(directory);
  const published = path.join(backupRoot, `bidtool-${token}.bundle`);
  fs.renameSync(directory, published);
  console.log(`Complete backup created: ${published}`);
  return { directory: published, manifest };
}
function preflight(id) {
  if (!wasRunning) return; // A stopped container is copied directly; copy failure is fatal.
  const root = path.resolve(
    container.Config.WorkingDir || "/app",
    environment(container.Config.Env).BIDTOOL_DATA_DIR?.trim() || "data",
  );
  container.rootProbe = json(
    run([
      "exec",
      id,
      "node",
      "-e",
      `const fs=require('fs'),p=require('path');let size=0;function walk(d){for(const n of fs.readdirSync(d)){const f=p.join(d,n),s=fs.lstatSync(f);if(s.isSymbolicLink())throw Error('Symlink in data root');if(s.isDirectory())walk(f);else size+=s.size;}}const root=process.argv[1],exists=fs.existsSync(root);if(exists)walk(root);else fs.mkdirSync(root,{recursive:true});console.log(JSON.stringify({exists:true,size}));`,
      root,
    ]),
  );
  const free = fs.statfsSync(backupRoot);
  if (Number(free.bavail) * Number(free.bsize) < container.rootProbe.size * 3 + 64 * 1024 * 1024)
    fail("Insufficient staging disk space for file copies.");
  console.log(`Previous image: ${container.Image}; file bytes: ${container.rootProbe.size}`);
}
function initializeVolume(bundle, image) {
  const volume = `${project}_data_${token}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(volume)) fail("Invalid Compose project/volume name.");
  // Never initialize an existing volume, even if it appears empty.
  const existing = spawnSync("docker", ["volume", "inspect", volume], { stdio: "ignore" });
  if (existing.status === 0) fail(`Refusing existing destination volume ${volume}`);
  run([
    "volume",
    "create",
    "--label",
    `com.bidtool.recovery=${token}`,
    "--label",
    `com.docker.compose.project=${project}`,
    "--label",
    "com.docker.compose.volume=bidtool-onprem-app-data",
    volume,
  ]);
  if (bundle.includes(",")) fail("Bundle path cannot contain a comma.");
  run([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    "--mount",
    `type=bind,src=${bundle},dst=/bundle,readonly`,
    "--mount",
    `type=volume,src=${volume},dst=/target`,
    image,
    "-e",
    `
const fs=require('fs'),p=require('path'),c=require('crypto');
if(fs.readdirSync('/target').length)throw Error('Destination must be empty');
const m=JSON.parse(fs.readFileSync('/bundle/manifest.json'));
const required=m.entries.reduce((sum,e)=>sum+(e.size||0),0),space=fs.statfsSync('/target');
if(Number(space.bavail)*Number(space.bsize)<required+64*1024*1024)throw Error('Insufficient destination volume space');
for(const name of fs.readdirSync('/bundle/files'))fs.cpSync(p.join('/bundle/files',name),p.join('/target',name),{recursive:true,errorOnExist:true,force:false});
for(const e of m.entries){const f=p.join('/target',e.path),s=fs.lstatSync(f);if(e.kind==='directory'){if(!s.isDirectory())throw Error(e.path);}else{const h=c.createHash('sha256');const fd=fs.openSync(f,'r'),b=Buffer.alloc(1048576);let n;try{while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}if(!s.isFile()||s.size!==e.size||h.digest('hex')!==e.sha256)throw Error('Copy checksum: '+e.path);}}
`,
  ]);
  console.log(`Staged volume: ${volume}; retained until operator cleanup.`);
  return volume;
}
function setEnv(key, value) {
  if (!/^[A-Za-z0-9_./:@-]+$/.test(value)) fail(`Unsafe value for ${key}`);
  const contents = fs.readFileSync(envFile, "utf8");
  const lines = contents.split("\n").filter((line) => !line.startsWith(key + "="));
  const temp = envFile + `.storage-${token}`;
  fs.writeFileSync(temp, lines.join("\n") + `\n${key}=${value}\n`, { mode: 0o600 });
  fs.renameSync(temp, envFile);
  process.env[key] = value; // Exported old env would otherwise override --env-file.
}
function imageId(image) {
  return run(["image", "inspect", image, "--format", "{{.Id}}"]);
}
function verifyTargetPaths(metadata, expected) {
  const target = roots(config.services.app.environment, "/app", metadata);
  if (JSON.stringify(target) !== JSON.stringify(expected))
    fail(
      "Target storage paths differ from the bundle. Preserve the recorded environment/settings before activation.",
    );
}
function stageDatabase(file, sql = false) {
  const staging = `bidtool_stage_${token}`;
  compose(["exec", "-T", "postgres", "createdb", "-U", dbUser(), "-T", "template0", staging]);
  console.log(`Staged database: ${staging}; retained on failure.`);
  const fd = fs.openSync(file, "r");
  try {
    const command = sql
      ? ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-1"]
      : ["pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges"];
    compose(["exec", "-T", "postgres", ...command, "-U", dbUser(), "-d", staging], {
      stdio: [fd, "pipe", "pipe"],
    });
  } finally {
    fs.closeSync(fd);
  }
  return staging;
}
function activateDatabase(staging) {
  const previous = `bidtool_previous_${token}`;
  console.log(`Previous database retained as ${previous}; app stays stopped if activation fails.`);
  // Connect to the maintenance DB, never the database being renamed. PostgreSQL
  // rolls both renames back together if either fails.
  db(
    `BEGIN; ALTER DATABASE ${ident(dbName())} RENAME TO ${ident(previous)}; ALTER DATABASE ${ident(staging)} RENAME TO ${ident(dbName())}; COMMIT;`,
    "postgres",
  );
}
function start() {
  compose(["up", "-d", "--no-deps", "--wait", "--wait-timeout", "90", "app"]);
  // This is liveness only. Operators still owe document download/runtime proof.
  compose([
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    `fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`,
  ]);
}
try {
  if (Number(process.versions.node.split(".")[0]) < 20)
    fail("Node.js 20+ is required on the operator host.");
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  lock = path.join(backupRoot, `.${project}.storage-lock`);
  fs.mkdirSync(lock); // Serialize scripts; stale locks require explicit recovery.
  ownsLock = true;
  const allowed =
    operation === "restore"
      ? ["--database-only", "--schema-compatible"]
      : operation === "update"
        ? ["--schema-compatible"]
        : [];
  if (
    args.some((arg) => arg.startsWith("--") && !allowed.includes(arg)) ||
    (operation !== "restore" && args.some((arg) => !arg.startsWith("--"))) ||
    (operation === "restore" && args.filter((arg) => !arg.startsWith("--")).length !== 1)
  )
    fail("Unsupported arguments; see docs/updates/durable-storage.md.");
  if (operation === "update" && !args.includes("--schema-compatible"))
    fail(
      "Update requires --schema-compatible after establishing target image compatibility with the current schema. No app stop or replacement was attempted.",
    );
  config = json(compose(["config", "--format", "json"]));
  if (["postgres", "template0", "template1"].includes(dbName()))
    fail("Use an application database distinct from PostgreSQL maintenance databases.");
  if (operation === "restore") {
    const databaseOnly = args.includes("--database-only");
    const file = path.resolve(args.find((arg) => !arg.startsWith("--")) || "");
    if (!args.some((arg) => !arg.startsWith("--")))
      fail(
        "Usage: onprem-restore.sh <bundle> | <backup.sql|backup.dump> --database-only --schema-compatible",
      );
    const manifest = databaseOnly ? null : verifyBundle(file);
    if (databaseOnly && (!/\.(sql|dump)$/.test(file) || !args.includes("--schema-compatible")))
      fail(
        "Legacy database-only restore requires .sql/.dump and --schema-compatible. File bytes are unavailable.",
      );
    if (manifest && imageId(config.services.app.image) !== manifest.image)
      fail(
        "Restore requires the exact recorded app image. Pull/pin it first; schema downgrade is forbidden.",
      );
    const previousId = compose(["ps", "-a", "-q", "app"]);
    if (previousId) {
      currentApp();
      preflight(previousId);
    }
    // Stop is mandatory even when app was already stopped; no ignored failures.
    stop();
    if (previousId) backup(previousId); // Preserve container-layer files before recreation.
    const staging = stageDatabase(
      manifest ? path.join(file, "database.dump") : file,
      file.endsWith(".sql"),
    );
    const metadata = snapshot(staging);
    if (manifest) {
      if (JSON.stringify(metadata) !== JSON.stringify(manifest.database))
        fail("Staged database metadata differs from manifest.");
      verifyTargetPaths(metadata, manifest.paths);
      verifyReferences(file, manifest, metadata);
      const volume = initializeVolume(file, manifest.image);
      replacing = true;
      setEnv("BIDTOOL_DATA_VOLUME", volume);
      setEnv("BIDTOOL_APP_IMAGE", manifest.image);
      activateDatabase(staging);
      start();
      console.log(
        "Bundle activated. Required runtime/download proof remains an operator check. Previous database, volume and bundle are retained.",
      );
    } else {
      replacing = true;
      activateDatabase(staging);
      console.error(
        `Database-only restore activated; app LEFT STOPPED. Document bytes are unavailable (${metadata.references.length} references). Restore matching files and validate before manually starting.`,
      );
    }
  } else if (operation === "backup" || operation === "update") {
    const id = currentApp();
    preflight(id);
    stop();
    const result = backup(id);
    if (operation === "backup") {
      if (wasRunning) compose(["start", "app"]);
      stopped = false;
    } else {
      const image = process.env.BIDTOOL_IMAGE_TAG
        ? `ghcr.io/iouthnamain/bidtoolv3:${process.env.BIDTOOL_IMAGE_TAG}`
        : config.services.app.image;
      // Pulling an image never recreates the preserved old container.
      run(["pull", image]);
      verifyTargetPaths(result.manifest.database, result.manifest.paths);
      const targetImage = imageId(image);
      const volume = initializeVolume(result.directory, targetImage);
      replacing = true;
      setEnv("BIDTOOL_DATA_VOLUME", volume);
      setEnv("BIDTOOL_APP_IMAGE", targetImage);
      start();
      console.log(
        `Update activated. Preserve ${result.directory} and prior volume; verify document downloads before declaring success.`,
      );
    }
  } else fail("Unknown storage operation.");
} catch (error) {
  console.error(`[storage] ${error.message}`);
  if (replacing) {
    try {
      compose(["stop", "app"]);
    } catch (stopError) {
      console.error(`Could not confirm app stopped: ${stopError.message}`);
    }
  }
  // Restore failures always leave the app stopped. Before an update replaces
  // anything, only the service that this operation stopped may be resumed.
  if (operation === "update" && stopped && !replacing && wasRunning) {
    try {
      compose(["start", "app"]);
    } catch (resumeError) {
      console.error(`Could not resume previous app: ${resumeError.message}`);
    }
  }
  if (stopped || replacing)
    console.error(
      "Recovery: preserve staging, bundle and previous data. Resolve the reported failure before any manual app start. No automatic rollback or cleanup was performed.",
    );
  process.exitCode = error.exitCode || 1;
} finally {
  if (ownsLock) {
    try {
      fs.rmdirSync(lock);
    } catch {}
  }
}
NODE
}
