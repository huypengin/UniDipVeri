{ pkgs, ... }:

{
  languages.dotnet = {
    enable = true;
    package = pkgs.dotnet-sdk_10;
  };

  languages.javascript = {
    enable = true;
    nodejs.enable = false;
    bun.enable = true;
  };

  # Dev database
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_18;
    initialDatabases = [
      { name = "unidipveri"; }
    ];
    settings = {
      shared_buffers = "64MB";
      effective_cache_size = "256MB";
      work_mem = "4MB";
      maintenance_work_mem = "32MB";
      max_connections = 30;
    };
  };

  # Dev proxies
  services.caddy = {
    enable = true;
    config = ''
      http://web.localhost {
        reverse_proxy 127.0.0.1:5173
      }

      http://api.localhost {
        reverse_proxy 127.0.0.1:5172
      }
    '';
  };

  # Processes
  processes.unidipveri-web = {
    cwd = "./src/UniDipVeri.Web";
    exec = "bun run dev";
  };

  processes.unidipveri-api = {
    cwd = "./";
    exec = "dotnet watch --project src/UniDipVeri.WebApi";
  };
}
