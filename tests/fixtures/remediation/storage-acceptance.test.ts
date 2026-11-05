import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

const enabled = process.env.BIDTOOL_RUN_STORAGE_ACCEPTANCE === "1";
const digest = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const job = "cb5b521e-e206-430e-99db-33ca2076015b";
const fixtureEnv = {
  NODE_ENV: "test",
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DOCKER_CONTEXT: "default",
} satisfies NodeJS.ProcessEnv;
const serviceSchema = z
  .object({
    image: z.string(),
    container_name: z.string().optional(),
    ports: z.array(z.unknown()).optional(),
    environment: z.record(z.string()),
    volumes: z.array(z.unknown()),
    healthcheck: z.record(z.unknown()),
  })
  .passthrough();
const composeSchema = z.object({
  services: z.object({ app: serviceSchema, postgres: serviceSchema }),
});
const artifacts = [
  {
    file: "catalog-pdfs/1/upload.pdf",
    bytes: "%PDF-1.4\nuploaded R1 fixture",
    document: 1,
  },
  {
    file: "catalog-pdfs/2/generated.pdf",
    bytes: "%PDF-1.4\ngenerated R1 fixture",
    document: 2,
  },
  {
    file: "excel-research/job/original/source.xlsx",
    bytes: "R1 original workbook",
    kind: "original_xlsx",
  },
  {
    file: "excel-research/job/enriched/enriched.xlsx",
    bytes: "R1 enriched workbook",
    kind: "enriched_xlsx",
  },
  {
    file: "excel-research/job/reports/report.json",
    bytes: '{"fixture":"R1"}',
    kind: "review_report_json",
  },
  {
    file: "excel-research/job/pdfs/found.pdf",
    bytes: "%PDF-1.4\nfound research fixture",
    kind: "pdf_found",
  },
  {
    file: "excel-research/job/pdfs/generated.pdf",
    bytes: "%PDF-1.4\ngenerated research fixture",
    kind: "pdf_generated",
  },
  {
    file: "material-profiles/workspace/source.xlsx",
    bytes: "R1 profile workbook",
  },
];

async function command(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv = fixtureEnv,
) {
  return new Promise<{ code: number | null; stdout: string; output: string }>(
    (resolve, reject) => {
      const child = spawn(program, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let stdout = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 150_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: stdout.trim(), output: output.trim() });
      });
    },
  );
}
async function docker(args: string[]) {
  const result = await command("docker", args);
  if (result.code !== 0)
    throw new Error(
      `docker ${args[0]} failed (${result.code}): ${result.output}`,
    );
  return result.stdout;
}

