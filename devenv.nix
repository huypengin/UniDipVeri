{ pkgs, ... }:

{
  packages = with pkgs; [
    dotnet-sdk_10
  ];
}
