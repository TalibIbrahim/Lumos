const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

async function generate() {
  const buildDir = path.resolve('build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  console.log('Generating Lumos brand app icons...');

  // 1. Generate master 1024x1024 app icon PNG
  // Designed according to Apple macOS icon grid:
  // 1024x1024 canvas with rounded squircle tile (824x824, r=185), deep graphite glass with subtle rim highlight,
  // and the glowing Lumos aperture mark centered inside.
  const appIconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" fill="none">
    <defs>
      <!-- Base glass tile shadow -->
      <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="24" stdDeviation="32" flood-color="#000000" flood-opacity="0.65" />
        <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.45" />
      </filter>

      <!-- Glass tile background gradient -->
      <linearGradient id="tileBg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#18181b" />
        <stop offset="50%" stop-color="#0f0f12" />
        <stop offset="100%" stop-color="#09090b" />
      </linearGradient>

      <!-- Specular border sheen -->
      <linearGradient id="tileBorder" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />
        <stop offset="50%" stop-color="#ffffff" stop-opacity="0.08" />
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0.02" />
      </linearGradient>

      <!-- Ambient atmosphere behind mark -->
      <radialGradient id="apertureGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fde047" stop-opacity="0.35" />
        <stop offset="45%" stop-color="#f59e0b" stop-opacity="0.16" />
        <stop offset="75%" stop-color="#d97706" stop-opacity="0.04" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
      </radialGradient>

      <!-- Collimator rim specular reflection -->
      <linearGradient id="rimGrad" x1="20%" y1="80%" x2="80%" y2="20%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.25" />
        <stop offset="45%" stop-color="#ffffff" stop-opacity="0.45" />
        <stop offset="75%" stop-color="#fed7aa" stop-opacity="0.85" />
        <stop offset="100%" stop-color="#fde047" stop-opacity="1.0" />
      </linearGradient>

      <!-- Core blackbody radiation gradient -->
      <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="25%" stop-color="#fef08a" />
        <stop offset="60%" stop-color="#f59e0b" />
        <stop offset="90%" stop-color="#d97706" />
        <stop offset="100%" stop-color="#b45309" />
      </radialGradient>

      <!-- Diffuse optical glow filter -->
      <filter id="markGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="24" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Squircle Glass Base (Apple 824x824 inside 1024, radius 185) -->
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tileBg)" filter="url(#tileShadow)" />
    <rect x="100.5" y="100.5" width="823" height="823" rx="184.5" stroke="url(#tileBorder)" stroke-width="2" />

    <!-- Top edge physical specular highlight -->
    <path d="M 285 102 L 739 102" stroke="rgba(255, 255, 255, 0.35)" stroke-width="2" stroke-linecap="round" />

    <!-- Centered Mark (centered at 512, 512, scaled 16x from 32x32: scale 16.5) -->
    <g transform="translate(512, 512) scale(16.5) translate(-16, -16)">
      <!-- Atmospheric ambient aura -->
      <circle cx="16" cy="16" r="14" fill="url(#apertureGlow)" />

      <!-- Directional emission flare into upper-right -->
      <path d="M 16 16 L 28 13.5 A 13 13 0 0 0 18.5 4 Z" fill="url(#apertureGlow)" opacity="0.8" />

      <!-- Outer Collimator Arc ('L' arc) -->
      <path
        d="M 16 4 A 12 12 0 1 0 28 16"
        stroke="url(#rimGrad)"
        stroke-width="2.5"
        stroke-linecap="round"
      />

      <!-- Radiant Emitter Core -->
      <circle cx="16" cy="16" r="4.5" fill="url(#coreGlow)" filter="url(#markGlow)" />
      <circle cx="16" cy="16" r="2.2" fill="#ffffff" />
    </g>
  </svg>
  `;

  const icon1024Path = path.join(buildDir, 'icon.png');
  await sharp(Buffer.from(appIconSvg))
    .resize(1024, 1024)
    .png()
    .toFile(icon1024Path);
  console.log('[OK] Created 1024x1024 icon.png');

  // 2. Generate multi-size icon.ico for Windows installer and runtime
  const iconPngBuffer = fs.readFileSync(icon1024Path);
  const icoBuffer = png2icons.createICO(iconPngBuffer, png2icons.BILINEAR, 0, false, true);
  if (icoBuffer) {
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
    console.log('[OK] Created multi-size icon.ico (16, 24, 32, 48, 64, 128, 256)');
  } else {
    console.error('Failed to generate icon.ico');
  }

  // 3. Generate multi-size icon.icns for macOS
  const icnsBuffer = png2icons.createICNS(iconPngBuffer, png2icons.BILINEAR, 0);
  if (icnsBuffer) {
    fs.writeFileSync(path.join(buildDir, 'icon.icns'), icnsBuffer);
    console.log('[OK] Created multi-size icon.icns (16 to 1024)');
  } else {
    console.error('Failed to generate icon.icns');
  }

  // 4. Generate dedicated mono 16/32 tray icons
  const tray16Svg = fs.readFileSync(path.resolve('src/renderer/src/assets/tray-16.svg'));
  const tray32Svg = fs.readFileSync(path.resolve('src/renderer/src/assets/tray-32.svg'));

  await sharp(tray16Svg).resize(16, 16).png().toFile(path.join(buildDir, 'tray-16.png'));
  await sharp(tray32Svg).resize(32, 32).png().toFile(path.join(buildDir, 'tray-32.png'));
  await sharp(tray16Svg).resize(16, 16).png().toFile(path.join(buildDir, 'tray-icon.png'));
  await sharp(tray32Svg).resize(32, 32).png().toFile(path.join(buildDir, 'tray-icon@2x.png'));
  console.log('[OK] Created dedicated tray PNG assets (tray-16.png, tray-32.png, tray-icon.png)');

  // 5. Also copy 512x512 and 256x256 for Linux / package references if needed
  await sharp(iconPngBuffer).resize(512, 512).png().toFile(path.join(buildDir, 'icon-512.png'));
  await sharp(iconPngBuffer).resize(256, 256).png().toFile(path.join(buildDir, 'icon-256.png'));

  console.log('All brand icon assets generated successfully in build/!');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
