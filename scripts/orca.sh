#!/bin/sh
# orca CLI を呼ぶ。PATH に orca があればそれを使い、無ければ（CI の Linux）公式リリースから
# 取ってきて .cache/orca に置く。どちらのファイルも SHA-256 を確かめてから使う。
set -eu

if command -v orca >/dev/null 2>&1; then
  exec orca "$@"
fi

if [ "$(uname -s)-$(uname -m)" != Linux-x86_64 ]; then
  echo "orca CLI が見つかりません。Orca をインストールして orca を PATH に入れてください。" >&2
  exit 1
fi

# 版を上げるときは、リリースの各ファイルの sha256 も替える
# （gh api repos/stablyai/orca/releases/tags/v<版> --jq '.assets[] | [.name, .digest]'）。
version=1.4.278
server_sha256=de38855fb18c7d641c9abb2a862b3f7325b7d75230daedcde1f48d2407130f9d
deb_sha256=d2503e0cfcf32a0ddc928a5c943ea7dc6d7c2fde749b59ba18719f7a001fb84f
release=https://github.com/stablyai/orca/releases/download/v$version

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cache="$root/.cache/orca"
dir="$cache/$version"
# orca-server の CLI は `plugin test` の実行環境（declarative/*.mjs）と `plugin types` の型
# （declarative/*.d.ts、types/*.d.ts）を自分の 4 階層上の resources/plugins に探すが、
# orca-server には入っていない。同じ版の .deb から取り出して置く。
plugins="$cache/resources/plugins"

fetch() {
  curl -fsSL --retry 3 -o "$2" "$release/$1"
  echo "$3  $2" | sha256sum -c - >/dev/null
}

# mise run check は test と build を並列に走らせるので、取ってくる間は 1 つずつにする。
mkdir -p "$cache"
exec 9>"$cache/.lock"
flock 9

if [ ! -x "$dir/bin/orca-ide" ]; then
  mkdir -p "$dir"
  fetch orca-server-linux-x64.tar.gz "$dir.tar.gz" "$server_sha256"
  tar -xzf "$dir.tar.gz" -C "$dir" --strip-components=1
  rm -f "$dir.tar.gz"
fi

if [ "$(cat "$plugins/.version" 2>/dev/null)" != "$version" ]; then
  tmp=$(mktemp -d)
  fetch "orca-ide_${version}_amd64.deb" "$tmp/orca.deb" "$deb_sha256"
  dpkg-deb --fsys-tarfile "$tmp/orca.deb" |
    tar -x -C "$tmp" --wildcards '*/plugins/declarative/*' '*/plugins/types/*'
  rm -rf "$plugins"
  for sub in declarative types; do
    mkdir -p "$plugins/$sub"
    find "$tmp" -type f -path "*/resources/plugins/$sub/*" -exec cp {} "$plugins/$sub/" \;
  done
  echo "$version" >"$plugins/.version"
  rm -rf "$tmp"
fi

exec 9>&-
exec "$dir/bin/orca-ide" "$@"
