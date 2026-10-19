/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework on any response (incl. the partner API).
  poweredByHeader: false,
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