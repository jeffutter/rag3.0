{
  description = "LLM Workflow Orchestration Engine";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            biome
            nodejs_22
            # For native dependencies if needed
            openssl
            pkg-config
          ];

          shellHook = ''
            echo "LLM Orchestrator Development Environment"
            echo "Bun version: $(bun --version)"
          '';
        };
      }
    );
}
