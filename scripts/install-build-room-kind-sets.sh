#!/usr/bin/env bash
# The Build Room starter sets per kind of build (docs/superpowers/plans/2026-10-22-build-room-question-sets.md
# step 6; notes in docs/design/build-room-host-redesign/starter-sets-by-kind.md).
#
#   AWS_PROFILE=adminaccess scripts/install-build-room-kind-sets.sh engagedev           # dry run: says what it would do
#   AWS_PROFILE=adminaccess scripts/install-build-room-kind-sets.sh engagedev --apply   # installs into Engage's library
#
# Each kind is two sets, because a set has one type: Ideas questions (Call and Answer)
# and a pulse (Poll: 1 to 5 ratings and one choice). Both are tagged build-room and
# for-<kind>, so a room that is making that kind of thing sees them first.
set -euo pipefail
TABLE="${1:?usage: $0 <table: engagedev | engagetest | engageprod> [--apply]}"
APPLY="${2:-}"
cd "$(dirname "$0")/.."
install() { # file type title description tags
  node scripts/install-question-set.js "$TABLE" "sets/$1" --type "$2" --title "$3" --topic business-work \
    --tags "$5" --description "$4" ${APPLY:+--apply}
}
for KIND in training game document dashboard; do
  case "$KIND" in
    training)  NAME="a training site";  TITLE="Training" ;;
    game)      NAME="a game";           TITLE="Game" ;;
    document)  NAME="a document or paper"; TITLE="Document" ;;
    dashboard) NAME="a dashboard";      TITLE="Dashboard" ;;
  esac
  install "build-room-$KIND.csv" call-and-answer "Build Room: $TITLE questions" \
    "Short questions that help a room steer $NAME, from who it is for to what comes next." "build-room,for-$KIND"
  install "build-room-$KIND-pulse.csv" poll "Build Room: $TITLE pulse" \
    "A quick pulse while building $NAME: 1 needs work, 5 is great, and one choice." "build-room,for-$KIND"
done
