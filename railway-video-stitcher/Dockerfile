FROM node:18-slim

# Install FFmpeg and system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production

# Copy application code
COPY . .

# Create temp directory for video processing
RUN mkdir -p temp

# Verify FFmpeg installation
RUN ffmpeg -version && ffprobe -version

CMD ["npm", "start"]
