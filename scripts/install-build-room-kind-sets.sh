#!/usr/bin/env bash
# The Build Room starter sets per kind of build (docs/superpowers/plans/2026-10-22-build-room-question-sets.md
# step 6; notes in docs/design/build-room-host-redesign/starter-sets-by-kind.md).
#
#   AWS_PROFILE=adminaccess scripts/install-build-room-kind-sets.sh engagedev           # dry run: says what it would do
#   AWS_PROFILE=adminaccess scripts/install-build-room-kind-sets.sh engagedev --apply   # installs into Engage's library
#
# Each kind is ONE Poll set (owner, 24 Oct 2026) holding all four of the room's types:
# Ideas (open answers), Choose, Yes/No and Rate. Tagged build-room and for-<kind>, so a
# room that is making that kind of thing sees it first, and no classic picker lists it.
#
# It REPLACES the two sets per kind installed before 24 Oct ("Build Room: <Kind> questions",
# Call and Answer, and "Build Room: <Kind> pulse", Poll): once the new set is on the table
# they are switched off (scripts/retire-question-sets.js; still in the console, hidden from
# hosts). Safe to re-run: an installed set is skipped, a switched-off one is left as it is.
set -euo pipefail
TABLE="${1:?usage: $0 <table: engagedev | engagetest | engageprod> [--apply]}"
APPLY="${2:-}"
cd "$(dirname "$0")/.."
for KIND in training game document dashboard; do
  case "$KIND" in
    training)  NAME="a training site";  TITLE="Training" ;;
    game)      NAME="a game";           TITLE="Game" ;;
    document)  NAME="a document or paper"; TITLE="Document" ;;
    dashboard) NAME="a dashboard";      TITLE="Dashboard" ;;
  esac
  echo "=== $TITLE"
  node scripts/install-question-set.js "$TABLE" "sets/build-room-$KIND.csv" --type poll --title "Build Room: $TITLE" \
    --topic business-work --tags "build-room,for-$KIND" --skip-existing ${APPLY:+--apply} \
    --description "Questions that help a room steer $NAME, from who it is for to what comes next: ideas, choices, yes or no, and a 1 to 5 pulse."
  # The ids install-question-set.js gave the old pair (their titles, lowercased, letters and digits only).
  OLD="buildroom${KIND}questions buildroom${KIND}pulse"
  # shellcheck disable=SC2086
  node scripts/retire-question-sets.js "$TABLE" $OLD ${APPLY:+--apply}
done

# THE GENERAL SET (any kind of build; owner, 24 Oct: one mixed set, as for each kind). It
# replaces "Build Room starters" (Call and Answer, 17 Ideas) and "Build Room pulse" (Poll,
# 3 ratings). No for- tag: every room sees it, after the sets for its own kind.
echo "=== General"
node scripts/install-question-set.js "$TABLE" "sets/build-room-general.csv" --type poll --title "Build Room: General" \
  --topic business-work --tags "build-room" --skip-existing ${APPLY:+--apply} \
  --description "Questions for any build, from who it is for to what comes next: ideas, choices, yes or no, and a 1 to 5 pulse."
node scripts/retire-question-sets.js "$TABLE" buildroomstarters buildroompulse ${APPLY:+--apply}
