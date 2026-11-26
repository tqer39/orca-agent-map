#!/bin/sh
# orca CLI を呼ぶ。PATH に orca があればそれを使い、無ければ（CI の Linux など）
# 公式リリースの orca-server を .cache/orca に取ってきて、その CLI を使う。
set -eu

if command -v orca >/dev/null 2>&1; then
  exec orca "$@"
fi

# 版を上げるときは https://github.com/stablyai/orca/releases の orca-server-sha256sums.txt の値も替える。
version=1.4.278
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) arch=x64 sha256=de38855fb18c7d641c9abb2a862b3f7325b7d75230daedcde1f48d2407130f9d ;;
  Linux-aarch64) arch=arm64 sha256=3b2480eb6ed7aa1e7021c96d089304ca714783bd23b3c2e20ee515bf8e49f6a0 ;;
  *)
    echo "orca CLI が見つかりません。Orca をインストールして orca を PATH に入れてください。" >&2
    exit 1
    ;;
esac

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
dir="$root/.cache/orca/$version-$arch"
if [ ! -x "$dir/bin/orca-ide" ]; then
  mkdir -p "$dir"
  archive="$dir.tar.gz"
  curl -fsSL -o "$archive" \
    "https://github.com/stablyai/orca/releases/download/v$version/orca-server-linux-$arch.tar.gz"
  echo "$sha256  $archive" | sha256sum -c - >/dev/null
  tar -xzf "$archive" -C "$dir" --strip-components=1
  rm -f "$archive"
fi
exec "$dir/bin/orca-ide" "$@"
