# StykAnimate 1.0.6 verification

Verified on Windows x64 on 2026-09-17 with Node 24.11.0 and Python 3.12.9. Release notes are generated from CHANGELOG.md.

## Builder regression

Import as new figure now captures the complete edited native figure before restoring the original session, including pose, segment lengths, bends, scale and appearance. Builder selection enforcement is suspended while resolving the exit transaction. Both existing instances remain unchanged after deleting parts and importing the edited copy.

Three unit regressions cover native, Simple and Advanced animation. The real builder UI regression passed in both development and the final packaged executable, including undo, redo and saved-document reload. Evidence: artifacts/builder-import-new/report.json and screenshots. The reporter supplied screenshots, not the original helmet document; reproduction used an authored multicolour posed figure.

## Checks

- JavaScript syntax: 1,037 files, zero errors; full unit suite: 2,202 passed.
- Cloud and website release unit suites: 69 passed.
- Builder workspace browser regression passed, including other exit choices.
- Support browser, desktop and local Workers runtime checks passed, including attachments, private replies and draft recovery.
- Desktop update service smoke passed. The isolated NSIS installer fixture downloaded, installed and relaunched successfully; it did not replace the user's installation.
- Playback quality integrity and dense-scene benchmark passed; dense after-edit sample ran at approximately 24 fps. This is a bounded local measurement, not a guarantee for all projects/devices.
- Rebuilt native frame scanner, VFW helpers, frozen sidecar and offline encoder. Sidecar verification passed.
- Final Windows Setup and Portable packages rebuilt after the builder fix and generated notes. Package verification matched 389 web assets and 20 native modules to source without synchronizing files. Packaged save/close smoke and builder regression passed.

## Website

Deployed the feedback site, support Worker, additive D1 migrations, private R2 bucket and SupportLive Durable Object. Existing production secrets were retained. Public feedback browser checks passed on desktop and mobile without submitting synthetic production reports.

The saved local admin credential was rejected by production, so authenticated production moderation was not verified; local moderation tests passed. The optional additional R2 lifecycle rule was not applied after automatic approval review rejected permanent attachment deletion. Application-managed retention remains configured.

Windows x64 is the verified release target. No physical mobile-device or macOS/Linux package validation is claimed.

## Publication

Published 2026-09-17 at 03:08:55 UTC: https://github.com/filippocalippo/styk-animate-releases/releases/tag/v1.0.6

Before publication, all five GitHub asset SHA-256 digests and the draft notes matched the tested local build. Setup is 128,411,126 bytes and Portable is 128,179,419 bytes; complete hashes are in the published SHA256SUMS.txt.

Cloudflare deployment 4b0896e1c4154c70bd43295ef65c40e5 refreshed the published release catalogue. Live download, changelog and latest-release API checks return 1.0.6. Authenticated creator configuration and inbox endpoints return 200; feedback desktop/mobile checks pass.

Private source push was rejected by GitHub (GH001): an earlier local commit contains videos/timeline-tutorial/StykAnimate - Timeline Tutorial.mp4 at 180 MB, exceeding its 100 MB limit. Release commits remain local; unrelated media/history were not rewritten. Public release publication and Cloudflare deployment succeeded independently.

The final post-publication updater check passed: electron-updater downloaded and verified the real 1.0.6 Setup installer, observed download progress, and confirmed that the packaged and current public versions both equal 1.0.6. No installer was launched against the user's installation. Two earlier visible test processes exited unexpectedly; the hidden isolated run completed successfully. Evidence: artifacts/updates/github-smoke.json and artifacts/release-1.0.6-github-update-hidden.log.
