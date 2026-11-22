#!/bin/bash
# Fill the gaps for the residents' "now vs about 5 / 10 years" view (1 seed each, as the other future years):
#  - 2031 for the single options that have no 2031 runs yet;
#  - 2036 ("in about 10 years") for today's network, both packages, the loop, the signals and the best new options.
# Waits for the machine to be less busy before each batch (other agents also run simulations).
cd "$(dirname "$0")/../.."
PY=../.venv/bin/python
export VHSIM_SUMO_TIMEOUT=2700
waitload() { while [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -gt 16 ]; do sleep 60; done; }
B() { waitload; $PY -W ignore -m vhsim.integration.batch "$@"; }
for G in moderate high; do
  B --scenarios c1a c1b c3b b4 b5 n2 n5 n6 n8 --conditions weekday_term summer_peak --year 2031 --growth $G --seeds 1 --workers 6 > data/results/batch_2031_${G}_fill.log 2>&1
done
for G in moderate high; do
  B --scenarios baseline cp c3 c4 bp b3 n1 n3 n4 n7 n9 --conditions weekday_term summer_peak --year 2036 --growth $G --seeds 1 --workers 6 > data/results/batch_2036_${G}.log 2>&1
done
echo done
