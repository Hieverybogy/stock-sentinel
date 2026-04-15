module.exports = {
  apps: [
    {
      name: 'stock-sentinel-backend',
      script: './server.js',
      cwd: __dirname, // 👉 防止路径错
      instances: 1,
      exec_mode: 'fork', // 👉 单实例更稳
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',

      env: {
        NODE_ENV: 'production',
        PORT: 7099
      },

      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      merge_logs: true, // 👉 推荐
      time: true
    }
  ]
}