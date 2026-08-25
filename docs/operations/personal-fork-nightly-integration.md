# Personal fork nightly integration

The `genomez/t3code` fork keeps the accepted custom source separate from
upstream development and prepares new nightlies for human review.

## Branch roles

- `custom-stable` is the protected source behind the currently promoted
  Windows and Android builds.
- `integration/nightly-*` branches contain one proposed upstream nightly
  reconciliation. They are never promotion records.
- `feature/android-image-viewer-bounds` owns the unfolded image-viewer bounds
  repair.
- `feature/android-selective-copy` owns selective Android message-text copy.
- `main` mirrors the upstream fork network and is not the custom release
  authority.

## Automation boundary

`.github/workflows/guarded-nightly-integration.yml` checks the newest upstream
nightly every three hours. It prepares at most one unreviewed integration PR.
If a source merge conflicts, it aborts the merge and records one conflict issue
instead of guessing at a resolution.

The workflow may fetch source, create an integration branch, run
`git diff --check`, push that branch, and open a PR or conflict issue. It may
not merge, build, sign, install, use ADB, restart an app, update an accepted
baseline, remove rollback material, clean artifacts, or promote a candidate.

## Activation checklist

1. Review and merge the automation PR into `custom-stable`.
2. Keep repository Actions disabled until the fork's inherited upstream
   workflows have been reviewed and individually disabled where they depend on
   unavailable runners, secrets, deployment targets, or third-party services.
3. Enable only the intended fork workflows, then run the nightly workflow once
   with `workflow_dispatch`.
4. Confirm the first run opens either one integration PR or one conflict issue
   and performs no build or release action.
5. Keep source reconciliation, hard prebuild, builds, installations, device or
   cross-client acceptance, and promotion as separate approvals.

## Reviewing an integration PR

Review every custom surface that the nightly touches. At minimum, reconcile
Windows notifications and file links, Android background connectivity and
completion attention, Fold/tablet layout, assistant artifact publication,
persistent notification content, and the maintained required-feature checks.

An integration PR is source evidence only. A merged PR does not authorize a
build, installation, ADB use, restart, accepted-baseline change, cleanup, or
promotion.
