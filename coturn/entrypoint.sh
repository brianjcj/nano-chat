#!/bin/sh
set -eu

template=/etc/coturn/turnserver.conf.template
rendered=/tmp/turnserver.conf

: "${TURN_SHARED_SECRET:?TURN_SHARED_SECRET is required}"
: "${TURN_REALM:?TURN_REALM is required}"
TURN_RELAY_MIN_PORT="${TURN_RELAY_MIN_PORT:-49160}"
TURN_RELAY_MAX_PORT="${TURN_RELAY_MAX_PORT:-49200}"

sed_escape() {
    printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

external_ip_config=""
if [ -n "${TURN_EXTERNAL_IP:-}" ]; then
    external_ip_config="external-ip=${TURN_EXTERNAL_IP}"
fi

sed \
    -e "s|__TURN_SHARED_SECRET__|$(sed_escape "$TURN_SHARED_SECRET")|g" \
    -e "s|__TURN_REALM__|$(sed_escape "$TURN_REALM")|g" \
    -e "s|__TURN_EXTERNAL_IP_CONFIG__|$(sed_escape "$external_ip_config")|g" \
    -e "s|__TURN_RELAY_MIN_PORT__|$(sed_escape "$TURN_RELAY_MIN_PORT")|g" \
    -e "s|__TURN_RELAY_MAX_PORT__|$(sed_escape "$TURN_RELAY_MAX_PORT")|g" \
    "$template" > "$rendered"

exec turnserver -c /tmp/turnserver.conf
