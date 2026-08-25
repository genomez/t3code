#!/usr/bin/env bash
set -euo pipefail

stable_branch="${STABLE_BRANCH:-custom-stable}"
upstream_repository="${UPSTREAM_REPOSITORY:-pingdotgg/t3code}"
fork_repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

latest_tag="$({
  gh api "repos/${upstream_repository}/releases?per_page=30" \
    --jq '[.[] | select(.prerelease == true and (.tag_name | contains("-nightly.")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty'
})"

if [[ -z "${latest_tag}" ]]; then
  echo "No upstream nightly release was found." >&2
  exit 1
fi

existing_pr="$({
  gh pr list \
    --repo "${fork_repository}" \
    --base "${stable_branch}" \
    --state open \
    --json number,title \
    --jq '[.[] | select(.title | startswith("Nightly integration:"))][0].number // empty'
})"

if [[ -n "${existing_pr}" ]]; then
  echo "An integration PR is already awaiting review: #${existing_pr}."
  echo "No newer branch was created."
  exit 0
fi

existing_issue_json="$({
  gh issue list \
    --repo "${fork_repository}" \
    --state open \
    --search 'Nightly integration conflict in:title' \
    --json number,title \
    --jq '.[0] // empty'
})"

if [[ -n "${existing_issue_json}" ]]; then
  existing_issue_title="$(printf '%s' "${existing_issue_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["title"])')"
  if [[ "${existing_issue_title}" == "Nightly integration conflict: ${latest_tag}" ]]; then
    echo "The ${latest_tag} conflict is already recorded."
    exit 0
  fi
fi

integration_branch="integration/${latest_tag#v}"
if git ls-remote --exit-code --heads origin "refs/heads/${integration_branch}" >/dev/null 2>&1; then
  echo "The remote branch ${integration_branch} already exists."
  exit 0
fi

git config user.name "T3 Nightly Integration"
git config user.email "nightly-integration@users.noreply.github.com"
git remote add nightly-upstream "https://github.com/${upstream_repository}.git"
git fetch --no-tags origin "refs/heads/${stable_branch}:refs/remotes/origin/${stable_branch}"
git fetch --no-tags nightly-upstream "refs/tags/${latest_tag}:refs/tags/${latest_tag}"
git switch --create "${integration_branch}" "refs/tags/${latest_tag}"

nightly_commit="$(git rev-parse HEAD)"
stable_commit="$(git rev-parse "refs/remotes/origin/${stable_branch}")"
merge_output="$(mktemp)"

if git merge --no-ff --no-commit "refs/remotes/origin/${stable_branch}" >"${merge_output}" 2>&1; then
  git commit -m "chore: reconcile ${latest_tag} with custom stable"
  git diff --check "refs/remotes/origin/${stable_branch}...HEAD"
  git push origin "HEAD:refs/heads/${integration_branch}"

  pr_body="$(mktemp)"
  cat >"${pr_body}" <<EOF
## Source reconciliation

- Upstream nightly: \`${latest_tag}\`
- Upstream commit: \`${nightly_commit}\`
- Promoted source before reconciliation: \`${stable_commit}\`
- Integration branch: \`${integration_branch}\`

The histories merged without textual conflicts and \`git diff --check\` passed.

## Required review

- Review every changed custom surface, especially Windows notifications and file links, Android background connection and completion attention, Fold/tablet layout, assistant artifact publication, and persistent notification content.
- Decide which upstream changes supersede local implementations and which local safeguards must remain.
- Run the maintained hard-prebuild and behavioral acceptance gates separately before any build or installation.

## Guardrails

This automation performed source reconciliation only. It did not resolve semantic conflicts, merge this PR, build, sign, install, use ADB, restart an app, change an accepted baseline, clean artifacts, or promote a candidate.
EOF

  gh pr create \
    --repo "${fork_repository}" \
    --base "${stable_branch}" \
    --head "${integration_branch}" \
    --title "Nightly integration: ${latest_tag}" \
    --body-file "${pr_body}"
  exit 0
fi

conflict_paths="$(git diff --name-only --diff-filter=U | sort)"
git merge --abort

issue_body="$(mktemp)"
cat >"${issue_body}" <<EOF
## Nightly integration stopped

- Upstream nightly: \`${latest_tag}\`
- Upstream commit: \`${nightly_commit}\`
- Promoted source: \`${stable_commit}\`

The automatic source merge found conflicts and stopped without committing or pushing a branch.

### Conflicting paths

\`\`\`text
${conflict_paths}
\`\`\`

### Required next step

Create a reviewed integration branch and resolve these conflicts with the maintained feature checklist. Do not treat a clean textual merge as behavioral acceptance.

No build, signing, installation, ADB, restart, baseline change, cleanup, or promotion was performed.
EOF

issue_title="Nightly integration conflict: ${latest_tag}"
if [[ -n "${existing_issue_json}" ]]; then
  existing_issue_number="$(printf '%s' "${existing_issue_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["number"])')"
  gh issue edit "${existing_issue_number}" \
    --repo "${fork_repository}" \
    --title "${issue_title}" \
    --body-file "${issue_body}"
else
  gh issue create \
    --repo "${fork_repository}" \
    --title "${issue_title}" \
    --body-file "${issue_body}"
fi

exit 0
