#!/bin/bash
# Growth-timeline runs for the residents' site. Weekdays first (they finish), then summer days.
# Summer at high growth gridlocks (2041 high: half the day's trips done after 6 h of computing), so every
# run is capped at 45 min of wall-clock time; a run that hits the cap is recorded as a gridlock error.
cd "$(dirname "$0")/../.."
while pgrep -f 'vhsim.integration.batch' >/dev/null; do sleep 30; done
PY=../.venv/bin/python
export VHSIM_SUMO_TIMEOUT=2700
B() { $PY -W ignore -m vhsim.integration.batch "$@"; }
ALL="baseline cp c3 c4 bp b3 n1"
B --scenarios baseline cp bp b3 --conditions weekday_term --year 2051 --growth high --seeds 1 2 3 > data/results/batch_2051_high.log 2>&1
for YG in "2031 moderate" "2031 high" "2041 moderate" "2051 moderate"; do set -- $YG
  B --scenarios $ALL --conditions weekday_term --year $1 --growth $2 --seeds 1 > data/results/batch_${1}_${2}_weekday.log 2>&1
done
for Y in 2041 2051; do
  B --scenarios c3 c4 n1 --conditions weekday_term --year $Y --growth high --seeds 1 > data/results/batch_${Y}_high_weekday_timeline.log 2>&1
done
for YG in "2031 moderate" "2031 high" "2041 moderate" "2051 moderate"; do set -- $YG
  B --scenarios $ALL --conditions summer_peak --year $1 --growth $2 --seeds 1 > data/results/batch_${1}_${2}_summer.log 2>&1
done
echo done
