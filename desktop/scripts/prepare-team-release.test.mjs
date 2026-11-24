import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  TEAM_REPOSITORY,
  TEAM_UPDATER_ENDPOINT,
  versionFromTeamTag,
} from "./prepare-team-release.mjs";
import {
  compareTeamVersions,
  validateTeamManifest,
} from "./team-update-manifest.mjs";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const tag = "team-desktop-v0.5.29-team.1";
const fixturePublicKey = Buffer.from(
  "test-only public key placeholder",
).toString("base64");

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "buzz-team-release-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, "scripts"));
  mkdirSync(path.join(cwd, "src-tauri"));
  for (const file of [
    "scripts/prepare-team-release.mjs",
    "scripts/set-version-from-tag.mjs",
    "scripts/build-release-config.mjs",
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.windows.conf.json",
  ])
    copyFileSync(path.join(desktopRoot, file), path.join(cwd, file));
  const env = {
    ...process.env,
    GITHUB_REPOSITORY: TEAM_REPOSITORY,
    GITHUB_ENV: path.join(cwd, "github-env"),
    GITHUB_OUTPUT: path.join(cwd, "github-output"),
    BUZZ_UPDATER_PUBLIC_KEY: fixturePublicKey,
    // Deliberately wrong inherited endpoint: it must never leak into the build.
    BUZZ_UPDATER_ENDPOINT:
      "https://github.com/block/buzz/releases/download/buzz-desktop-latest/latest.json",
  };
  const run = (inputTag = tag, overrides = {}) =>
    spawnSync(
      process.execPath,
      ["scripts/prepare-team-release.mjs", inputTag],
      { cwd, env: { ...env, ...overrides }, encoding: "utf8" },
    );
  const json = (name) => JSON.parse(readFileSync(path.join(cwd, name), "utf8"));
  return { cwd, env, run, json };
}

test("updater endpoint belongs only to the team fork", () => {
  assert.equal(TEAM_REPOSITORY, "TeacherChae/buzz-teacherchae");
  assert.equal(
    TEAM_UPDATER_ENDPOINT,
    "https://github.com/TeacherChae/buzz-teacherchae/releases/download/team-desktop-latest/latest.json",
  );
});

test("team version preserves numeric prerelease ordering", () => {
  assert.equal(versionFromTeamTag(tag), "0.5.29-team.1");
  assert.equal(
    versionFromTeamTag("team-desktop-v0.5.29-team.10"),
    "0.5.29-team.10",
  );
});

