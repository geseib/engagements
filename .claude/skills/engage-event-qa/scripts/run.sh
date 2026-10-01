#!/bin/bash
# Send a JS body (stdin) to the running driver:  ./run.sh <<'JS' ... JS
curl -sS -m 600 --noproxy 127.0.0.1 -X POST --data-binary @- http://127.0.0.1:9333/
