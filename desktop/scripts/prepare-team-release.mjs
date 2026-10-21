import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEAM_REPOSITORY = "TeacherChae/buzz-teacherchae";
export const TEAM_UPDATER_ENDPOINT = `https://github.com/${TEAM_REPOSITORY}/releases/download/team-desktop-latest/latest.json`;

/** Only explicit team prerelease tags may produce these replacement builds. */
export function versionFromTeamTag(tag) {
  const match =
    /^team-desktop-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-team\.(?:0|[1-9]\d*))$/.exec(
      tag ?? "",
    );
  if (!match) {
    throw new Error("Expected a tag such as team-desktop-v0.5.29-team.1");
  }
  return match[1];
}

/** Prepare a CI checkout, reusing upstream version and updater generators. */
export function prepareTeamRelease(
  tag,
  { cwd = process.cwd(), env = process.env } = {},
) {
  const version = versionFromTeamTag(tag);
  if (env.GITHUB_REPOSITORY !== TEAM_REPOSITORY) {
    throw new Error("Team signing is restricted to the TeacherChae fork");
  }
  const publicKey = env.BUZZ_UPDATER_PUBLIC_KEY?.trim();
  if (!publicKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
    throw new Error(
      "BUZZ_UPDATER_PUBLIC_KEY must be a nonempty single-line base64 key",
    );
  }
  const base = JSON.parse(
    readFileSync(path.join(cwd, "src-tauri/tauri.conf.json"), "utf8"),
  );
  if (
    base.productName !== "Buzz" ||
    base.identifier !== "xyz.block.buzz.app" ||
    JSON.stringify(base.plugins?.["deep-link"]?.desktop?.schemes) !== '["buzz"]'
  ) {
    throw new Error(
      "Replacement builds must retain the existing Buzz app identity",
    );
  }
  const buildEnv = {
    ...env,
    BUZZ_UPDATER_PUBLIC_KEY: publicKey,
    BUZZ_UPDATER_ENDPOINT: TEAM_UPDATER_ENDPOINT,
  };
  for (const args of [
    ["scripts/set-version-from-tag.mjs", version],
    ["scripts/build-release-config.mjs"],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd,
      env: buildEnv,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Release helper failed: ${args[0]}`);
  }
  const configPath = path.join(cwd, "src-tauri/tauri.release.conf.json");
  const release = JSON.parse(readFileSync(configPath, "utf8"));
  // Candidate builds must not consume the long-lived private updater key.
  // Produce installers now; sign/promote reviewed artifacts in a separate gate.
  release.bundle.createUpdaterArtifacts = false;
  // No Developer ID is available yet. This is NOT Apple notarization.
  release.bundle.macOS.minimumSystemVersion = "11.0";
  release.bundle.macOS.signingIdentity = "-";
  writeFileSync(configPath, `${JSON.stringify(release, null, 2)}\n`);

  // Rust build.rs needs the same public updater settings as Tauri's config.
  // Private signing credentials are deliberately not read by this helper.
  if (env.GITHUB_ENV) {
    appendFileSync(
      env.GITHUB_ENV,
      `BUZZ_UPDATER_PUBLIC_KEY=${publicKey}\nBUZZ_UPDATER_ENDPOINT=${TEAM_UPDATER_ENDPOINT}\n`,
    );
  }
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `version=${version}\n`);
  return version;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    prepareTeamRelease(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
