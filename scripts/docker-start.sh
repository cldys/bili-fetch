#!/bin/sh
set -eu

project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_directory"

export BILIFETCH_UID="${BILIFETCH_UID:-$(id -u)}"
export BILIFETCH_GID="${BILIFETCH_GID:-$(id -g)}"
export BILIFETCH_HOST_DOWNLOADS_DIRECTORY="${BILIFETCH_HOST_DOWNLOADS_DIRECTORY:-$HOME/Downloads}"
export BILIFETCH_HOST_DATA_DIRECTORY="${BILIFETCH_HOST_DATA_DIRECTORY:-$HOME/Library/Application Support/BiliFetch}"

for directory in "$BILIFETCH_HOST_DOWNLOADS_DIRECTORY" "$BILIFETCH_HOST_DATA_DIRECTORY"; do
  case "$directory" in
    /*) ;;
    *) echo "Host directories must use absolute paths." >&2; exit 1 ;;
  esac
done

docker info --format '{{.ServerVersion}}' >/dev/null
mkdir -p "$BILIFETCH_HOST_DOWNLOADS_DIRECTORY" "$BILIFETCH_HOST_DATA_DIRECTORY"
exec docker compose up -d --build --wait "$@"
