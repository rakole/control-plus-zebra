const config = {
  packagerConfig: {
    asar: true
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    }
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          {
            entry: "src/main/electron-main.ts",
            config: "vite.main.config.ts"
          },
          {
            entry: "src/preload/index.ts",
            config: "vite.preload.config.ts",
            target: "preload"
          }
        ],
        renderer: [
          {
            name: "main_window",
            config: "vite.renderer.config.ts"
          }
        ]
      }
    }
  ]
};

export default config;
