# TeacherChae desktop builds

This fork replaces the installed Buzz app; it is **not** a side-by-side app.
Keep product name `Buzz`, identifier `xyz.block.buzz.app`, and the `buzz` URL
scheme. Keep the same updater key across releases. Never commit private keys,
passwords, `.secrets/`, or generated installers.

## Release flow: build, review, approve, publish

`.github/workflows/team-desktop-build.yml` runs only when a new
`team-desktop-vX.Y.Z-team.N` tag is pushed to this fork. Ordinary branch pushes
and pull requests do not trigger it. The tagged commit must be an ancestor of
`origin/team/custom-desktop`. This does not require changing the default branch.
Never move an existing tag; fix the source and use a new version/tag instead.

One run has four jobs:

1. `build`: Windows x64 and macOS Apple Silicon installers, with no private
   secrets. Uploads a seven-day Actions artifact per platform.
2. `gate`: fails unless the `team-desktop-release` environment has a required
   reviewer. A job that names a missing environment makes GitHub create it
   unprotected, so signing is refused until the protection exists.
3. `sign`: waits for a reviewer to approve `team-desktop-release`. It then
   signs the Windows installer and the macOS app archive with the updater key
   and verifies both signatures against `BUZZ_UPDATER_PUBLIC_KEY`. It installs
   dependencies with `--ignore-scripts` and builds nothing.
4. `publish`: the only job with write access; it holds no signing secrets. It
   creates the `team-desktop-vX.Y.Z-team.N` release, validates `latest.json`,
   checks both download URLs, and only then uploads `latest.json` to the
   `team-desktop-latest` release.

Approval is the promotion decision. Download the `build` artifacts, install
and test them, and approve only then: after `publish`, every installed team
build is offered this version. To keep a build as a candidate, reject or ignore
the approval request. `publish` refuses a manifest that lacks either platform,
points outside this tag's release, or is older than the version already on the
channel.

The build uses real sidecars, upstream version/config helpers, and the
production `pnpm tauri build` wrapper. macOS retains the upstream `mesh-llm`
feature. There is no compiler cache; expect cold native compilation on each
run. Retry an infrastructure failure via GitHub's rerun operation, not by
moving the tag.

### One-time repository setup

In the fork's Settings → Environments, create `team-desktop-release`:

- Required reviewers: the release owner.
- Deployment branches and tags: selected tags, `team-desktop-v*`.
- Environment secrets: `TAURI_SIGNING_PRIVATE_KEY` (the encrypted updater
  signing-key file contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Then delete the repository-level copies of those two secrets, so no other
workflow can read them. `BUZZ_UPDATER_PUBLIC_KEY` stays a repository secret;
the unapproved `build` job needs it and it is public.

## Output and signing limitations

- Windows: NSIS `.exe` without Windows publisher signing.
- macOS: ad-hoc signed `.dmg`, plus the `.app.tar.gz` the updater installs.
- Updater `.sig` files for the `.exe` and `.app.tar.gz`, after approval.

Build artifacts and published releases are **not private**: this repository
is public.

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

## Update channel

Installed team builds read only:

`https://github.com/TeacherChae/buzz-teacherchae/releases/download/team-desktop-latest/latest.json`

The first approved run creates the `team-desktop-latest` release; until then
update checking reports an error. Do not delete that release or its tag.
Never redirect to Block's official updater as a fallback. The private updater
key must not be regenerated to repair an endpoint problem: installed builds
trust only the current public key.

Buzz's updater checks and downloads automatically but uses a user action to
install and restart; it is not a forced silent deployment. A device must be
running a team build to receive updates: official Buzz does not trust this
key. Builds from before the channel existed still point at it and update
normally.

Still required: a real team build A -> B update test on each OS. An ad-hoc
macOS app replaced by another ad-hoc build may be asked for permissions or
keychain access again.

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
