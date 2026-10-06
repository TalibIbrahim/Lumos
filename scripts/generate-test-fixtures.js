/**
 * Generates the album art fixture images used by the colour extraction tests.
 * Run with: node scripts/generate-test-fixtures.js
 */
const sharp = require('sharp')
const { mkdirSync } = require('fs')
const { join } = require('path')

const out = join(__dirname, '..', 'src', '__tests__', 'fixtures', 'art')
mkdirSync(out, { recursive: true })

const fixtures = {
  // Deep blue cover with an orange sun: colourful, two clear hues
  'colorful.png': `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b2a8f"/><stop offset="1" stop-color="#1546c9"/></linearGradient></defs>
    <rect width="300" height="300" fill="url(#g)"/>
    <circle cx="200" cy="110" r="55" fill="#ff7a12"/>
    <rect y="230" width="300" height="70" fill="#0a1f66"/></svg>`,
  // Grey photo-like gradient with soft shapes: no usable colour
  'gray.png': `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <defs><radialGradient id="g"><stop offset="0" stop-color="#bdbdbd"/><stop offset="1" stop-color="#3a3a3a"/></radialGradient></defs>
    <rect width="300" height="300" fill="url(#g)"/>
    <circle cx="90" cy="90" r="40" fill="#808080"/><rect x="160" y="170" width="100" height="80" fill="#5c5c5c"/></svg>`,
  // Black and white typography cover
  'black-and-white.png': `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="300" height="300" fill="#ffffff"/>
    <rect x="0" y="0" width="150" height="300" fill="#000000"/>
    <rect x="40" y="120" width="220" height="60" fill="#ffffff"/>
    <rect x="60" y="135" width="180" height="30" fill="#000000"/></svg>`,
  // Mostly black with a small vivid red accent: black must not win
  'dark-accent.png': `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="300" height="300" fill="#050505"/>
    <rect x="110" y="110" width="80" height="80" fill="#e01020"/></svg>`
}

Promise.all(
  Object.entries(fixtures).map(([name, svg]) => sharp(Buffer.from(svg)).png().toFile(join(out, name)))
).then(() => console.log(`Wrote ${Object.keys(fixtures).length} fixtures to ${out}`))