for (const invalid of [
  "desktop-v0.5.29",
  "team-desktop-latest",
  "team-desktop-v0.5.29",
  "team-desktop-v00.5.29-team.1",
  "team-desktop-v0.5.29-team.01",
  "team-desktop-v0.5.29-team.1;echo unsafe",
  "team-desktop-v0.5.29-team.1\n",
]) {
  test(`reject invalid release tag: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => versionFromTeamTag(invalid), /Expected a tag/);
  });
}

test("CLI updates versions but preserves the existing app and sidecars", (t) => {
  const f = fixture(t);
  const before = f.json("src-tauri/tauri.conf.json");
  const windowsBefore = f.json("src-tauri/tauri.windows.conf.json");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.json("package.json").version, "0.5.29-team.1");
  const after = f.json("src-tauri/tauri.conf.json");
  assert.deepEqual(after, { ...before, version: "0.5.29-team.1" });
  assert.deepEqual(f.json("src-tauri/tauri.windows.conf.json"), windowsBefore);
  assert.match(
    readFileSync(path.join(f.cwd, "src-tauri/Cargo.toml"), "utf8"),
    /version = "0\.5\.29-team\.1"/,
  );
  const release = f.json("src-tauri/tauri.release.conf.json");
  assert.deepEqual(release.plugins.updater, {
    pubkey: fixturePublicKey,
    endpoints: [TEAM_UPDATER_ENDPOINT],
  });
  assert.equal(release.bundle.createUpdaterArtifacts, false);
  assert.equal(release.bundle.macOS.signingIdentity, "-");
  assert.equal(release.bundle.macOS.minimumSystemVersion, "11.0");
  assert.equal(Object.hasOwn(release.bundle, "externalBin"), false);
  assert.equal(Object.hasOwn(release, "build"), false);
  assert.equal(Object.hasOwn(release, "identifier"), false);
  assert.equal(
    readFileSync(f.env.GITHUB_ENV, "utf8"),
    `BUZZ_UPDATER_PUBLIC_KEY=${fixturePublicKey}\nBUZZ_UPDATER_ENDPOINT=${TEAM_UPDATER_ENDPOINT}\n`,
  );
  assert.equal(
    readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
    "version=0.5.29-team.1\n",
  );
});

for (const [name, env] of [
  ["wrong repository", { GITHUB_REPOSITORY: "block/buzz" }],
  ["missing public key", { BUZZ_UPDATER_PUBLIC_KEY: "" }],
  ["multiline public key", { BUZZ_UPDATER_PUBLIC_KEY: "YWJj\nINJECTED=1" }],
]) {
  test(`${name} fails before changing any manifests`, (t) => {
    const f = fixture(t);
    const before = readFileSync(path.join(f.cwd, "package.json"), "utf8");
    assert.notEqual(f.run(tag, env).status, 0);
    assert.equal(
      readFileSync(path.join(f.cwd, "package.json"), "utf8"),
      before,
    );
    assert.equal(existsSync(f.env.GITHUB_ENV), false);
    assert.equal(
      existsSync(path.join(f.cwd, "src-tauri/tauri.release.conf.json")),
      false,
    );
  });
}

test("a different app identity is not silently replaced", (t) => {
  const f = fixture(t);
  const base = f.json("src-tauri/tauri.conf.json");
  base.identifier = "test.different.app";
  writeFileSync(
    path.join(f.cwd, "src-tauri/tauri.conf.json"),
    JSON.stringify(base),
  );
  assert.notEqual(f.run().status, 0);
  assert.equal(
    existsSync(path.join(f.cwd, "src-tauri/tauri.release.conf.json")),
    false,
  );
});

test("workflow only builds explicit team tags with read-only repository access", () => {
  const workflow = parse(
    readFileSync(
      new URL(
        "../../.github/workflows/team-desktop-build.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.on, { push: { tags: ["team-desktop-v*"] } });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.build;
  assert.equal(job.if, "github.repository == 'TeacherChae/buzz-teacherchae'");
  assert.equal(job["timeout-minutes"], 120);
  assert.deepEqual(job.strategy.matrix.include, [
    { os: "windows-2025", target: "x86_64-pc-windows-msvc" },
    { os: "macos-15", target: "aarch64-apple-darwin" },
  ]);
  assert.equal(Object.hasOwn(job.env, "TAURI_SIGNING_PRIVATE_KEY"), false);
  const checkout = job.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with["persist-credentials"], false);
  assert.match(checkout.with.ref, /^\$\{\{ github\.sha \}\}$/);
  assert.ok(
    job.steps.some(
      (step) =>
        step.run ===
        "git merge-base --is-ancestor HEAD origin/team/custom-desktop",
    ),
  );
  const builders = job.steps.filter((step) =>
    step.run?.includes("pnpm tauri build"),
  );
  assert.equal(builders.length, 2);
  for (const builder of builders) {
    assert.doesNotMatch(builder.run, /pnpm exec tauri|--no-sign/);
  }
  assert.match(
    builders.find((step) => step.if.includes("macOS")).run,
    /--features mesh-llm/,
  );
  assert.doesNotMatch(
    JSON.stringify(job),
    /TAURI_SIGNING_PRIVATE_KEY|environment/,
  );
  for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    assert.doesNotMatch(step.run ?? "", /gh release|git push|latest\.json/);
  }
  const upload = job.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.equal(upload.with.path, "team-artifacts/");
  assert.equal(upload.with["retention-days"], 7);
});

test("private key reaches only the approved sign job; only publish can write", () => {
  const { jobs } = parse(
    readFileSync(
      new URL(
        "../../.github/workflows/team-desktop-build.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(jobs), ["build", "gate", "sign", "publish"]);
  for (const [name, job] of Object.entries(jobs)) {
    const text = JSON.stringify(job);
    assert.equal(/TAURI_SIGNING_PRIVATE_KEY/.test(text), name === "sign");
    assert.equal(Object.hasOwn(job, "environment"), name === "sign");
    assert.equal(job.permissions?.contents === "write", name === "publish");
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (name !== "publish") {
        assert.doesNotMatch(step.run ?? "", /gh release|git push/);
      }
    }
  }

  // The gate must run first and must not name the environment as a job
  // setting, or GitHub would create it unprotected.
  assert.equal(jobs.gate.if, jobs.build.if);
  assert.match(
    jobs.gate.steps[0].run,
    /environments\/team-desktop-release[\s\S]*required_reviewers/,
  );
  assert.deepEqual(jobs.sign.needs, ["build", "gate"]);
  assert.equal(jobs.sign.environment, "team-desktop-release");
  assert.equal(jobs.publish.needs, "sign");

  // Secrets are scoped to the signing step, after a script-free install.
  const signSteps = jobs.sign.steps;
  const withKey = signSteps.filter(
    (step) => step.env?.TAURI_SIGNING_PRIVATE_KEY,
  );
  assert.equal(withKey.length, 1);
  assert.match(withKey[0].run, /tauri signer sign/);
  assert.equal(jobs.sign.env.TAURI_SIGNING_PRIVATE_KEY, undefined);
  const install = signSteps.find((step) => step.run?.includes("pnpm install"));
  assert.match(install.run, /--frozen-lockfile --ignore-scripts/);
  assert.ok(signSteps.indexOf(install) < signSteps.indexOf(withKey[0]));
  assert.ok(signSteps.some((step) => step.run?.includes("minisign -V")));

  // The channel moves last, after validation and after assets are reachable.
  const runs = jobs.publish.steps.map((step) => step.run ?? "");
  const validate = runs.findIndex((run) =>
    run.includes("team-update-manifest.mjs"),
  );
  const release = runs.findIndex((run) => run.includes("curl --fail"));
  const channel = runs.findIndex((run) =>
    run.includes("gh release upload team-desktop-latest latest.json"),
  );
  assert.ok(validate >= 0 && validate < release && release < channel);
  assert.equal(channel, runs.length - 1);
  assert.equal(jobs.publish.concurrency["cancel-in-progress"], false);
});

test("update manifest must be complete, from this tag, and never older", () => {
  const nextTag = "team-desktop-v0.5.30-team.2";
  const base = `https://github.com/${TEAM_REPOSITORY}/releases/download/${nextTag}/`;
  const manifest = () => ({
    version: "0.5.30-team.2",
    platforms: {
      "darwin-aarch64": { signature: "a", url: `${base}Buzz.app.tar.gz` },
      "windows-x86_64": { signature: "b", url: `${base}Buzz-setup.exe` },
    },
  });
  const broken = (change) => {
    const value = manifest();
    change(value);
    return value;
  };

  assert.equal(validateTeamManifest(manifest(), nextTag), "0.5.30-team.2");
  for (const current of ["0.5.30-team.1", "0.5.30-team.2", "0.5.29-team.9"]) {
    validateTeamManifest(manifest(), nextTag, { version: current });
  }
  for (const current of ["0.5.30-team.10", "0.5.31-team.1", "0.5.30"]) {
    assert.throws(() =>
      validateTeamManifest(manifest(), nextTag, { version: current }),
    );
  }
  for (const change of [
    (m) => {
      m.version = "0.5.30-team.1";
    },
    (m) => {
      delete m.platforms["windows-x86_64"];
    },
    (m) => {
      m.platforms["linux-x86_64"] = m.platforms["darwin-aarch64"];
    },
    (m) => {
      m.platforms["darwin-aarch64"].signature = " ";
    },
    (m) => {
      m.platforms["windows-x86_64"].url =
        "https://github.com/block/buzz/releases/download/x/Buzz-setup.exe";
    },
    (m) => {
      m.platforms["windows-x86_64"].url = `${base}../other/Buzz-setup.exe`;
    },
  ]) {
    assert.throws(() => validateTeamManifest(broken(change), nextTag));
  }
  assert.ok(compareTeamVersions("0.5.30-team.10", "0.5.30-team.9") > 0);
});
