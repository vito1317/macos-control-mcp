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
 * Overlay a coordinate grid on a screenshot to help AI identify positions.
 *
 * When scaleFactor > 1 (Retina), the image is in physical pixels but coordinate
 * APIs use logical points. Grid lines are drawn at logicalCoord * scaleFactor
 * pixel positions, but labels show the logical coordinate values so AI returns
 * coordinates that can be used directly with mouse_click / CGEvent.
 */
export async function addCoordinateGrid(
  imageBuffer: Buffer,
  options: Partial<CoordinateGridOptions> = {},
  scaleFactor: number = 1
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
  const sf = scaleFactor || 1;
  const fontSize = Math.round((opts.fontSize ?? 12) * sf);

  // Vertical lines — iterate in logical coordinates, draw at physical pixel positions
  for (let logicalX = opts.spacing; logicalX * sf < width; logicalX += opts.spacing) {
    const px = Math.round(logicalX * sf);
    svgParts.push(
      `<line x1="${px}" y1="0" x2="${px}" y2="${height}" stroke="${lineColor}" stroke-opacity="${lineOpacity}" stroke-width="${sf}" stroke-dasharray="${4 * sf},${4 * sf}"/>`
    );
    if (opts.showLabels) {
      const labelW = Math.round(32 * sf);
      const labelH = Math.round(16 * sf);
      svgParts.push(
        `<rect x="${px - labelW / 2}" y="0" width="${labelW}" height="${labelH}" fill="${labelBg}" rx="2"/>`,
        `<text x="${px}" y="${Math.round(12 * sf)}" text-anchor="middle" font-size="${fontSize}" fill="${labelColor}" font-family="monospace">${logicalX}</text>`
      );
    }
  }

  // Horizontal lines — iterate in logical coordinates, draw at physical pixel positions
  for (let logicalY = opts.spacing; logicalY * sf < height; logicalY += opts.spacing) {
    const py = Math.round(logicalY * sf);
    svgParts.push(
      `<line x1="0" y1="${py}" x2="${width}" y2="${py}" stroke="${lineColor}" stroke-opacity="${lineOpacity}" stroke-width="${sf}" stroke-dasharray="${4 * sf},${4 * sf}"/>`
    );
    if (opts.showLabels) {
      const labelW = Math.round(32 * sf);
      const labelH = Math.round(16 * sf);
      svgParts.push(
        `<rect x="0" y="${py - labelH / 2}" width="${labelW}" height="${labelH}" fill="${labelBg}" rx="2"/>`,
        `<text x="${Math.round(16 * sf)}" y="${py + Math.round(4 * sf)}" text-anchor="middle" font-size="${fontSize}" fill="${labelColor}" font-family="monospace">${logicalY}</text>`
      );
    }
  }

  // Origin label
  const originW = Math.round(24 * sf);
  const originH = Math.round(16 * sf);
  svgParts.push(
    `<rect x="0" y="0" width="${originW}" height="${originH}" fill="${labelBg}" rx="2"/>`,
    `<text x="${originW / 2}" y="${Math.round(12 * sf)}" text-anchor="middle" font-size="${fontSize}" fill="${labelColor}" font-family="monospace">0,0</text>`
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
 * Annotate specific points on a screenshot (e.g., element centers).
 *
 * Points are in logical coordinates. When scaleFactor > 1 (Retina), markers
 * are drawn at logicalCoord * scaleFactor pixel positions on the physical image.
 */
export async function annotatePoints(
  imageBuffer: Buffer,
  points: Array<{ x: number; y: number; label: string; color?: string }>,
  scaleFactor: number = 1
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  const sf = scaleFactor || 1;

  const svgParts: string[] = [];
  svgParts.push(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`);

  for (const point of points) {
    const color = point.color ?? '#FF0000';
    const px = Math.round(point.x * sf);
    const py = Math.round(point.y * sf);
    const r = Math.round(6 * sf);
    const strokeW = Math.round(2 * sf);
    const fontSize = Math.round(12 * sf);
    // Circle marker
    svgParts.push(
      `<circle cx="${px}" cy="${py}" r="${r}" fill="${color}" fill-opacity="0.8" stroke="white" stroke-width="${strokeW}"/>`,
    );
    // Label background
    const labelWidth = Math.max(point.label.length * Math.round(8 * sf) + Math.round(8 * sf), Math.round(30 * sf));
    const labelHeight = Math.round(20 * sf);
    svgParts.push(
      `<rect x="${px + Math.round(10 * sf)}" y="${py - Math.round(10 * sf)}" width="${labelWidth}" height="${labelHeight}" fill="rgba(0,0,0,0.75)" rx="${Math.round(4 * sf)}"/>`,
      `<text x="${px + Math.round(14 * sf)}" y="${py + Math.round(4 * sf)}" font-size="${fontSize}" fill="white" font-family="monospace">${escapeXml(point.label)}</text>`
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
