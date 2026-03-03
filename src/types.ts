/**
 * Represents a 2D point [x, y] in percentage coordinates (0-100).
 */
export type Point = [number, number];

/**
 * Represents a clickable region (hotspot) on the image map.
 */
export interface Hotspot {
	/** Unique identifier for the hotspot */
	id: string;
	/** Display name of the region */
	name: string;
	/** Vault path to the linked file or folder (can include subpath like #header) */
	path: string;
	/** Array of points defining the shape */
	points: Point[];
	/** Type of the shape */
	shapeType: 'rect' | 'ellipse' | 'polygon' | 'triangle' | 'pentagon' | 'star' | 'arrow' | 'bubble';
	/** Optional custom color for the shape border/fill */
	color?: string;
	/** If true, the linked content is embedded/previewed directly in the map instead of opening a file list */
	embed?: boolean;
	/** Temporary flag to indicate a newly created hotspot (used during editing) */
	isNew?: boolean;
}

/**
 * Plugin settings structure.
 */
export interface MeloSettings {
	/** How to display labels on hotspots */
	displayLabelType: 'name' | 'path' | 'both';
	/** Whether to show tags in the file list panel */
	showTags: boolean;
	/** Visual effect when hovering over a hotspot */
	hoverEffectType: 'none' | 'subtle' | 'high';
	/** Background color for the file list panel ('auto', hex code, or empty for default) */
	panelColor: string;
	/** If true, labels are always visible, not just on hover */
	alwaysShowLabels: boolean;
	/** Path to the profile to load automatically on startup */
	defaultProfilePath: string;
	/** Default folder where new maps are created */
	mapsFolder: string;
	/** Enable the Heads-Up Display (HUD) card on hover */
	enableHUD: boolean;
	/** Default visual style of the label tooltip (can be overridden per profile) */
	defaultHoverLabelStyle: 'default' | 'glass' | 'neon' | 'minimal' | 'comic' | 'scale' | 'fantasy';
}

/**
 * Default values for plugin settings.
 */
export const DEFAULT_SETTINGS: MeloSettings = {
	displayLabelType: 'path',
	showTags: false,
	hoverEffectType: 'subtle',
	panelColor: '',
	alwaysShowLabels: false,
	defaultProfilePath: '',
	mapsFolder: 'Melo Maps',
	enableHUD: true,
	defaultHoverLabelStyle: 'default'
};

/**
 * Sorting options for the file list panel.
 */
export const SORT_LABELS: Record<string, string> = {
	'name-az': 'File name (A to Z)',
	'name-za': 'File name (Z to A)',
	'mtime-new': 'Modified time (new to old)',
	'mtime-old': 'Modified time (old to new)',
	'ctime-new': 'Created time (new to old)',
	'ctime-old': 'Created time (old to new)'
};

export const VIEW_TYPE = 'melo-view';
export const PROFILE_TAG = 'melo-profile';
export const DEFAULT_PROFILE_FOLDER = 'Melo Maps';
