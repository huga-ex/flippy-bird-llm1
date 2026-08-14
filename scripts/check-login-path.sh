#!/bin/zsh
# Determine which login path this shell is on, for Chromium/browser work.
#
#   path 1 = `sudo -u llmagent -i` from an admin GUI terminal  -> Chrome FAILS
#   path 2 = login as llmagent directly in the GUI             -> Chrome WORKS
#
# Usage:  zsh scripts/check-login-path.sh
# Prints PATH1, PATH2, or UNKNOWN with a one-line reason.

if [[ -n ${SUDO_USER} || -n ${SUDO_UID} ]]; then
  echo "PATH1  (via sudo -u llmagent; admin GUI session context — Chrome will FAIL)"
  echo "reason: SUDO_USER=${SUDO_USER:-unset} SUDO_UID=${SUDO_UID:-unset}"
  exit 1
fi

if [[ ${TERM_PROGRAM} == Apple_Terminal && -n ${TERM_SESSION_ID} ]]; then
  echo "PATH2  (direct llmagent GUI login — Chrome will WORK)"
  echo "reason: no SUDO_* vars; TERM_PROGRAM=${TERM_PROGRAM} session=${TERM_SESSION_ID}"
  exit 0
fi

if launchctl managername 2>/dev/null | grep -q Aqua; then
  echo "PATH2  (Aqua session, no SUDO_* vars — direct GUI login)"
  echo "reason: launchctl managername=Aqua"
  exit 0
fi

echo "UNKNOWN  (not a sudo shell and no Aqua GUI session detected)"
echo "reason: SUDO_USER=${SUDO_USER:-unset} TERM_PROGRAM=${TERM_PROGRAM:-unset} managername=$(launchctl managername 2>/dev/null)"
exit 2