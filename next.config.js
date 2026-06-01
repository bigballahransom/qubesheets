/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strip console.* from PRODUCTION builds at compile time (keeps error + warn).
  // High-leverage, zero-runtime-risk: removes all the 📊/🎬/📡 chatter from the
  // shipped bundle without hand-editing thousands of call sites. Dev keeps every
  // log so debugging is unaffected. NOTE: this does NOT quiet `npm run dev` — the
  // dev console noise (and the EventSource/interval leak it reveals) is separate.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },
  // Allow external origins for development (iPhone testing)
  ...(process.env.NODE_ENV === 'development' && {
    allowedDevOrigins: [
      '10.0.0.32:3000',
      '*.ngrok.io',
      '*.ngrok-free.app',
      '*.ngrok-free.dev',
      'localhost:3000'
    ]
  }),
  // Webpack configuration for jszip/buffer compatibility
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve('buffer/'),
      };
    }
    return config;
  },
}

module.exports = nextConfig