{ pkgs }:
let
  anchor-parse-idls = pkgs.writeShellScriptBin "anchor-parse-idls"
    (builtins.readFile ./scripts/idl.sh);
in pkgs.mkShell {
  nativeBuiltInputs = (pkgs.lib.optionals pkgs.stdenv.isDarwin [
    pkgs.darwin.apple_sdk.frameworks.AppKit
    pkgs.darwin.apple_sdk.frameworks.IOKit
    pkgs.darwin.apple_sdk.frameworks.Foundation
  ]);
  buildInputs = with pkgs;
    (pkgs.lib.optionals pkgs.stdenv.isLinux ([
      # solana
      libudev
    ])) ++ [
      anchor-parse-idls
      rustup
      cargo-deps
      # cargo-watch
      gh

      # sdk
      nodejs
      yarn
      python3

      pkgconfig
      openssl
      jq
      gnused

      libiconv
    ] ++ (pkgs.lib.optionals pkgs.stdenv.isDarwin [
      pkgs.darwin.apple_sdk.frameworks.AppKit
      pkgs.darwin.apple_sdk.frameworks.IOKit
      pkgs.darwin.apple_sdk.frameworks.Foundation
    ]) ++ (pkgs.lib.optionals (pkgs.stdenv.isLinux || pkgs.stdenv.isAarch64) [
      # for some reason these two only work on m1 macs
      anchor
      spl-token-cli
    ]);
  shellHook = ''
    export PATH=$PATH:$HOME/.cargo/bin
  '';
}
