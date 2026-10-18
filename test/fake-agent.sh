#!/bin/bash
# A stand-in for a coding agent: asks for permission, writes a file, answers DONE, and fixes
# its work when it receives feedback.
echo "$1" | fold -w 120
if [[ "$1" == *"Review, without editing"* ]]; then echo "$1" | fold -w 120; sleep 1; echo "DONE: approved — looks fine"; exec bash --norc; fi
echo " Bash command"
echo "   touch out.txt"
echo " Do you want to proceed?"
echo " ❯ 1. Yes"
echo "   2. No, and tell me what to do differently (esc)"
while IFS= read -rsn1 k; do
  if [[ $k == $'\e' ]]; then read -rsn2 -t 0.1 rest; [[ -z "$rest" ]] && { echo "BLOCKED: rejected by the user"; exec bash --norc; }; continue; fi
  [[ -z $k ]] && break
done
echo hi > out.txt; echo "DONE: created out.txt"
while IFS= read -r line; do
  if [[ "$line" == *"failed after your change"* ]]; then echo hi2 >> out.txt; echo; echo "DONE: fixed the check"; fi
done
