#!/usr/bin/env bash
#
# Remove worktrees whose work has provably landed, and say why every other one
# is still standing.
#
#   scripts/worktree-cleanup.sh              dry run: prints what it WOULD do
#   scripts/worktree-cleanup.sh --apply      does it
#   scripts/worktree-cleanup.sh --apply --retire <worktree-dir-name> [...]
#   scripts/worktree-cleanup.sh --min-idle-hours 0     (default 24)
#
# WHY THIS EXISTS. On 2026-09-20 this repo had 26 worktrees and 81 local
# branches left behind by parallel sessions, three of which had fixed the same
# flaky test without knowing about each other. A session that finishes says
# "done" and leaves its worktree; nothing ever removed one.
#
# THE RULE IS DELIBERATELY NARROW. A worktree is removed only when BOTH hold:
#
#   1. its tree is clean -- no modified, staged or untracked file (ignored
#      files, which is what a node_modules clone is, do not count); and
#   2. every commit on its branch is reachable from origin/dev, judged after a
#      fetch. Never from the local `dev` ref, which lags: judging by it cost a
#      session a wrong answer on the day this was written.
#
# `--retire <name>` is for the other honest case: a branch that was
# RE-IMPLEMENTED rather than merged, so its commits will never reach dev. It is
# removed only if its tree is clean AND a tag already points at its tip, so the
# commits stay reachable after the branch is gone. The script makes that tag
# (archive/<date>/<branch>) when it is missing.
#
# AND IT MUST HAVE BEEN IDLE. A worktree a session created ten minutes ago is
# clean and sits exactly on origin/dev -- indistinguishable, by the two rules
# above, from one whose work landed last week. The first dry run of this script
# offered to delete two sessions that had just started. So nothing is touched
# unless git last wrote to it (HEAD, index or reflog) more than --min-idle-hours
# ago. Default 24; pass 0 only when you know no session is using the repo.
#
# It never passes --force to anything. A refused removal means the worktree
# holds something that exists nowhere else, and the right response is to look.

set -uo pipefail

APPLY=0
MIN_IDLE_HOURS=24
RETIRE=()
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --min-idle-hours) shift; MIN_IDLE_HOURS="$1" ;;
    --retire) shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do RETIRE+=("$1"); shift; done; continue ;;
    -h|--help) sed -n '2,37p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
cd "$ROOT" || exit 1
MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"

git fetch origin dev --quiet || { echo "fetch failed -- refusing to judge against a stale origin/dev" >&2; exit 1; }

in_retire() { local n; for n in "${RETIRE[@]:-}"; do [ "$n" = "$1" ] && return 0; done; return 1; }
say() { printf '  %-34s %-9s %s\n' "$1" "$2" "$3"; }

removed=0; kept=0
echo "origin/dev is $(git rev-parse --short origin/dev).  $([ $APPLY = 1 ] && echo APPLYING || echo 'DRY RUN -- pass --apply to act')"

while IFS=$'\t' read -r path branch; do
  [ "$path" = "$MAIN" ] && continue
  name="$(basename "$path")"

  if [ ! -d "$path" ]; then say "$name" "stale" "directory is gone; 'git worktree prune' will clear it"; continue; fi
  if [ -z "$branch" ]; then say "$name" "KEPT" "detached HEAD -- not this script's to judge"; kept=$((kept+1)); continue; fi

  dirty="$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$dirty" != "0" ]; then say "$name" "KEPT" "$dirty uncommitted file(s) on $branch"; kept=$((kept+1)); continue; fi

  # Seconds since git last wrote to this worktree. `stat -f` is BSD/macOS,
  # `stat -c` is GNU; try both so this runs in the remote container too.
  gd="$(git -C "$path" rev-parse --absolute-git-dir 2>/dev/null)"
  newest=0
  for f in "$gd/HEAD" "$gd/index" "$gd/logs/HEAD"; do
    [ -e "$f" ] || continue
    m="$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)"
    [ "$m" -gt "$newest" ] && newest="$m"
  done
  idle_h=$(( ( $(date +%s) - newest ) / 3600 ))
  if [ "$idle_h" -lt "$MIN_IDLE_HOURS" ]; then
    say "$name" "KEPT" "git wrote to it ${idle_h}h ago (< ${MIN_IDLE_HOURS}h) -- a session may be using it"; kept=$((kept+1)); continue
  fi

  ahead="$(git rev-list --count "origin/dev..$branch" 2>/dev/null || echo '?')"
  reason=""
  if [ "$ahead" = "0" ]; then
    reason="every commit is in origin/dev"
  elif in_retire "$name"; then
    tip="$(git rev-parse "$branch")"
    if [ -z "$(git tag --points-at "$tip")" ]; then
      tag="archive/$(date +%Y-%m-%d)/${branch##*/}"
      [ $APPLY = 1 ] && git tag "$tag" "$tip"
      reason="retired; $ahead commit(s) kept by tag $tag"
    else
      reason="retired; $ahead commit(s) kept by tag $(git tag --points-at "$tip" | head -1)"
    fi
  else
    say "$name" "KEPT" "$ahead commit(s) on $branch not in origin/dev"; kept=$((kept+1)); continue
  fi

  if [ $APPLY = 0 ]; then say "$name" "would go" "$reason"; removed=$((removed+1)); continue; fi

  # A symlinked node_modules points INTO the main checkout. git unlinks a
  # symlink rather than following it, but removing them first means no tool,
  # now or later, is ever one trailing slash away from the real tree.
  find "$path" -maxdepth 4 -type l -name node_modules -delete 2>/dev/null

  if git worktree remove "$path" 2>/dev/null; then
    # -D is safe here and only here: the two branches above proved the commits
    # are reachable from origin/dev or from a tag before we got this far.
    git branch -D "$branch" >/dev/null 2>&1
    say "$name" "REMOVED" "$reason"; removed=$((removed+1))
  else
    say "$name" "REFUSED" "git would not remove it without --force; look at what is in it"; kept=$((kept+1))
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{b=$2; sub("refs/heads/","",b); print p"\t"b; p=""} /^detached/{print p"\t"; p=""}')

[ $APPLY = 1 ] && git worktree prune
echo "$([ $APPLY = 1 ] && echo removed || echo 'would remove') $removed, kept $kept."
