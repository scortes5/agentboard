#!/bin/bash
# A scripted coding agent for the README demo (scripts/demo/record-demo.js): it prints what a
# real agent shows while it works, asks for permission once and ends with a DONE line.
c() { printf '\e[%sm%s\e[0m\n' "$1" "$2"; }
step() { sleep "$1"; c "$2" "$3"; }
printf '\e[H\e[2J'
prompt=${@: -1} # the task comes last; light/heavy model arguments may come before it
task=${prompt#*] }; task=${task%%$'\n'*}; task=${task%% (Only*}
c "1;35" "> $task"
case "$prompt" in
  *coupon*)
    step 1.2 36 "● Reading src/routes/cart.js, src/models/coupon.js"
    step 1.4 36 "● Editing src/routes/cart.js  (+18 −2)"
    step 1.2 36 "● Editing test/cart.test.js  (+31)"
    step 1.0 0  " Bash command"
    c 0 "   npm test -- cart"
    c 1 " Do you want to proceed?"
    c 0 " ❯ 1. Yes"
    c 0 "   2. No, and tell me what to do differently (esc)"
    while IFS= read -rsn1 k; do [[ -z $k ]] && break; done
    step 1.0 32 "  ✓ 24 passed (cart, coupons)"
    step 0.8 0  "DONE: coupon codes apply at checkout, with tests" ;;
  *README*)
    step 1.0 36 "● Reading README.md, package.json"
    step 1.6 36 "● Editing README.md  (+22 −6)"
    step 1.4 0  "DONE: setup steps and the env variables are documented" ;;
  *)
    step 1.2 36 "● Searching for the slow query: grep -rn \"findAll\" src/"
    step 1.4 36 "● Editing src/db/orders.js  (+4 −1)  add an index on user_id"
    step 1.6 32 "  ✓ /orders p95 from 840 ms to 95 ms"
    step 0.8 0  "DONE: indexed orders.user_id; the orders page is 9x faster" ;;
esac
exec bash --norc
