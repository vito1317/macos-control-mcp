// Image processing utilities — screenshot optimization, coordinate grid overlay, compression
// Author: vito1317 <service@vito1317.com>

import sharp from 'sharp';
import type { CoordinateGridOptions, Rect } from '../types/index.js';

const DEFAULT_GRID_OPTIONS: CoordinateGridOptions = {
  spacing: 100,
  color: '#FF0000',
  opacity: 0.4,
  showLabels: true,
  fontSize: 12,
};

/**
 * Overlay a coordinate grid on a screenshot to help AI identify positions
 */
export async function addCoordinateGrid(
  imageBuffer: Buffer,
  options: Partial<CoordinateGridOptions> = {}
): Promise<Buffer> {
  const opts = { ...DEFAULT_GRID_OPTIONS, ...options };
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  // Build SVG overlay with grid lines and labels
  const svgParts: string[] = [];
  svgParts.push(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`);

  // Semi-transparent background for labels
  const labelBg = `rgba(0,0,0,0.6)`;
  const labelColor = '#FFFFFF';
  const lineColor = opts.color;
  const lineOpacity = opts.opacity;

  // Vertical lines
  for (let x = opts.spacing; x < width; x += opts.spacing) {
    svgParts.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${lineColor}" stroke-opacity="${lineOpacity}" stroke-width="1" stroke-dasharray="4,4"/>`
    );
    if (opts.showLabels) {
      svgParts.push(
        `<rect x="${x - 16}" y="0" width="32" height="16" fill="${labelBg}" rx="2"/>`,
        `<text x="${x}" y="12" text-anchor="middle" font-size="${opts.fontSize}" fill="${labelColor}" font-family="monospace">${x}</text>`
      );
    }
  }

  // Horizontal lines
  for (let y = opts.spacing; y < height; y += opts.spacing) {
    svgParts.push(
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${lineColor}" stroke-opacity="${lineOpacity}" stroke-width="1" stroke-dasharray="4,4"/>`
    );
    if (opts.showLabels) {
      svgParts.push(
        `<rect x="0" y="${y - 8}" width="32" height="16" fill="${labelBg}" rx="2"/>`,
        `<text x="16" y="${y + 4}" text-anchor="middle" font-size="${opts.fontSize}" fill="${labelColor}" font-family="monospace">${y}</text>`
      );
    }
  }

  // Origin label
  svgParts.push(
    `<rect x="0" y="0" width="24" height="16" fill="${labelBg}" rx="2"/>`,
    `<text x="12" y="12" text-anchor="middle" font-size="${opts.fontSize}" fill="${labelColor}" font-family="monospace">0,0</text>`
  );

  svgParts.push('</svg>');
  const svgBuffer = Buffer.from(svgParts.join('\n'));

  return sharp(imageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .toBuffer();
}

/**
 * Optimize image for AI consumption — resize and compress while maintaining readability
 */
export async function optimizeForAI(
  imageBuffer: Buffer,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: 'png' | 'jpeg' | 'webp';
  } = {}
): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number; originalSize: number; optimizedSize: number }> {
  const maxWidth = options.maxWidth ?? 1920;
  const maxHeight = options.maxHeight ?? 1080;
  const quality = options.quality ?? 80;
  const format = options.format ?? 'png';

  const metadata = await sharp(imageBuffer).metadata();
  const origWidth = metadata.width!;
  const origHeight = metadata.height!;

  let pipeline = sharp(imageBuffer);

  // Resize if larger than max dimensions
  if (origWidth > maxWidth || origHeight > maxHeight) {
    pipeline = pipeline.resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Apply format-specific compression
  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'png':
    default:
      pipeline = pipeline.png({ compressionLevel: 6 });
      break;
  }

  const optimizedBuffer = await pipeline.toBuffer();
  const newMetadata = await sharp(optimizedBuffer).metadata();

  return {
    buffer: optimizedBuffer,
    mimeType: `image/${format}`,
    width: newMetadata.width!,
    height: newMetadata.height!,
    originalSize: imageBuffer.length,
    optimizedSize: optimizedBuffer.length,
  };
}

/**
 * Crop a region from a screenshot
 */
export async function cropRegion(imageBuffer: Buffer, region: Rect): Promise<Buffer> {
  return sharp(imageBuffer)
    .extract({
      left: Math.round(region.x),
      top: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
    })
    .toBuffer();
}

/**
 * Annotate specific points on a screenshot (e.g., element centers)
 */
export async function annotatePoints(
  imageBuffer: Buffer,
  points: Array<{ x: number; y: number; label: string; color?: string }>
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const svgParts: string[] = [];
  svgParts.push(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`);

  for (const point of points) {
    const color = point.color ?? '#FF0000';
    // Circle marker
    svgParts.push(
      `<circle cx="${point.x}" cy="${point.y}" r="6" fill="${color}" fill-opacity="0.8" stroke="white" stroke-width="2"/>`,
    );
    // Label background
    const labelWidth = Math.max(point.label.length * 8 + 8, 30);
    svgParts.push(
      `<rect x="${point.x + 10}" y="${point.y - 10}" width="${labelWidth}" height="20" fill="rgba(0,0,0,0.75)" rx="4"/>`,
      `<text x="${point.x + 14}" y="${point.y + 4}" font-size="12" fill="white" font-family="monospace">${escapeXml(point.label)}</text>`
    );
  }

  svgParts.push('</svg>');
  const svgBuffer = Buffer.from(svgParts.join('\n'));

  return sharp(imageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .toBuffer();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
