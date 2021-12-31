{ pkgs }:
let
  anchor-parse-idls = pkgs.writeShellScriptBin "anchor-parse-idls"
    (builtins.readFile ./scripts/idl.sh);
in pkgs.buildEnv {
  name = "ci";
  paths = with pkgs;
    (pkgs.lib.optionals pkgs.stdenv.isLinux ([ libudev ])) ++ [
      anchor-0_19_0
      cargo-workspaces
      anchor-parse-idls

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
}