async function stack(root: string, image: string, suffix: string) {
  const project = `bidtool-r1-${randomUUID().replaceAll("-", "")}-${suffix}`;
  const directory = path.join(root, project);
  await mkdir(directory);
  const envFile = path.join(directory, "fixture.env");
  await writeFile(
    envFile,
    [
      `BIDTOOL_APP_IMAGE=${image}`,
      "POSTGRES_USER=bidtool_test",
      "POSTGRES_PASSWORD=fixture-only",
      "POSTGRES_DB=bidtool_test_storage",
      `BIDTOOL_BACKUP_DIR=${path.join(directory, "backups")}`,
      "ENABLE_DEMO_SEED=false",
      "BIDTOOL_MIGRATION_ATTEMPTS=2",
    ].join("\n") + "\n",
  );
  const base = composeSchema.parse(
    JSON.parse(
      await docker([
        "compose",
        "--env-file",
        envFile,
        "-p",
        project,
        "-f",
        "compose.production.yml",
        "config",
        "--format",
        "json",
      ]),
    ),
  );
  for (const service of Object.values(base.services)) {
    delete service.container_name;
    delete service.ports;
  }
  base.services.app.image = "${BIDTOOL_APP_IMAGE}";
  base.services.app.healthcheck = {
    ...base.services.app.healthcheck,
    interval: "2s",
    start_period: "2s",
    retries: 45,
  };
  base.services.postgres.volumes = [
    {
      type: "volume",
      source: "bidtool-onprem-postgres-data",
      target: "/var/lib/postgresql/data",
    },
  ];
  const composeFile = path.join(directory, "compose.json");
  async function configuration(durable: boolean) {
    base.services.app.volumes = durable
      ? [
          {
            type: "volume",
            source: "bidtool-onprem-app-data",
            target: "/app/data",
          },
        ]
      : [];
    await writeFile(
      composeFile,
      JSON.stringify({
        name: project,
        services: { app: base.services.app, postgres: base.services.postgres },
        volumes: {
          "bidtool-onprem-postgres-data": {},
          "bidtool-onprem-app-data": {
            name: `\${BIDTOOL_DATA_VOLUME:-${project}_app-data}`,
          },
        },
      }),
    );
  }
  await configuration(false);
  const prefix = [
    "compose",
    "--env-file",
    envFile,
    "-f",
    composeFile,
    "-p",
    project,
  ];
  const compose = (args: string[]) => docker([...prefix, ...args]);
  const sql = (query: string, database = "bidtool_test_storage") =>
    compose([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "bidtool_test",
      "-d",
      database,
      "-At",
      "-c",
      query,
    ]);
  return {
    project,
    directory,
    envFile,
    composeFile,
    configuration,
    compose,
    sql,
    async script(operation: string, args: string[] = []) {
      // Do not inherit a developer's DB, image, volume or credential overrides.
      const result = await command(
        "sh",
        [`scripts/onprem-${operation}.sh`, ...args],
        {
          ...fixtureEnv,
          BIDTOOL_ONPREM_PROJECT: project,
          BIDTOOL_ONPREM_COMPOSE_FILE: composeFile,
          BIDTOOL_ONPREM_ENV_FILE: envFile,
        },
      );
      console.log(
        `[${project}] ${operation} (${result.code}):\n${result.output}`,
      );
      return result;
    },
    async cleanup() {
      // Inspect labels before removal; never use a global prune or shared name.
      await compose(["down", "--volumes", "--remove-orphans"]);
      const volumes = await docker([
        "volume",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]);
      for (const volume of volumes.split("\n").filter(Boolean)) {
        const owner = await docker([
          "volume",
          "inspect",
          volume,
          "--format",
          '{{index .Labels "com.docker.compose.project"}}',
        ]);
        expect(owner).toBe(project);
        await docker(["volume", "rm", volume]);
      }
    },
  };
}
type Stack = Awaited<ReturnType<typeof stack>>;

async function seed(target: Stack) {
  await target.compose([
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    `
    const fs=require('fs'),p=require('path');
    for(const f of ${JSON.stringify(artifacts)}) {
      const file=p.join('/app/data',f.file);fs.mkdirSync(p.dirname(file),{recursive:true});fs.writeFileSync(file,f.bytes);
    }
  `,
  ]);
  await target.sql(`INSERT INTO excel_research_jobs (id,name,source_file_name,sheet_name,header_row_index)
    VALUES ('${job}','R1 fixture','source.xlsx','Sheet1',1);
    INSERT INTO excel_workspaces (name,source_workbook_path,output_dir_path)
    VALUES ('R1 fixture','/app/data/material-profiles/workspace/source.xlsx','/operator/exports');`);
  for (const artifact of artifacts) {
    if (artifact.document)
      await target.sql(`INSERT INTO material_catalog_documents
      (id,title,local_file_path,file_name,file_size,checksum,mime_type)
      VALUES (${artifact.document},'R1 fixture','${artifact.file.slice("catalog-pdfs/".length)}',
        '${path.basename(artifact.file)}',${Buffer.byteLength(artifact.bytes)},'${digest(artifact.bytes)}','application/pdf')`);
    if (artifact.kind)
      await target.sql(`INSERT INTO excel_research_file_artifacts
      (job_id,kind,local_file_path,file_name,file_size,checksum)
      VALUES ('${job}','${artifact.kind}','${artifact.file.slice("excel-research/".length)}',
        '${path.basename(artifact.file)}',${Buffer.byteLength(artifact.bytes)},'${digest(artifact.bytes)}')`);
  }
}

