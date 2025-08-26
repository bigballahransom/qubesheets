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
  })
}

module.exports = nextConfig