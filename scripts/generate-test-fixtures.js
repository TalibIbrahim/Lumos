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

// Screen frames for Screen Sync, at the 160 by 90 size the analysis uses
const screenOut = join(__dirname, '..', 'src', '__tests__', 'fixtures', 'screen')
mkdirSync(screenOut, { recursive: true })
const frame = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">${body}</svg>`
const screens = {
  // A neutral, dim street on the left; a green explosion fills the right side
  'explosion-right-green.png': frame(`
    <rect width="160" height="90" fill="#4a4743"/>
    <defs><radialGradient id="g" cx="0.85" cy="0.5" r="0.45">
      <stop offset="0" stop-color="#d8ffb0"/><stop offset="0.35" stop-color="#35e01a"/><stop offset="1" stop-color="#4a4743"/></radialGradient></defs>
    <rect x="80" width="80" height="90" fill="url(#g)"/>`),
  // A 2.39:1 film in a 16:9 frame: 11 px bars top and bottom around a warm orange scene
  'letterbox-239.png': frame(`
    <rect width="160" height="90" fill="#000000"/>
    <rect y="11" width="160" height="68" fill="#e0791f"/>
    <rect x="60" y="30" width="40" height="30" fill="#7a2e0a"/>`),
  // Saturated blue with a magenta sign
  'colorful.png': frame(`<rect width="160" height="90" fill="#1d3fd6"/><rect x="100" y="20" width="40" height="25" fill="#e01ab8"/>`),
  'gray.png': frame(`<rect width="160" height="90" fill="#808080"/><rect x="30" y="30" width="50" height="30" fill="#9a9a9a"/>`),
  'black.png': frame(`<rect width="160" height="90" fill="#000000"/>`),
  'white.png': frame(`<rect width="160" height="90" fill="#ffffff"/>`)
}

Promise.all([
  ...Object.entries(fixtures).map(([name, svg]) => sharp(Buffer.from(svg)).png().toFile(join(out, name))),
  ...Object.entries(screens).map(([name, svg]) => sharp(Buffer.from(svg)).png().toFile(join(screenOut, name)))
]).then(() => console.log(`Wrote ${Object.keys(fixtures).length + Object.keys(screens).length} fixtures`))