async function records(target: Stack) {
  return target.sql(`SELECT json_build_object(
    'documents',(SELECT json_agg(d ORDER BY id) FROM material_catalog_documents d),
    'artifacts',(SELECT json_agg(a ORDER BY id) FROM excel_research_file_artifacts a),
    'jobs',(SELECT json_agg(j ORDER BY id) FROM excel_research_jobs j),
    'profiles',(SELECT json_agg(w ORDER BY id) FROM excel_workspaces w))`);
}

async function verifyBytesAndDownloads(target: Stack) {
  const checksums = JSON.parse(
    await target.compose([
      "exec",
      "-T",
      "app",
      "node",
      "-e",
      `
    const fs=require('fs'),p=require('path'),c=require('crypto');
    console.log(JSON.stringify(${JSON.stringify(artifacts)}.map(f=>({
      file:f.file,sha256:c.createHash('sha256').update(fs.readFileSync(p.join('/app/data',f.file))).digest('hex')
    }))));
  `,
    ]),
  );
  expect(checksums).toEqual(
    artifacts.map((f) => ({ file: f.file, sha256: digest(f.bytes) })),
  );
  for (const artifact of artifacts.filter((f) => f.document)) {
    const checksum = await target.compose([
      "exec",
      "-T",
      "app",
      "node",
      "-e",
      `
      const c=require('crypto');fetch('http://127.0.0.1:3000/api/catalog-pdfs/${artifact.document}/file')
      .then(async r=>{if(!r.ok)throw Error('Download HTTP '+r.status);
        console.log(c.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'));})
      .catch(e=>{console.error(e);process.exit(1)});
    `,
    ]);
    expect(checksum).toBe(digest(artifact.bytes));
  }
}

