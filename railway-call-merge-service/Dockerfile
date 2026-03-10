# Dockerfile for Call Merge Service
# FFmpeg only - NO Gemini dependencies

FROM node:18-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Start the service
CMD ["npm", "start"]
