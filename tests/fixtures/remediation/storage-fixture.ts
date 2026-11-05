import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeDocker } from "./fake-docker";

export async function createStorageDocker(failCommand = "") {
  const fake = await createFakeDocker(failCommand);
  const files = path.join(fake.dir, "source");
  const image = `sha256:${"a".repeat(64)}`;
  const metadata = {
    schema: [{ id: 1, hash: "fixture-schema", created_at: 1 }],
    settings: {},
    references: [
      {
        tree: "catalog-pdfs",
        path: "1/upload.pdf",
        size: 16,
        checksum: createHash("sha256").update("%PDF-upload-test").digest("hex"),
      },
      {
        tree: "excel-research",
        path: "job/pdfs/generated.pdf",
        size: 16,
        checksum: createHash("sha256").update("%PDF-generated-x").digest("hex"),
      },
      {
        tree: "material-profiles",
        path: "/app/data/material-profiles/workspace/source.xlsx",
        size: null,
        checksum: null,
      },
    ],
    externalOutputs: ["/operator/exports"],
  };
  // Derive the uploaded fixture size from its actual bytes.
  metadata.references[0]!.size = Buffer.byteLength("%PDF-upload-test");
  for (const [file, bytes] of [
    ["catalog-pdfs/1/upload.pdf", "%PDF-upload-test"],
    ["excel-research/job/pdfs/generated.pdf", "%PDF-generated-x"],
    ["material-profiles/workspace/source.xlsx", "workbook-bytes"],
  ]) {
    await mkdir(path.dirname(path.join(files, file!)), { recursive: true });
    await writeFile(path.join(files, file!), bytes!);
  }
  const state = {
    image,
    metadata,
    config: {
      services: {
        app: {
          image: "fixture-image",
          environment: {
            BIDTOOL_DATA_DIR: "/app/data",
            DATABASE_URL:
              "postgresql://bidtool_test:fixture@postgres:5432/bidtool_test_restore",
          },
        },
        postgres: {
          environment: {
            POSTGRES_USER: "bidtool_test",
            POSTGRES_DB: "bidtool_test_restore",
          },
        },
      },
    },
    container: {
      Image: image,
      State: { Running: true },
      Config: {
        WorkingDir: "/app",
        Env: [
          "BIDTOOL_APP_VERSION=fixture",
          "DATABASE_URL=postgresql://bidtool_test:fixture@postgres:5432/bidtool_test_restore",
        ],
      },
      Mounts: [],
    },
  };
  const stateFile = path.join(fake.dir, "state.json");
  await writeFile(stateFile, JSON.stringify(state));
  const envFile = path.join(fake.dir, "fixture.env");
  await writeFile(
    envFile,
    `BIDTOOL_BACKUP_DIR='${path.join(fake.dir, "backups")}'\n`,
  );
  // Extend R0's owned fake executable; never connect to Docker or PostgreSQL.
  await writeFile(
    path.join(fake.dir, "docker"),
    `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args)+'\\n');
if (process.env.FAKE_DOCKER_FAIL && args.includes(process.env.FAKE_DOCKER_FAIL)) process.exit(Number(process.env.FAKE_DOCKER_EXIT));
const state=JSON.parse(fs.readFileSync(process.env.FAKE_STORAGE_STATE));
const base=path.dirname(process.env.FAKE_STORAGE_STATE);
if(args.includes('up')) fs.writeFileSync(path.join(base,'activation.json'),JSON.stringify({volume:process.env.BIDTOOL_DATA_VOLUME,image:process.env.BIDTOOL_APP_IMAGE}));
if(args.includes('config')) console.log(JSON.stringify(state.config));
else if(args.includes('ps')) { if(process.env.FAKE_APP_PRESENT!=='false') console.log('fixture-app'); }
else if(args[0]==='inspect') console.log(JSON.stringify([state.container]));
else if(args[0]==='image') console.log(state.image);
else if(args[0]==='volume') {
 if(args[1]==='inspect') process.exit(process.env.FAKE_VOLUME_EXISTS==='true'?0:1);
 if(args[1]==='create') {fs.mkdirSync(path.join(base,args.at(-1)));if(process.env.FAKE_VOLUME_NONEMPTY==='true')fs.writeFileSync(path.join(base,args.at(-1),'keep'),'keep');}
}
else if(args.includes('psql')) {
 const sql=args.at(-1);
 if(sql.includes('json_build_object')) { if(process.env.FAKE_STAGE_MISMATCH==='true' && args.some(a=>a.startsWith('bidtool_stage_')))state.metadata.externalOutputs.push('/unexpected');console.log(JSON.stringify(state.metadata)); }
 else if(sql.includes('pg_database_size')) console.log('1024');
}
else if(args.includes('pg_dump')) process.stdout.write('PGDMP-fixture');
else if(args[0]==='cp') fs.cpSync(path.join(base,'source'),args.at(-1),{recursive:true});
else if(args[0]==='exec' && args.includes('-e')) console.log(JSON.stringify({exists:true,size:128}));
else if(args[0]==='run') {
 const bundle=args.find(a=>a.startsWith('type=bind,src=')).split('src=')[1].split(',dst=')[0];
 const volume=args.find(a=>a.startsWith('type=volume,src=')).split('src=')[1].split(',dst=')[0];
 const target=path.join(base,volume);
 // Use bounded literal replacement for the two fixed mount paths.
 const code=args.at(-1).replace(/(['"])\\/bundle([^'"]*)\\1/g,(_,q,s)=>JSON.stringify(bundle+s)).replace(/(['"])\\/target([^'"]*)\\1/g,(_,q,s)=>JSON.stringify(target+s));
 const check=process.env.FAKE_CORRUPT_COPY==='true'?code.replace('for(const e of m.entries)',"fs.writeFileSync(p.join("+JSON.stringify(target)+",'catalog-pdfs/1/upload.pdf'),'corrupt');for(const e of m.entries)"):code;
 vm.runInNewContext(check,{require,Buffer});
}
`,
    { mode: 0o755 },
  );
  return {
    ...fake,
    files,
    state,
    stateFile,
    envFile,
    env: {
      ...fake.env,
      FAKE_STORAGE_STATE: stateFile,
      BIDTOOL_ONPREM_ENV_FILE: envFile,
      BIDTOOL_ONPREM_PROJECT: `fixture-${path.basename(fake.dir)}`,
    },
    async saveState() {
      await writeFile(stateFile, JSON.stringify(state));
    },
  };
}
