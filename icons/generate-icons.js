#!/usr/bin/env node

/**
 * Generate PNG icons from SVG using sharp library
 * 
 * Usage:
 *   npm install sharp
 *   node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
try {
  const sharp = require('sharp');
  
  const sizes = [16, 48, 128];
  const svgPath = path.join(__dirname, 'icon.svg');
  
  if (!fs.existsSync(svgPath)) {
    console.error('Error: icon.svg not found');
    process.exit(1);
  }
  
  console.log('Generating PNG icons from SVG...');
  
  sizes.forEach(async (size) => {
    const outputPath = path.join(__dirname, `icon${size}.png`);
    
    try {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${outputPath}`);
    } catch (error) {
      console.error(`✗ Error generating ${size}x${size} icon:`, error.message);
    }
  });
  
  console.log('\nDone! All icons generated successfully.');
  
} catch (error) {
  console.error('\nError: sharp library not found.');
  console.error('Please install it first: npm install sharp\n');
  console.error('Or use one of the alternative methods described in README.md');
  process.exit(1);
}
