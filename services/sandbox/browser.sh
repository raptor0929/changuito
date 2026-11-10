#!/bin/sh
# Playwright's root-owned driver keeps its pipe; only Chromium drops privilege.
set -eu
profile=''
for arg in "$@"; do
  case "$arg" in
    --user-data-dir=/tmp/playwright_chromiumdev_profile-*) profile=${arg#--user-data-dir=} ;;
  esac
done
test -n "$profile"
test -d "$profile"
test -x "$CHROMIUM_BINARY"
# A previous driver crash must not leave another shopper's window on this display.
/usr/bin/pkill -KILL -u browser 2>/dev/null || true
/usr/bin/chown browser:browser "$profile"
# No API credential, database connection or model key enters Chromium's environment.
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME="$profile" XDG_CONFIG_HOME="$profile/.config" DISPLAY="${DISPLAY:-:99}" \
  /usr/bin/setpriv --reuid=browser --regid=browser --init-groups --bounding-set=-all --no-new-privs \
  "$CHROMIUM_BINARY" "$@"
