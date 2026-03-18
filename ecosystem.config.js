module.exports = {
  apps: [
    {
      name: "water-billing-system",
      script: "node_modules/next/dist/bin/next",
      args: ["start", "-p", "3001"],
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10,
      min_uptime: "5s",
    },
  ],
};