test.skipIf(!enabled)(
  "R1 real container migration, replacement, downloads, fresh restore and failures",
  async () => {
    const requested = process.env.BIDTOOL_STORAGE_TEST_IMAGE;
    if (!requested || !/^bidtool-r1-acceptance:[a-f0-9]+$/.test(requested))
      throw new Error(
        "Build a disposable bidtool-r1-acceptance:<hex> image first.",
      );
    const endpoint = await docker([
      "context",
      "inspect",
      "default",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
    if (!endpoint.startsWith("unix://"))
      throw new Error("R1 fixtures require a local Unix Docker socket.");
    const image = await docker([
      "image",
      "inspect",
      requested,
      "--format",
      "{{.Id}}",
    ]);
    expect(image).toMatch(/^sha256:[a-f0-9]{64}$/);
    const root = await mkdtemp(path.join(tmpdir(), "bidtool-r1-acceptance-"));
    const owned: Stack[] = [];
    try {
      const original = await stack(root, image, "original");
      owned.push(original);
      const fresh = await stack(root, image, "fresh");
      owned.push(fresh);
      await original.compose(["up", "-d", "--wait", "--wait-timeout", "120"]);
      await seed(original);
      await verifyBytesAndDownloads(original);
      const before = await records(original);
      const oldContainer = await original.compose(["ps", "-q", "app"]);
      const mounts = z
        .array(z.object({ Destination: z.string() }))
        .parse(
          JSON.parse(
            await docker([
              "inspect",
              oldContainer,
              "--format",
              "{{json .Mounts}}",
            ]),
          ),
        );
      expect(mounts.some((mount) => mount.Destination === "/app/data")).toBe(
        false,
      );

      await fresh.configuration(true);
      await fresh.compose(["up", "-d", "--wait", "postgres"]);
      expect(
        await fresh.sql(
          "SELECT to_regclass('public.material_catalog_documents') IS NULL",
        ),
      ).toBe("t");
      const postgresContainer = await original.compose([
        "ps",
        "-q",
        "postgres",
      ]);
      await original.configuration(true); // Configuration change must not recreate the old container.
      const update = await original.script("update", ["--schema-compatible"]);
      expect(update, update.output).toMatchObject({ code: 0 });
      expect(await original.compose(["ps", "-q", "app"])).not.toBe(
        oldContainer,
      );
      expect(await original.compose(["ps", "-q", "postgres"])).toBe(
        postgresContainer,
      );
      expect(await records(original)).toBe(before);
      await verifyBytesAndDownloads(original);
      const backupRoot = path.join(original.directory, "backups");
      const bundleName = (await readdir(backupRoot)).find((name) =>
        name.endsWith(".bundle"),
      );
      if (!bundleName)
        throw new Error("Update did not publish its complete bundle.");
      const bundle = path.join(backupRoot, bundleName);
      const manifest = JSON.parse(
        await readFile(path.join(bundle, "manifest.json"), "utf8"),
      );
      expect(
        manifest.entries.filter((e: { kind: string }) => e.kind === "file"),
      ).toHaveLength(artifacts.length);
      expect(manifest.externalOutputs).toEqual([
        { path: "/operator/exports", included: false },
      ]);
      await original.compose([
        "up",
        "-d",
        "--no-deps",
        "--force-recreate",
        "--wait",
        "app",
      ]);
      expect(await records(original)).toBe(before);
      await verifyBytesAndDownloads(original);

      const restore = await fresh.script("restore", [bundle]);
      expect(restore, restore.output).toMatchObject({ code: 0 });
      expect(await records(fresh)).toBe(before);
      await verifyBytesAndDownloads(fresh);
      expect(
        await fresh.sql(
          "SELECT count(*) FROM pg_database WHERE datname LIKE 'bidtool_previous_%'",
          "postgres",
        ),
      ).toBe("1");

      // Corrupt input must fail before any activation; the current app and DB survive.
      for (const failure of ["checksum", "missing-tree", "dump"]) {
        const broken = path.join(root, `broken-${failure}.bundle`);
        await cp(bundle, broken, { recursive: true });
        if (failure === "missing-tree")
          await rm(path.join(broken, "files/excel-research"), {
            recursive: true,
          });
        else
          await writeFile(
            path.join(
              broken,
              failure === "dump"
                ? "database.dump"
                : "files/catalog-pdfs/1/upload.pdf",
            ),
            "corrupt",
          );
        const id = await fresh.compose(["ps", "-q", "app"]);
        expect((await fresh.script("restore", [broken])).code).not.toBe(0);
        expect(await fresh.compose(["ps", "-q", "app"])).toBe(id);
        expect(await records(fresh)).toBe(before);
      }

      // Execute a real failing SQL statement in the disposable PostgreSQL service.
      const sqlFile = path.join(root, "broken.sql");
      await writeFile(
        sqlFile,
        "CREATE TABLE should_roll_back(id int); SELECT 1/0;",
      );
      const failedSql = await fresh.script("restore", [
        sqlFile,
        "--database-only",
        "--schema-compatible",
      ]);
      expect(failedSql.code).not.toBe(0);
      expect(failedSql.output).toContain("division by zero");
      expect(await fresh.compose(["ps", "-q", "app"])).toBe("");
      expect(await records(fresh)).toBe(before);
      expect(
        await fresh.sql(
          "SELECT count(*) FROM pg_database WHERE datname LIKE 'bidtool_previous_%'",
          "postgres",
        ),
      ).toBe("1");
      // A separate project remains usable while the failed restore leaves its app stopped.
      await verifyBytesAndDownloads(original);
      await fresh.cleanup();
      owned.pop();
      await verifyBytesAndDownloads(original);
      console.log(
        `R1 acceptance passed: ${artifacts.length} files, uploaded/generated downloads, retained records, fresh restore, corrupt/missing/SQL failures; two isolated projects.`,
      );
    } catch (error) {
      for (const target of owned) {
        try {
          console.error(await target.compose(["logs", "--tail", "60"]));
        } catch {}
      }
      throw error;
    } finally {
      const cleanup = await Promise.allSettled(
        owned.map((target) => target.cleanup()),
      );
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length)
        throw new AggregateError(
          failures,
          `R1 fixture cleanup failed; retained ${root}`,
        );
      await rm(root, { recursive: true, force: true });
    }
  },
  600_000,
);
