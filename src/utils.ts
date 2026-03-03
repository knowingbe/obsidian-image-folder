import { App, TFile } from 'obsidian';
import { Point } from './types';

/**
 * Retrieves all unique tags from a file's metadata (frontmatter and inline tags).
 * @param app The Obsidian App instance.
 * @param file The file to extract tags from.
 * @returns An array of unique tag strings.
 */
export function getAllTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];
	let tags: string[] = [];
	
	// Extract inline tags (#tag)
	if (cache.tags) tags = cache.tags.map(x => x.tag);
	
	// Extract frontmatter tags (tags: [tag1, tag2])
	if (cache.frontmatter?.tags) {
		const fmTags = cache.frontmatter.tags;
		if (Array.isArray(fmTags)) tags.push(...fmTags);
		else if (typeof fmTags === 'string') tags.push(...fmTags.split(',').map(s => s.trim()));
	}
	
	// Return unique tags
	return [...new Set(tags)];
}

/**
 * Generates an SVG path string for a smooth curve through a set of points.
 * Uses Catmull-Rom splines or similar logic to smooth the polygon.
 * @param pts Array of [x, y] points.
 * @returns SVG path data string (d attribute).
 */
export function smoothPath(pts: Point[]): string {
	const n = pts.length;
	// If less than 3 points, just draw straight lines
	if (n < 3) return pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]},${p[1]}`).join(' ') + ' Z';
	
	let d = `M ${pts[0][0]},${pts[0][1]}`;
	const k = 0.33; // Tension factor for the curve
	
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n]; // Previous point
		const p1 = pts[i];             // Current point
		const p2 = pts[(i + 1) % n];   // Next point
		const p3 = pts[(i + 2) % n];   // Next next point
		
		// Calculate control points for cubic Bezier curve
		const cp1x = p1[0] + (p2[0] - p0[0]) * k;
		const cp1y = p1[1] + (p2[1] - p0[1]) * k;
		const cp2x = p2[0] - (p3[0] - p1[0]) * k;
		const cp2y = p2[1] - (p3[1] - p1[1]) * k;
		
		d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
	}
	return d + ' Z';
}

/**
 * Calculates the geometric center (centroid) of a polygon.
 * @param pts Array of [x, y] points.
 * @returns The [x, y] coordinates of the centroid.
 */
export function centroid(pts: Point[]): Point {
	if (!pts.length) return [50, 50]; // Default center if no points
	const sumX = pts.reduce((s, p) => s + p[0], 0);
	const sumY = pts.reduce((s, p) => s + p[1], 0);
	return [sumX / pts.length, sumY / pts.length];
}

/**
 * Rotates a set of points around a center point, accounting for aspect ratio.
 * @param pts Array of points to rotate.
 * @param center The center point [cx, cy].
 * @param angleDegrees The angle in degrees.
 * @param aspectRatio The width/height ratio of the container.
 * @returns New array of rotated points.
 */
export function rotatePoints(pts: Point[], center: Point, angleDegrees: number, aspectRatio: number): Point[] {
	const angleRad = angleDegrees * (Math.PI / 180);
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);
	const [cx, cy] = center;

	return pts.map(([x, y]) => {
		// Convert percentage to a coordinate system where aspect ratio is handled
		const dx = (x - cx) * aspectRatio;
		const dy = y - cy;
		
		// Rotate
		const nx = dx * cos - dy * sin;
		const ny = dx * sin + dy * cos;
		
		// Convert back to percentage
		return [(nx / aspectRatio) + cx, ny + cy];
	});
}

/**
 * Converts a mouse event to percentage coordinates relative to an element.
 * @param e The mouse event.
 * @param img The target HTML element (usually the image).
 * @returns [x, y] coordinates as percentages (0-100).
 */
export function pct(e: MouseEvent, img: HTMLElement): Point {
	const rect = img.getBoundingClientRect();
	// Clamp values between 0 and 100
	const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
	const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
	return [x, y];
}

/**
 * Generates a CSS clip-path polygon string from points.
 * @param pts Array of [x, y] points.
 * @returns CSS polygon string (e.g., "polygon(0% 0%, 100% 100%)").
 */
export function toClipPath(pts: Point[]): string {
	return 'polygon(' + pts.map(p => `${p[0]}% ${p[1]}%`).join(', ') + ')';
}

/**
 * Displays a simple confirmation modal.
 * @param title The title/message of the modal.
 * @param onOk Callback function to execute on confirmation.
 */
export function confirmModal(title: string, onOk: () => void) {
	const modal = document.body.createDiv({ cls: 'confirm-modal' });
	modal.createEl('h3', { text: title });
	const btnContainer = modal.createDiv({ cls: 'modal-btns' });
	
	btnContainer.createEl('button', { text: 'Cancel' }).onclick = () => modal.remove();
	btnContainer.createEl('button', { text: 'Confirm', cls: 'mod-warning' }).onclick = () => {
		onOk();
		modal.remove();
	};
}
