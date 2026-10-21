# TeacherChae desktop builds

This fork replaces the installed Buzz app; it is **not** a side-by-side app.
Keep product name `Buzz`, identifier `xyz.block.buzz.app`, and the `buzz` URL
scheme. Keep the same updater key across releases. Never commit private keys,
passwords, `.secrets/`, or generated installers.

## Current stage: build candidates, do not promote

`.github/workflows/team-desktop-build.yml` runs only when a new
`team-desktop-vX.Y.Z-team.N` tag is pushed to this fork. Ordinary branch pushes
and pull requests do not trigger it. The tagged commit must be an ancestor of
`origin/team/custom-desktop`. This does not require changing the default branch.

After reviewing, testing, committing, and pushing the packaging changes, the
first proposed candidate is `team-desktop-v0.5.29-team.1`. Do **not** create that
tag until the packaging patch is approved. Never move an existing candidate
tag; fix the source and use a new version/tag instead.

The build uses Windows x64 and macOS Apple Silicon runners, real sidecars,
upstream version/config helpers, and the production `pnpm tauri build` wrapper.
macOS retains the upstream `mesh-llm` feature. This first workflow deliberately
has no compiler cache; expect cold native compilation on each run. Retry an
infrastructure failure via GitHub's rerun operation, not by moving the tag.

The existing repository Actions secrets are:

- `BUZZ_UPDATER_PUBLIC_KEY`: updater verification key (public).
- `TAURI_SIGNING_PRIVATE_KEY`: encrypted updater signing-key file contents.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key's password.

The helper changes version files only in the ephemeral CI checkout, generates
a CI-only `tauri.release.conf.json`, and passes the same public settings to
Rust `build.rs`. It does not change the relay, upload team data, or migrate
existing app data. The public key is the only Secret this build uses. No private updater key or
password is supplied to dependency installation, build hooks, or bundling.

## Output and signing limitations

Each successful platform job uploads a seven-day Actions artifact:

- Windows: NSIS `.exe` without Windows publisher signing.
- macOS: ad-hoc signed `.dmg` and `.app.tar.gz` for later updater signing.
- `build-info.txt`: version, exact source commit, and target.

No updater `.sig` is produced at this stage. These artifacts are unpublished
as Releases, **not private**: signed-in users
with access to this public repository can download them. There is no release
write permission or rolling updater publication in this workflow.

The Mac ad-hoc identity `-` is not a Developer ID certificate or notarization.
Signature integrity/entitlement checks do not establish Gatekeeper approval.
macOS may require a per-app Privacy & Security approval; Windows may show an
unknown-publisher warning. Never disable OS security globally to install.

## Before installing a replacement

1. Securely back up the existing Buzz identity key and local app data. Do not
   paste the identity key into issues, logs, or this repository.
2. Quit Buzz fully before installing. Do not uninstall or delete its data as a
   routine update step. The same app ID aims to retain data; actual upgrade and
   OS-keyring behavior still need testing, especially across signing identities.
3. Install the team build manually once per device. Official Buzz does not
   trust this fork's updater key or discover this fork's update channel.
4. Confirm the relay, identity, history, notifications (popups OFF / app badge
   ON; badge OFF clears it), and compact window behavior on the actual OS.

## Update channel: not live yet

Prepared builds point only to:

`https://github.com/TeacherChae/buzz-teacherchae/releases/download/team-desktop-latest/latest.json`

This workflow intentionally does not create that endpoint. Update checking may
report an error until a separate, reviewed publication step creates it. Never
redirect to Block's official updater as a fallback. The private updater key
must not be regenerated to repair an endpoint problem.

Still required: a gated signing job, versioned installer publication, an
explicit promotion step that validates a complete Windows/Mac manifest, and a
real team build A -> B update test. Before enabling automatic signing, move the
two private signing secrets into an approval-protected GitHub Environment and
remove the repository-level copies. Branch/tag ancestry alone is not approval;
review the exact source and artifacts before permitting use of the private key. Buzz's current updater checks/downloads automatically but uses a
user action to install and restart; it is not a forced silent deployment.

## Local checks (no keys or native builds required)

```sh
pnpm --dir desktop exec node --test scripts/prepare-team-release.test.mjs
git diff --check
```

This exercises the real preparation CLI in disposable fixture directories and
checks workflow safety/target contracts. It is not proof of successful native
compilation or operating-system installation.

References verified 2026-10-21:

- [Tauri updater signing](https://v2.tauri.app/plugin/updater/#signing-updates)
- [Tauri macOS ad-hoc signing](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing)
- [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
