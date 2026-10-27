// PM2 production configuration for Zenith backend.
//
// Server:
//   AWS EC2 Amazon Linux 2023
//
// Deploy:
//   npm run build
//   pm2 start ecosystem.config.cjs --env production

module.exports = {
  apps: [
    {
      name: 'zenith-backend',

      cwd: '/home/ec2-user/zenith-backend',

      script: 'dist/server.js',

      // t3.micro has limited memory.
      // One backend process is enough for now.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      watch: false,

      max_memory_restart: '400M',

      kill_timeout: 10000,
      wait_ready: false,

      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};