import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEAM_REPOSITORY,
  versionFromTeamTag,
} from "./prepare-team-release.mjs";

/** Every promoted manifest must serve exactly the platforms the team builds. */
export const TEAM_UPDATE_PLATFORMS = ["darwin-aarch64", "windows-x86_64"];

function teamVersionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)-team\.(\d+)$/.exec(version ?? "");
  if (!match) throw new Error(`Not a team version: ${version}`);
  return match.slice(1).map(Number);
}

/** Order two `X.Y.Z-team.N` versions numerically; negative when a < b. */
export function compareTeamVersions(a, b) {
  const left = teamVersionParts(a);
  const right = teamVersionParts(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * Check a manifest before it becomes the update channel: it must describe this
 * tag, cover both platforms with signed assets of this tag's release, and never
 * move the channel to an older version than the one installed apps already see.
 */
export function validateTeamManifest(manifest, tag, current) {
  const version = versionFromTeamTag(tag);
  if (manifest?.version !== version) {
    throw new Error(`Manifest version must be ${version}`);
  }
  const platforms = Object.keys(manifest.platforms ?? {}).sort();
  if (JSON.stringify(platforms) !== JSON.stringify(TEAM_UPDATE_PLATFORMS)) {
    throw new Error(
      `Manifest must cover exactly: ${TEAM_UPDATE_PLATFORMS.join(", ")}`,
    );
  }
  const prefix = `https://github.com/${TEAM_REPOSITORY}/releases/download/${tag}/`;
  for (const platform of platforms) {
    const { signature, url } = manifest.platforms[platform];
    if (typeof signature !== "string" || signature.trim() === "") {
      throw new Error(`Missing updater signature for ${platform}`);
    }
    if (
      typeof url !== "string" ||
      !url.startsWith(prefix) ||
      !/^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length))
    ) {
      throw new Error(`${platform} must download from this tag's release`);
    }
  }
  if (current && compareTeamVersions(version, current.version) < 0) {
    throw new Error(
      `Refusing to move the update channel back from ${current.version} to ${version}`,
    );
  }
  return version;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [tag, manifestPath, currentPath] = process.argv.slice(2);
    const read = (file) => JSON.parse(readFileSync(file, "utf8"));
    validateTeamManifest(
      read(manifestPath),
      tag,
      currentPath ? read(currentPath) : undefined,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
