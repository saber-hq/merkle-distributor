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
    (pkgs.lib.optionals pkgs.stdenv.isLinux ([ libudev ])) ++ [
      anchor-0_19_0
      spl-token-cli

      anchor-parse-idls
      rustup
      cargo-deps
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
    ]);
  shellHook = ''
    export PATH=$PATH:$HOME/.cargo/bin
  '';
}
