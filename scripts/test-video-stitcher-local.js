/**
 * Local Test Script for Railway Video Stitcher
 *
 * This script tests the FFmpeg stitching logic locally without SQS.
 *
 * Usage:
 *   node scripts/test-video-stitcher-local.js
 *
 * Prerequisites:
 *   - FFmpeg installed locally (brew install ffmpeg)
 *   - Sample video files in scripts/test-videos/
 */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execSync } = require('child_process');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);

const TEST_DIR = path.join(__dirname, 'test-videos');
const OUTPUT_DIR = path.join(__dirname, 'test-output');

// Verify FFmpeg
function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    console.log('✅ FFmpeg is available');
    return true;
  } catch (error) {
    console.error('❌ FFmpeg not found. Install with: brew install ffmpeg');
    return false;
  }
}

// Create test video using FFmpeg
async function createTestVideo(outputPath, duration = 5, color = 'blue', text = 'Test') {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('color=c=' + color + ':s=640x480:d=' + duration)
      .inputFormat('lavfi')
      .input('anullsrc=r=44100:cl=stereo')
      .inputFormat('lavfi')
      .outputOptions([
        '-c:v libx264',
        '-t ' + duration,
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-shortest',
        `-vf drawtext=text='${text}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// Stitch videos using FFmpeg concat
async function stitchVideos(inputFiles, outputPath) {
  const listPath = path.join(OUTPUT_DIR, 'concat_list.txt');
  const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
  await writeFile(listPath, listContent);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy', '-movflags +faststart'])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('   FFmpeg command:', cmd.substring(0, 100) + '...');
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`   Progress: ${progress.percent.toFixed(1)}%\r`);
        }
      })
      .on('end', async () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n   ✅ Stitching complete in ${elapsed}s`);

        // Get duration
        ffmpeg.ffprobe(outputPath, (err, metadata) => {
          if (err) {
            resolve({ duration: 0, elapsed });
          } else {
            resolve({
              duration: Math.round(metadata.format.duration),
              elapsed
            });
          }
        });
      })
      .on('error', reject)
      .run();
  });
}

async function runTests() {
  console.log('\n🎬 Video Stitcher Local Tests\n');
  console.log('=' .repeat(60));

  if (!checkFfmpeg()) {
    process.exit(1);
  }

  // Create directories
  await mkdir(TEST_DIR, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Test 1: Create test videos
  console.log('\n📹 Test 1: Creating test video files...');
  const videos = [];
  const colors = ['blue', 'red', 'green'];
  for (let i = 0; i < 3; i++) {
    const videoPath = path.join(TEST_DIR, `part_${i + 1}.mp4`);
    console.log(`   Creating part ${i + 1} (${colors[i]}, 3 seconds)...`);
    await createTestVideo(videoPath, 3, colors[i], `Part ${i + 1}`);
    videos.push(videoPath);
  }
  console.log('   ✅ Created 3 test videos');

  // Test 2: Stitch 2 videos
  console.log('\n🔧 Test 2: Stitching 2 videos...');
  const output2 = path.join(OUTPUT_DIR, 'stitched_2_parts.mp4');
  const result2 = await stitchVideos(videos.slice(0, 2), output2);
  console.log(`   Output: ${output2}`);
  console.log(`   Duration: ${result2.duration}s (expected ~6s)`);
  console.log(`   ${result2.duration >= 5 ? '✅ PASSED' : '❌ FAILED'}`);

  // Test 3: Stitch 3 videos
  console.log('\n🔧 Test 3: Stitching 3 videos...');
  const output3 = path.join(OUTPUT_DIR, 'stitched_3_parts.mp4');
  const result3 = await stitchVideos(videos, output3);
  console.log(`   Output: ${output3}`);
  console.log(`   Duration: ${result3.duration}s (expected ~9s)`);
  console.log(`   ${result3.duration >= 8 ? '✅ PASSED' : '❌ FAILED'}`);

  // Test 4: Verify output files exist and have size
  console.log('\n📊 Test 4: Verifying output files...');
  const outputs = [output2, output3];
  for (const output of outputs) {
    const stats = fs.statSync(output);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   ${path.basename(output)}: ${sizeMB}MB ${stats.size > 0 ? '✅' : '❌'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Local stitcher tests complete!');
  console.log(`\nTest files in: ${OUTPUT_DIR}`);
  console.log('Play with: open ' + output3);
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up test files...');

  const dirs = [TEST_DIR, OUTPUT_DIR];
  for (const dir of dirs) {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        await unlink(path.join(dir, file));
      }
      fs.rmdirSync(dir);
      console.log(`   Removed ${dir}`);
    } catch (err) {
      // Directory doesn't exist
    }
  }
}

// Main
async function main() {
  const command = process.argv[2];

  if (command === 'cleanup') {
    await cleanup();
  } else {
    await runTests();
  }
}

main().catch(console.error);
