/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow external origins for development (iPhone testing)
  ...(process.env.NODE_ENV === 'development' && {
    allowedDevOrigins: [
      '10.0.0.32:3000',
      '*.ngrok.io',
      '*.ngrok-free.app',
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