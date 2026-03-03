import { ItemView, WorkspaceLeaf, TFile, Menu, MarkdownRenderer, Component, TFolder, Notice, moment } from 'obsidian';
import MeloPlugin from '../main';
import { ProfileManager } from './ProfileManager';
import { Hotspot, Point, VIEW_TYPE, PROFILE_TAG, SORT_LABELS } from './types';
import { getAllTags, smoothPath, centroid, pct, toClipPath, confirmModal, rotatePoints } from './utils';
import { NewProfileModal, FilePreviewModal } from './Modals';
import { PathSuggest } from './PathSuggest';

/**
 * The main view class for the Melo Image Map plugin.
 * Handles rendering the image, drawing shapes, and managing interactions.
 */
export class MeloView extends ItemView {
	plugin: MeloPlugin;
	manager: ProfileManager;
	
	// Current state
	currentFile: TFile | null = null;
	currentHotspots: Hotspot[] = [];
	currentImagePath = '';
	currentHoverStyle = 'default'; // Store current profile's style
	
	// Editing state
	editMode = false;
	selectedId: string | null = null;
	editingId: string | null = null;
	drawShape: 'rect' | 'ellipse' | 'triangle' | 'arrow' | 'bubble' | null = null;
	undoStack: Point[][] = [];
	
	// Sorting state for file list
	sortType = 'ctime-new';
	
	// Color sampling canvas
	colorCanvas: HTMLCanvasElement | null = null;
	colorCtx: CanvasRenderingContext2D | null = null;
	canvasSrc = '';
	
	// HUD element reference
	hudEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MeloPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.manager = new ProfileManager(this.app, plugin);
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return 'Melo View'; }
	getIcon() { return 'map'; }

	async onOpen() {
		// Load default profile if configured
		if (!this.currentFile && this.plugin.settings.defaultProfilePath) {
			const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.defaultProfilePath);
			if (file instanceof TFile) {
				await this.loadProfile(file);
			}
		}
		this.render();
		
		// Register global keydown events for undo/redo and escape
		this.registerDomEvent(document, 'keydown', (e) => {
			if (!this.editingId) return;
			const h = this.currentHotspots.find(x => x.id === this.editingId);
			if (!h?.points) return;
			
			// Undo (Ctrl+Z / Cmd+Z)
			if (e.key === 'z' && (e.ctrlKey || e.metaKey) && this.undoStack.length > 1) {
				e.preventDefault();
				this.undoStack.pop();
				h.points = this.undoStack[this.undoStack.length - 1].map(p => [...p]);
				this.render();
			} 
			// Escape to cancel editing
			else if (e.key === 'Escape') {
				this.editingId = null;
				this.render();
			}
		});
	}

	/**
	 * Loads a profile from a Markdown file.
	 * Reads frontmatter for image path and hotspots data.
	 */
	async loadProfile(file: TFile) {
		this.currentFile = file;
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter) {
			this.currentImagePath = cache.frontmatter['image-path'] || '';
			this.currentHotspots = cache.frontmatter['hotspots'] || [];
			// Load style from profile, fallback to default setting
			this.currentHoverStyle = cache.frontmatter['hover-label-style'] || this.plugin.settings.defaultHoverLabelStyle || 'default';
		}
		this.render();
	}

	/**
	 * Saves the current hotspots to the profile file.
	 */
	async saveCurrentProfile() {
		if (this.currentFile) {
			await this.manager.updateHotspots(this.currentFile, this.currentHotspots);
		}
	}

	// #region HUD Logic
	/**
	 * Shows a Heads-Up Display (HUD) card with file details on hover.
	 */
	async showHUD(e: MouseEvent, h: Hotspot, anchor: HTMLElement) {
		if (!this.plugin.settings.enableHUD || !h.path) return;
		
		this.hideHUD();

		const file = this.app.vault.getAbstractFileByPath(h.path.split('#')[0]);
		if (!(file instanceof TFile)) return;

		this.hudEl = document.body.createDiv({ cls: 'melo-hud-card' });
		
		// Position HUD near the anchor element
		const rect = anchor.getBoundingClientRect();
		this.hudEl.style.left = `${rect.left + 20}px`;
		this.hudEl.style.top = `${rect.top}px`;

		// Header with title
		const header = this.hudEl.createDiv({ cls: 'hud-header' });
		header.createDiv({ cls: 'hud-title', text: h.name || file.basename });

		// Metadata (Date)
		const meta = this.hudEl.createDiv({ cls: 'hud-meta' });
		meta.createSpan({ cls: 'hud-date', text: moment(file.stat.mtime).format('YYYY-MM-DD') });

		// Tags
		const tags = getAllTags(this.app, file);
		if (tags.length > 0) {
			const tagContainer = this.hudEl.createDiv({ cls: 'hud-tags' });
			tags.slice(0, 3).forEach(t => tagContainer.createSpan({ cls: 'hud-tag', text: t }));
			if (tags.length > 3) tagContainer.createSpan({ cls: 'hud-tag', text: `+${tags.length - 3}` });
		}

		// Async content preview
		const contentDiv = this.hudEl.createDiv({ cls: 'hud-content' });
		contentDiv.setText('Loading...');
		
		setTimeout(async () => {
			if (!this.hudEl) return;
			try {
				const content = await this.app.vault.cachedRead(file);
				// Show first 3 lines as preview
				const lines = content.split('\n').slice(0, 3).join('\n');
				contentDiv.empty();
				MarkdownRenderer.render(this.app, lines, contentDiv, '', new Component());
			} catch (err) {
				contentDiv.setText('Failed to load content');
			}
		}, 100);
	}

	hideHUD() {
		if (this.hudEl) {
			this.hudEl.remove();
			this.hudEl = null;
		}
	}
	// #endregion

	/**
	 * Main render function. Rebuilds the entire view DOM.
	 */
	render() {
		const root = this.containerEl.children[1];
		root.empty();
		root.addClass('melo-wrapper');
		
		// Dashboard Layout
		const dash = root.createDiv({ cls: 'melo-dashboard' });
		const tools = dash.createDiv({ cls: 'melo-tools' });
		const tL = tools.createDiv({ cls: 'toolbar-left' });
		const tR = tools.createDiv({ cls: 'toolbar-right' });

		// --- Profile Selector ---
		const selContainer = tL.createDiv({ attr: { style: 'display:flex;gap:5px;align-items:center' } });
		const sel = selContainer.createEl('select', { cls: 'profile-selector' });
		
		const files = this.manager.getProfileFiles();
		const filesByFolder: Record<string, TFile[]> = {};
		const mapsFolder = this.plugin.settings.mapsFolder || 'Melo Maps';
		
		// Group profiles by folder for optgroups
		files.forEach(f => {
			let parentPath = f.parent ? f.parent.path : '/';
			if (parentPath.startsWith(mapsFolder)) {
				parentPath = parentPath.substring(mapsFolder.length);
				if (parentPath.startsWith('/')) parentPath = parentPath.substring(1);
				if (parentPath === '') parentPath = '/';
			}
			if (!filesByFolder[parentPath]) filesByFolder[parentPath] = [];
			filesByFolder[parentPath].push(f);
		});

		const sortedFolders = Object.keys(filesByFolder).sort();

		// Populate selector
		sortedFolders.forEach(folderPath => {
			const label = folderPath === '/' ? 'Root' : folderPath;
			const group = sel.createEl('optgroup', { attr: { label } });
			filesByFolder[folderPath].sort((a, b) => a.basename.localeCompare(b.basename));
			
			filesByFolder[folderPath].forEach(f => {
				const o = group.createEl('option', { text: f.basename, value: f.path });
				if (this.currentFile && f.path === this.currentFile.path) o.selected = true;
			});
		});

		sel.createEl('option', { text: '➕ Create New Map...', value: '__NEW__' });

		sel.onchange = async () => {
			if (sel.value === '__NEW__') {
				new NewProfileModal(this.app, this.plugin, async (file) => {
					await this.loadProfile(file);
					// Force refresh to update the dropdown list
					this.render();
				}).open();
				sel.value = '';
			} else if (sel.value) {
				const file = this.app.vault.getAbstractFileByPath(sel.value);
				if (file instanceof TFile) await this.loadProfile(file);
			} else {
				this.currentFile = null;
				this.render();
			}
		};

		// --- Toolbar Buttons ---
		if (this.currentFile) {
			// Edit File Button
			selContainer.createEl('button', { text: 'Edit', attr: { title: 'Open File' } }).onclick = () => {
				if (this.currentFile) this.app.workspace.getLeaf('tab').openFile(this.currentFile);
			};
			
			// Toggle Labels Button
			const labelBtn = selContainer.createEl('button', { 
				text: this.plugin.settings.alwaysShowLabels ? 'Hide Labels' : 'Show Labels', 
				attr: { title: 'Toggle Always Show Labels' } 
			});
			labelBtn.onclick = async () => {
				this.plugin.settings.alwaysShowLabels = !this.plugin.settings.alwaysShowLabels;
				await this.plugin.saveSettings();
				this.render();
			};

			// Style Selector (New)
			const styleSel = selContainer.createEl('select', { cls: 'style-selector' });
			styleSel.style.maxWidth = '120px';
			const styles = [
				{ v: 'default', l: 'Default' },
				{ v: 'glass', l: 'Glass' },
				{ v: 'neon', l: 'Neon' },
				{ v: 'minimal', l: 'Minimal' },
				{ v: 'comic', l: 'Comic' },
				{ v: 'scale', l: 'Scale' },
				{ v: 'fantasy', l: 'Fantasy' }
			];
			styles.forEach(s => {
				const o = styleSel.createEl('option', { text: s.l, value: s.v });
				if (s.v === this.currentHoverStyle) o.selected = true;
			});
			styleSel.onchange = async () => {
				this.currentHoverStyle = styleSel.value;
				if (this.currentFile) {
					await this.manager.updateProfileStyle(this.currentFile, this.currentHoverStyle);
				}
				this.render();
			};
		}

		// --- Edit Mode Controls ---
		if (this.currentFile) {
			if (!this.editMode) {
				tR.createEl('button', { text: '✏️ Edit Map', cls: 'mod-cta' }).onclick = () => {
					this.editMode = true;
					this.selectedId = null;
					this.render();
				};
			} else {
				const st = tR.createDiv({ attr: { style: 'margin-right:10px;display:flex;gap:5px' } });
				
				// Shape Picker
				const shapeBtn = st.createEl('button', { text: 'Shapes ▾' });
				shapeBtn.onclick = (e) => {
					const menu = new Menu();
					const shapes: {type: any, icon: string, label: string}[] = [
						{ type: 'rect', icon: '⬚', label: 'Rectangle' },
						{ type: 'ellipse', icon: '◯', label: 'Circle' },
						{ type: 'triangle', icon: '△', label: 'Triangle' },
						{ type: 'arrow', icon: '➜', label: 'Arrow' },
						{ type: 'bubble', icon: '🗨', label: 'Speech Bubble' }
					];
					
					shapes.forEach(s => {
						menu.addItem(item => {
							item.setTitle(s.icon + ' ' + s.label)
								.onClick(() => {
									this.drawShape = s.type;
									this.selectedId = null;
									this.render();
								});
							if (this.drawShape === s.type) item.setChecked(true);
						});
					});
					menu.showAtMouseEvent(e);
				};
				if (this.drawShape) shapeBtn.addClass('is-active');

				// Done Button (Moved closer to Shapes)
				st.createEl('button', { text: '✅ Done', cls: 'btn-done' }).onclick = async () => {
					this.editMode = false;
					this.drawShape = null;
					this.editingId = null;
					this.selectedId = null;
					await this.saveCurrentProfile();
					this.render();
				};
			}
		}

		if (!this.currentFile) {
			dash.createEl('h3', { text: 'Select or create a map to get started.' });
			return;
		}

		// --- Image Rendering ---
		const dir = this.plugin.manifest.dir || '.';
		const imgPath = this.currentImagePath || '';
		let src;
		if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
			src = imgPath;
		} else {
			const af = this.app.vault.getAbstractFileByPath(imgPath);
			src = af instanceof TFile ? this.app.vault.getResourcePath(af) : this.app.vault.adapter.getResourcePath(dir + '/' + (imgPath || 'room-bg.png'));
		}

		const box = dash.createDiv({ cls: 'melo-image-container' });
		if (this.plugin.settings.alwaysShowLabels) {
			box.addClass('always-show-labels');
		}
		const img = box.createEl('img', { cls: 'melo-bg-img', attr: { src, draggable: 'false' } });
		
		// Load image into canvas for color sampling
		if (src !== this.canvasSrc) {
			img.onload = () => {
				try {
					const c = document.createElement('canvas');
					c.width = img.naturalWidth;
					c.height = img.naturalHeight;
					const ctx = c.getContext('2d', { willReadFrequently: true });
					if (ctx) {
						ctx.drawImage(img, 0, 0);
						this.colorCanvas = c;
						this.colorCtx = ctx;
						this.canvasSrc = src;
					}
				} catch (_) {}
			};
		}

		// SVG Layer for shapes
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 100 100');
		svg.setAttribute('preserveAspectRatio', 'none');
		svg.classList.add('melo-svg-layer');
		box.appendChild(svg);
		
		// Overlay for interaction handles
		const ov = box.createDiv({ cls: 'melo-overlay' });

		// --- Drawing Logic (New Shape Creation) ---
		if (this.editMode && this.drawShape) {
			box.style.cursor = 'crosshair';
			const dSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			dSvg.setAttribute('viewBox', '0 0 100 100');
			dSvg.setAttribute('preserveAspectRatio', 'none');
			dSvg.classList.add('drawing-svg-layer');
			box.appendChild(dSvg);
			
			let dragging = false, sx = 0, sy = 0;
			let preview: SVGElement | null = null;
			const shapeType = this.drawShape;

			const onDown = (e: MouseEvent) => {
				if (e.button !== 0) return;
				const rect = img.getBoundingClientRect();
				// Check bounds
				if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
				
				e.preventDefault();
				dragging = true;
				[sx, sy] = pct(e, img);
				
				const tag = shapeType === 'rect' ? 'rect' : shapeType === 'ellipse' ? 'ellipse' : 'polygon';
				preview = document.createElementNS('http://www.w3.org/2000/svg', tag);
				preview.setAttribute('vector-effect', 'non-scaling-stroke');
				preview.style.cssText = 'stroke:#2196f3;stroke-width:2;fill:rgba(33,150,243,0.25)';
				
				// Initialize shape with 0 size to prevent flashing
				if (tag === 'polygon') {
					preview.setAttribute('points', `${sx},${sy} ${sx},${sy} ${sx},${sy}`);
				} else if (tag === 'rect') {
					preview.setAttribute('x', String(sx));
					preview.setAttribute('y', String(sy));
					preview.setAttribute('width', '0');
					preview.setAttribute('height', '0');
				} else if (tag === 'ellipse') {
					preview.setAttribute('cx', String(sx));
					preview.setAttribute('cy', String(sy));
					preview.setAttribute('rx', '0');
					preview.setAttribute('ry', '0');
				}

				dSvg.appendChild(preview);
			};

			const onMove = (e: MouseEvent) => {
				if (!dragging || !preview) return;
				e.preventDefault();
				const [cx, cy] = pct(e, img);
				
				// Calculate bounding box
				const x1 = Math.min(sx, cx), y1 = Math.min(sy, cy);
				const w = Math.abs(cx - sx), h = Math.abs(cy - sy);
				const x2 = Math.max(sx, cx);
				const y2 = Math.max(sy, cy);
				
				// Direction flags
				const isRight = cx >= sx;
				const isDown = cy >= sy;

				// Update preview shape based on type
				if (shapeType === 'rect') {
					preview.setAttribute('x', String(x1));
					preview.setAttribute('y', String(y1));
					preview.setAttribute('width', String(w));
					preview.setAttribute('height', String(h));
				} else if (shapeType === 'ellipse') {
					preview.setAttribute('cx', String(x1 + w / 2));
					preview.setAttribute('cy', String(y1 + h / 2));
					preview.setAttribute('rx', String(w / 2));
					preview.setAttribute('ry', String(h / 2));
				} else if (shapeType === 'arrow') {
					// Directional Arrow Logic (4 directions)
					const ax1 = sx, ay1 = sy, ax2 = cx, ay2 = cy;
					const aw = Math.abs(ax2 - ax1), ah = Math.abs(ay2 - ay1);
					
					let pts: Point[] = [];
					
					if (aw > ah) {
						// Horizontal Arrow
						const my = ay1 + (ay2 - ay1) / 2;
						const tailThick = Math.min(ah * 0.4, aw * 0.3); 
						const headBack = isRight ? ax2 - Math.min(aw * 0.4, ah) : ax2 + Math.min(aw * 0.4, ah);
						
						pts = [
							[ax1, ay1 + (ah - tailThick)/2], // Tail top-left
							[headBack, ay1 + (ah - tailThick)/2], // Head back top
							[headBack, ay1], // Head top wing
							[ax2, my], // Tip
							[headBack, ay2], // Head bottom wing
							[headBack, ay2 - (ah - tailThick)/2], // Head back bottom
							[ax1, ay2 - (ah - tailThick)/2] // Tail bottom-left
						];
					} else {
						// Vertical Arrow
						const mx = ax1 + (ax2 - ax1) / 2;
						const tailThick = Math.min(aw * 0.4, ah * 0.3);
						const headBack = isDown ? ay2 - Math.min(ah * 0.4, aw) : ay2 + Math.min(ah * 0.4, aw);
						
						pts = [
							[ax1 + (aw - tailThick)/2, ay1], // Tail top-left
							[ax1 + (aw - tailThick)/2, headBack], // Tail bottom-left (at head)
							[ax1, headBack], // Head left wing
							[mx, ay2], // Tip
							[ax2, headBack], // Head right wing
							[ax2 - (aw - tailThick)/2, headBack], // Tail bottom-right (at head)
							[ax2 - (aw - tailThick)/2, ay1] // Tail top-right
						];
					}
					
					preview.setAttribute('points', pts.map((p: Point) => `${p[0]},${p[1]}`).join(' '));

				} else if (shapeType === 'bubble') {
					// Improved Speech Bubble Logic
					const tailH = h * 0.3;
					const tailW = w * 0.2;
					const bodyH = h - tailH;
					
					const pts = [
						[x1, y1], [x2, y1], [x2, y1 + bodyH], 
						[x1 + w * 0.5 + tailW, y1 + bodyH],
						[x1 + w * 0.5, y2], // Tail tip
						[x1 + w * 0.5 - tailW, y1 + bodyH],
						[x1, y1 + bodyH]
					];
					preview.setAttribute('points', pts.map((p: Point) => `${p[0]},${p[1]}`).join(' '));
				} else {
					// Triangle (Standard bounding box)
					preview.setAttribute('points', `${x1 + w / 2},${y1} ${x1},${y1 + h} ${x1 + w},${y1 + h}`);
				}
			};

			const onUp = async (e: MouseEvent) => {
				if (!dragging) return;
				dragging = false;
				
				// Cleanup listeners
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				
				const [cx, cy] = pct(e, img);
				const x1 = Math.min(sx, cx), x2 = Math.max(sx, cx), y1 = Math.min(sy, cy), y2 = Math.max(sy, cy);
				const w = x2 - x1, h = y2 - y1;
				
				const isRight = cx >= sx;
				const isDown = cy >= sy;

				// Ignore tiny drags
				if (w < 1 && h < 1) {
					preview?.remove();
					return;
				}
				
				let pts: Point[];
				
				// Finalize shape points
				if (shapeType === 'rect') {
					pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
				} else if (shapeType === 'ellipse') {
					pts = [];
					const cr = x1 + w / 2, cc = y1 + h / 2, rx = w / 2, ry = h / 2;
					// Approximate ellipse with 16 points
					for (let i = 0; i < 16; i++) {
						const a = Math.PI * 2 * i / 16;
						pts.push([cr + rx * Math.cos(a), cc + ry * Math.sin(a)]);
					}
				} else if (shapeType === 'triangle') {
					pts = [[x1 + w / 2, y1], [x1, y2], [x2, y2]];
				} else if (shapeType === 'arrow') {
					const ax1 = sx, ay1 = sy, ax2 = cx, ay2 = cy;
					const aw = Math.abs(ax2 - ax1), ah = Math.abs(ay2 - ay1);
					
					if (aw > ah) {
						// Horizontal
						const my = ay1 + (ay2 - ay1) / 2;
						const tailThick = Math.min(ah * 0.4, aw * 0.3);
						const headBack = isRight ? ax2 - Math.min(aw * 0.4, ah) : ax2 + Math.min(aw * 0.4, ah);
						pts = [
							[ax1, ay1 + (ah - tailThick)/2],
							[headBack, ay1 + (ah - tailThick)/2],
							[headBack, ay1],
							[ax2, my],
							[headBack, ay2],
							[headBack, ay2 - (ah - tailThick)/2],
							[ax1, ay2 - (ah - tailThick)/2]
						];
					} else {
						// Vertical
						const mx = ax1 + (ax2 - ax1) / 2;
						const tailThick = Math.min(aw * 0.4, ah * 0.3);
						const headBack = isDown ? ay2 - Math.min(ah * 0.4, aw) : ay2 + Math.min(ah * 0.4, aw);
						pts = [
							[ax1 + (aw - tailThick)/2, ay1],
							[ax1 + (aw - tailThick)/2, headBack],
							[ax1, headBack],
							[mx, ay2],
							[ax2, headBack],
							[ax2 - (aw - tailThick)/2, headBack],
							[ax2 - (aw - tailThick)/2, ay1]
						];
					}
				} else if (shapeType === 'bubble') {
					const tailH = h * 0.3;
					const tailW = w * 0.2;
					const bodyH = h - tailH;
					pts = [
						[x1, y1], [x2, y1], [x2, y1 + bodyH], 
						[x1 + w * 0.5 + tailW, y1 + bodyH],
						[x1 + w * 0.5, y2], // Tail tip
						[x1 + w * 0.5 - tailW, y1 + bodyH],
						[x1, y1 + bodyH]
					];
				} else {
					pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
				}

				// Create new hotspot
				const nh: Hotspot = { 
					id: Date.now().toString(), 
					name: '', 
					path: '', 
					points: pts, 
					shapeType: shapeType as any,
					isNew: true // Mark as new for immediate editing
				};
				this.currentHotspots.push(nh);
				this.editingId = nh.id;
				this.drawShape = null;
				
				// Render immediately to avoid lag
				this.render();
				
				// Save asynchronously
				await this.saveCurrentProfile();
			};
			
			box.addEventListener('mousedown', onDown);
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		}

		// --- Render Existing Hotspots ---
		this.currentHotspots.forEach(h => {
			if (!h.points?.length) return;
			const editing = this.editingId === h.id;
			const selected = this.selectedId === h.id;
			const isEllipse = h.shapeType === 'ellipse' || h.shapeType === 'bubble';
			
			// Create SVG element
			const el = document.createElementNS('http://www.w3.org/2000/svg', isEllipse ? 'path' : 'polygon');
			el.classList.add('hotspot-shape');
			el.setAttribute('vector-effect', 'non-scaling-stroke');
			
			if (isEllipse) el.setAttribute('d', smoothPath(h.points));
			else el.setAttribute('points', h.points.map(p => `${p[0]},${p[1]}`).join(' '));
			
			// Styling based on state
			if (editing) {
				el.style.cssText = 'fill:rgba(76,175,80,0.3);stroke:#4caf50;stroke-width:1.5';
			} else if (selected) {
				el.style.cssText = 'fill:rgba(33,150,243,0.3);stroke:#2196f3;stroke-width:1.5';
			} else if (this.editMode) {
				el.style.cssText = 'fill:rgba(255,255,255,0.15);stroke:rgba(255,255,255,0.35);stroke-width:1';
			} else {
				el.style.cssText = `fill:${h.color ? h.color + '40' : 'rgba(255,255,255,0.01)'};stroke:${h.color || 'transparent'};stroke-width:${h.color ? '1' : '0'}`;
			}
			svg.appendChild(el);

			// Label Anchor
			const [cx, cy] = centroid(h.points);
			const anchor = ov.createDiv({ cls: 'hotspot-anchor' });
			anchor.style.cssText = `left:${cx}%;top:${cy}%`;
			
			// Label Text Logic
			let txt = h.name || 'Region';
			const lt = this.plugin.settings.displayLabelType;
			if (lt === 'path' && h.path) {
				const [fp, sec] = h.path.split('#', 2);
				const fname = fp.split('/').pop() || '';
				txt = sec ? sec : fname.replace(/\.[^.]+$/, '');
			} else if (lt === 'both') {
				const [fp, sec] = (h.path || '').split('#', 2);
				const fname = fp.split('/').pop() || '?';
				const short = sec ? sec : fname.replace(/\.[^.]+$/, '');
				txt = `${h.name || 'Region'} (${short})`;
			}
			
			// Only show label if NOT editing
			if (!editing) {
				const labelEl = anchor.createDiv({ cls: 'hotspot-label', text: txt });
				// Use current profile style
				labelEl.addClass(`style-${this.currentHoverStyle}`);
			}

			// --- Editing Controls (Vertex Handles) ---
			if (editing) {
				// 1. Vertex Handles
				h.points.forEach((pt, idx) => {
					const handle = ov.createDiv({ cls: 'vertex-handle' });
					handle.style.cssText = `left:${pt[0]}%;top:${pt[1]}%`;
					
					// Drag vertex logic
					handle.addEventListener('mousedown', (e) => {
						e.stopPropagation();
						e.preventDefault();
						this.undoStack.push(h.points.map(p => [...p])); // Save state for undo
						
						const onMove = (mv: MouseEvent) => {
							mv.preventDefault();
							const [nx, ny] = pct(mv, img);
							h.points[idx] = [nx, ny];
							
							// Update shape
							if (isEllipse) el.setAttribute('d', smoothPath(h.points));
							else el.setAttribute('points', h.points.map(p => `${p[0]},${p[1]}`).join(' '));
							
							// Update handle position
							handle.style.left = `${nx}%`;
							handle.style.top = `${ny}%`;
							
							// Update anchor position
							const [ncx, ncy] = centroid(h.points);
							anchor.style.left = `${ncx}%`;
							anchor.style.top = `${ncy}%`;
							
							// Update other controls
							const moveHandle = ov.querySelector('.move-handle') as HTMLElement;
							if (moveHandle) {
								moveHandle.style.left = `${ncx}%`;
								moveHandle.style.top = `${ncy}%`;
							}
							
							const rotateHandle = ov.querySelector('.rotate-handle') as HTMLElement;
							if (rotateHandle) {
								const minY = Math.min(...h.points.map(p => p[1]));
								rotateHandle.style.left = `${ncx}%`;
								rotateHandle.style.top = `${minY - 5}%`;
							}

							const btns2 = ov.querySelector('.edge-edit-btns') as HTMLElement;
							if (btns2) {
								btns2.style.top = `${Math.max(...h.points.map(p => p[1])) + 2}%`;
								btns2.style.left = `${ncx}%`;
							}
						};
						
						const onUp = () => {
							document.removeEventListener('mousemove', onMove);
							document.removeEventListener('mouseup', onUp);
							this.saveCurrentProfile();
						};
						document.addEventListener('mousemove', onMove);
						document.addEventListener('mouseup', onUp);
					});
				});
				
				// 2. Move Handle (Center)
				const moveHandle = ov.createDiv({ cls: 'move-handle' });
				moveHandle.style.cssText = `left:${cx}%;top:${cy}%`;
				moveHandle.addEventListener('mousedown', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.undoStack.push(h.points.map(p => [...p]));
					
					const [startX, startY] = pct(e, img);
					const initialPoints = h.points.map(p => [...p]);
					
					const onMove = (mv: MouseEvent) => {
						mv.preventDefault();
						const [currX, currY] = pct(mv, img);
						const dx = currX - startX;
						const dy = currY - startY;
						
						h.points = initialPoints.map(p => [p[0] + dx, p[1] + dy] as Point);
						
						// Re-render shape and handles
						if (isEllipse) el.setAttribute('d', smoothPath(h.points));
						else el.setAttribute('points', h.points.map(p => `${p[0]},${p[1]}`).join(' '));
						
						const [ncx, ncy] = centroid(h.points);
						moveHandle.style.left = `${ncx}%`;
						moveHandle.style.top = `${ncy}%`;
						
						// Update vertices
						const handles = ov.querySelectorAll('.vertex-handle');
						h.points.forEach((p, i) => {
							if (handles[i]) {
								(handles[i] as HTMLElement).style.left = `${p[0]}%`;
								(handles[i] as HTMLElement).style.top = `${p[1]}%`;
							}
						});
						
						// Update rotate handle
						const rotateHandle = ov.querySelector('.rotate-handle') as HTMLElement;
						if (rotateHandle) {
							const minY = Math.min(...h.points.map(p => p[1]));
							rotateHandle.style.left = `${ncx}%`;
							rotateHandle.style.top = `${minY - 5}%`;
						}
						
						// Update buttons
						const btns2 = ov.querySelector('.edge-edit-btns') as HTMLElement;
						if (btns2) {
							btns2.style.top = `${Math.max(...h.points.map(p => p[1])) + 2}%`;
							btns2.style.left = `${ncx}%`;
						}
					};
					
					const onUp = () => {
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
						this.saveCurrentProfile();
					};
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});

				// 3. Rotate Handle (Top)
				const minY = Math.min(...h.points.map(p => p[1]));
				const rotateHandle = ov.createDiv({ cls: 'rotate-handle' });
				rotateHandle.style.cssText = `left:${cx}%;top:${minY - 5}%`;
				
				rotateHandle.addEventListener('mousedown', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.undoStack.push(h.points.map(p => [...p]));
					
					const center = centroid(h.points);
					const rect = img.getBoundingClientRect();
					const centerX = rect.left + (center[0] / 100) * rect.width;
					const centerY = rect.top + (center[1] / 100) * rect.height;
					
					let lastAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
					
					const onMove = (mv: MouseEvent) => {
						mv.preventDefault();
						const currAngle = Math.atan2(mv.clientY - centerY, mv.clientX - centerX);
						const deltaAngle = (currAngle - lastAngle) * (180 / Math.PI);
						lastAngle = currAngle;
						
						const aspectRatio = img.width / img.height;
						h.points = rotatePoints(h.points, center, deltaAngle, aspectRatio);
						
						// Re-render
						if (isEllipse) el.setAttribute('d', smoothPath(h.points));
						else el.setAttribute('points', h.points.map(p => `${p[0]},${p[1]}`).join(' '));
						
						// Update vertices
						const handles = ov.querySelectorAll('.vertex-handle');
						h.points.forEach((p, i) => {
							if (handles[i]) {
								(handles[i] as HTMLElement).style.left = `${p[0]}%`;
								(handles[i] as HTMLElement).style.top = `${p[1]}%`;
							}
						});
						
						// Update rotate handle position
						const newMinY = Math.min(...h.points.map(p => p[1]));
						const [ncx, ncy] = centroid(h.points);
						rotateHandle.style.left = `${ncx}%`;
						rotateHandle.style.top = `${newMinY - 5}%`;
						
						// Update buttons
						const btns2 = ov.querySelector('.edge-edit-btns') as HTMLElement;
						if (btns2) {
							btns2.style.top = `${Math.max(...h.points.map(p => p[1])) + 2}%`;
							btns2.style.left = `${ncx}%`;
						}
					};
					
					const onUp = () => {
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
						this.saveCurrentProfile();
					};
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
				
				// Edit Buttons (Confirm / Delete)
				const maxY = Math.max(...h.points.map(p => p[1]));
				const btns = ov.createDiv({ cls: 'edge-edit-btns' });
				btns.style.cssText = `position:absolute;top:${maxY + 2}%;left:${cx}%;transform:translateX(-50%);z-index:2000;display:flex;gap:5px;`;
				
				btns.createEl('button', { text: '✅', cls: 'btn-confirm-icon' }).onclick = () => {
					this.editingId = null;
					if (h.isNew) {
						delete h.isNew;
						this.saveCurrentProfile();
					}
					if (!h.name) this.regionModal(h);
					else this.render();
				};
				btns.createEl('button', { text: '🗑️', cls: 'btn-delete-icon' }).onclick = () => {
					if (h.isNew) {
						this.currentHotspots.splice(this.currentHotspots.indexOf(h), 1);
						this.editingId = null;
						this.saveCurrentProfile();
						this.render();
					} else {
						confirmModal('Delete this region?', () => {
							this.currentHotspots.splice(this.currentHotspots.indexOf(h), 1);
							this.editingId = null;
							this.saveCurrentProfile();
							this.render();
						});
					}
				};
			} else {
				// --- Interaction Layer (Hit Area) ---
				const hitArea = ov.createDiv({ cls: 'hotspot-hitarea' });
				hitArea.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;clip-path:${toClipPath(h.points)};-webkit-clip-path:${toClipPath(h.points)};pointer-events:auto;cursor:pointer;z-index:1`;
				
				let wasDragging = false;

				hitArea.addEventListener('click', async (e) => {
					e.stopPropagation();
					if (wasDragging) {
						wasDragging = false;
						return;
					}
					
					if (this.editMode) {
						// Edit Mode Context Menu
						this.selectedId = h.id;
						this.render();
						const menu = new Menu();
						menu.addItem(i => i.setTitle('✏️ Edit Edges').onClick(() => {
							this.editingId = h.id;
							this.render();
						}));
						menu.addItem(i => i.setTitle('🔗 Edit Link').onClick(() => this.regionModal(h)));
						menu.addItem(i => i.setTitle('🗑️ Delete').onClick(() => confirmModal('Delete?', () => {
							this.currentHotspots.splice(this.currentHotspots.indexOf(h), 1);
							this.saveCurrentProfile();
							this.render();
						})));
						menu.showAtMouseEvent(e);
					} else {
						// View Mode Click Action
						
						// 1. Check for Embed
						if (h.embed && h.path) {
							const file = this.app.vault.getAbstractFileByPath(h.path.split('#')[0]);
							if (file instanceof TFile) {
								const content = await this.readSubpathContent(file, h.path);
								new FilePreviewModal(this.app, h.name || file.basename, content, file).open();
								return;
							}
						}

						// 2. Check for Linked Profile (Nested Map)
						const file = this.app.vault.getAbstractFileByPath(h.path.split('#')[0]);
						if (file instanceof TFile) {
							const cache = this.app.metadataCache.getFileCache(file);
							if (cache?.frontmatter && cache.frontmatter[PROFILE_TAG] === true) {
								this.loadProfile(file);
								return;
							}
						}

						// 3. Default: Show File List
						this.showFiles(h);
					}
				});

				// Hover Effects
				hitArea.addEventListener('mouseenter', (e) => {
					if (this.editMode) return;
					const hv = this.plugin.settings.hoverEffectType;
					if (hv === 'subtle') el.style.fill = 'rgba(255,255,255,0.10)';
					else if (hv === 'high') el.style.fill = 'rgba(255,255,255,0.28)';
					
					if (this.plugin.settings.alwaysShowLabels) {
						anchor.addClass('is-hovered');
					}
					anchor.addClass('is-active');

					this.showHUD(e, h, anchor);
				});
				
				hitArea.addEventListener('mouseleave', () => {
					if (this.editMode) return;
					el.style.fill = h.color ? h.color + '40' : 'rgba(255,255,255,0.01)';
					
					if (this.plugin.settings.alwaysShowLabels) {
						anchor.removeClass('is-hovered');
					}
					anchor.removeClass('is-active');

					this.hideHUD();
				});

				// Drag Entire Region (Edit Mode)
				if (this.editMode && selected && !editing) {
					let isDraggingRegion = false;
					let startX: number, startY: number;
					let initialPoints: Point[];

					hitArea.addEventListener('mousedown', (e) => {
						if (e.button !== 0) return;
						e.stopPropagation();
						e.preventDefault();

						isDraggingRegion = true;
						wasDragging = false;
						[startX, startY] = pct(e, img);
						initialPoints = h.points.map(p => [...p]);
						this.undoStack.push(h.points.map(p => [...p]));

						const onMouseMove = (mv: MouseEvent) => {
							if (!isDraggingRegion) return;
							mv.preventDefault();
							wasDragging = true;

							const [currentX, currentY] = pct(mv, img);
							const deltaX = currentX - startX;
							const deltaY = currentY - startY;

							const newPoints = initialPoints.map(p => [p[0] + deltaX, p[1] + deltaY] as Point);
							h.points = newPoints;

							if (isEllipse) el.setAttribute('d', smoothPath(h.points));
							else el.setAttribute('points', h.points.map(p => `${p[0]},${p[1]}`).join(' '));

							const [ncx, ncy] = centroid(h.points);
							anchor.style.left = `${ncx}%`;
							anchor.style.top = `${ncy}%`;
							hitArea.style.clipPath = toClipPath(h.points);
						};

						const onMouseUp = async () => {
							if (!isDraggingRegion) return;
							isDraggingRegion = false;
							document.removeEventListener('mousemove', onMouseMove);
							document.removeEventListener('mouseup', onMouseUp);
							if (wasDragging) {
								await this.saveCurrentProfile();
							}
						};

						document.addEventListener('mousemove', onMouseMove);
						document.addEventListener('mouseup', onMouseUp);
					});
				}
			}
		});
	}

	/**
	 * Reads content from a file, respecting subpaths (headings/blocks).
	 */
	async readSubpathContent(file: TFile, path: string): Promise<string> {
		const content = await this.app.vault.read(file);
		const subpath = path.split('#')[1];
		if (!subpath) return content;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return content;

		// Block reference (^blockid)
		if (subpath.startsWith('^')) {
			const blockId = subpath.substring(1);
			const block = cache.blocks?.[blockId];
			if (block) {
				const lines = content.split('\n');
				return lines.slice(block.position.start.line, block.position.end.line + 1).join('\n');
			}
		}

		// Heading reference
		const heading = cache.headings?.find(h => h.heading === subpath);
		if (heading) {
			const startLine = heading.position.start.line;
			let endLine = content.split('\n').length;

			// Find next heading of same or higher level to determine end
			for (const h of cache.headings || []) {
				if (h.position.start.line > startLine && h.level <= heading.level) {
					endLine = h.position.start.line;
					break;
				}
			}

			const lines = content.split('\n');
			return lines.slice(startLine, endLine).join('\n');
		}

		return content;
	}

	/**
	 * Samples the average color of the image region under a hotspot.
	 * Used for auto-coloring the file list panel.
	 */
	sampleRegionColor(h: Hotspot): string | null {
		if (!this.colorCtx || !this.colorCanvas || !h.points?.length) return null;
		const cw = this.colorCanvas.width;
		const ch = this.colorCanvas.height;
		const [cx, cy] = centroid(h.points);
		
		// Sample center and points along the perimeter
		const samplePts = [[cx, cy]];
		const step = Math.max(1, Math.floor(h.points.length / 8));
		for (let i = 0; i < h.points.length; i += step) {
			const p = h.points[i];
			samplePts.push([(cx + p[0]) / 2, (cy + p[1]) / 2]);
		}
		
		let rTotal = 0, gTotal = 0, bTotal = 0, count = 0;
		for (const [px, py] of samplePts) {
			const x = Math.round(px / 100 * cw);
			const y = Math.round(py / 100 * ch);
			if (x < 0 || x >= cw || y < 0 || y >= ch) continue;
			try {
				const pixel = this.colorCtx.getImageData(x, y, 1, 1).data;
				rTotal += pixel[0];
				gTotal += pixel[1];
				bTotal += pixel[2];
				count++;
			} catch (_) {
				continue;
			}
		}
		if (count === 0) return null;
		
		// Darken the color slightly for better text contrast
		const darken = 0.6;
		const r = Math.round(rTotal / count * darken);
		const g = Math.round(gTotal / count * darken);
		const b = Math.round(bTotal / count * darken);
		return `rgb(${r}, ${g}, ${b})`;
	}

	/**
	 * Opens a modal to edit a hotspot's properties (name, link, embed).
	 */
	regionModal(h: Hotspot) {
		const m = document.body.createDiv({ cls: 'hotspot-modal zone-detail-panel' });
		m.style.zIndex = '10000';
		m.createDiv({ cls: 'panel-header' }).createEl('h2', { text: 'Region Link' });
		const c = m.createDiv({ cls: 'panel-file-list', attr: { style: 'padding:20px' } });

		c.createEl('label', { text: 'Region Name', attr: { style: 'display:block' } });
		const nameIn = c.createEl('input', { attr: { type: 'text', value: h.name } });

		c.createEl('label', { text: 'Vault Path (folder or file)', attr: { style: 'margin-top:10px;display:block' } });
		const pathIn = c.createEl('input', { attr: { type: 'text', value: h.path } });
		new PathSuggest(this.app, pathIn);

		// Embed Toggle
		const embedDiv = c.createDiv({ attr: { style: 'margin-top:15px;display:flex;align-items:center;gap:10px' } });
		embedDiv.createEl('label', { text: 'Embed/Preview in Map', attr: { style: 'font-weight:bold;font-size:12px' } });
		const embedToggle = embedDiv.createEl('input', { attr: { type: 'checkbox' } });
		embedToggle.checked = h.embed || false;

		const row = c.createDiv({ attr: { style: 'margin-top:20px;display:flex;gap:10px' } });
		row.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = async () => {
			h.name = nameIn.value;
			h.path = pathIn.value;
			h.embed = embedToggle.checked;
			await this.saveCurrentProfile();
			m.remove();
			this.render();
		};
		row.createEl('button', { text: 'Cancel' }).onclick = () => m.remove();
	}

	/**
	 * Displays the file list panel for a hotspot.
	 * Handles navigation within folders and sorting.
	 */
	showFiles(h: Hotspot, curPath?: string) {
		const rawPath = curPath || h.path;
		if (!rawPath) {
			new Notice('No path linked to this region');
			return;
		}
		const [filePath, subpath] = rawPath.split('#', 2);
		const path = filePath;
		const af = this.app.vault.getAbstractFileByPath(path);
		
		// If it's a file, open it directly
		if (af instanceof TFile) {
			const leaf = this.app.workspace.getLeaf('tab');
			leaf.openFile(af, subpath ? { eState: { subpath: '#' + subpath } } : undefined);
			return;
		}
		
		// If path not found, try opening as link text
		if (!af) {
			this.app.workspace.openLinkText(rawPath, '', true);
			return;
		}

		// --- Build File List Panel ---
		const root = this.containerEl.children[1];
		let panel = root.querySelector('.zone-detail-panel') as HTMLElement | null;
		
		// Reset panel if navigating to a new root path
		if (panel && !curPath) {
			panel.remove();
			panel = null;
		}
		
		if (!panel) {
			panel = root.createDiv({ cls: 'zone-detail-panel' });
			
			// Set panel color
			let panelBg = '';
			const pcSetting = this.plugin.settings.panelColor.trim().toLowerCase();
			if (pcSetting === 'auto') {
				panelBg = this.sampleRegionColor(h) || '';
			} else if (pcSetting) {
				panelBg = pcSetting;
			}
			if (panelBg) {
				panel.style.background = panelBg;
				panel.style.borderColor = panelBg;
			}
			
			const head = panel.createDiv({ cls: 'panel-header' });
			if (panelBg) head.style.background = panelBg;
			head.createEl('h2', { text: h.name || 'Files' });
			
			const btns = head.createDiv({ cls: 'panel-btns' });
			btns.createEl('button', { text: '✏️' }).onclick = () => {
				panel!.remove();
				this.regionModal(h);
			};
			btns.createEl('button', { text: '✕' }).onclick = () => panel!.remove();
			panel.createDiv({ cls: 'panel-file-list' });
		}
		
		const list = panel.querySelector('.panel-file-list')!;
		list.empty();
		
		if (!(af instanceof TFolder)) {
			list.createDiv({ text: 'Path not found', cls: 'empty-msg' });
			return;
		}

		// Back Button Logic
		if (curPath && curPath !== h.path) {
			const backBtn = panel.querySelector('.panel-back-btn');
			if (backBtn) backBtn.remove();
			const back = panel.createDiv({ cls: 'panel-back-btn' });
			back.setText('⬅️ Back');
			panel.insertBefore(back, panel.querySelector('.panel-file-list'));
			back.onclick = () => {
				const parts = path.split('/');
				parts.pop();
				this.showFiles(h, parts.join('/'));
			};
		} else {
			const existing = panel.querySelector('.panel-back-btn');
			if (existing) existing.remove();
		}

		// Sort & Filter Bar
		const sortBar = list.createDiv({ cls: 'sort-bar' });
		const sortSelect = sortBar.createEl('select', { cls: 'sort-select' });
		Object.keys(SORT_LABELS).forEach(k => {
			const opt = sortSelect.createEl('option', { text: SORT_LABELS[k], value: k });
			opt.selected = k === this.sortType;
		});
		sortSelect.onchange = () => {
			this.sortType = sortSelect.value;
			this.showFiles(h, path);
		};
		sortBar.createEl('button', { text: this.plugin.settings.showTags ? '🏷️ Hide' : '🏷️ Tags' }).onclick = async () => {
			this.plugin.settings.showTags = !this.plugin.settings.showTags;
			await this.plugin.saveSettings();
			this.showFiles(h, path);
		};

		// Sort Files
		const sorted = [...af.children].sort((a, b) => {
			const aIsFolder = a instanceof TFolder ? 0 : 1;
			const bIsFolder = b instanceof TFolder ? 0 : 1;
			if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
			switch (this.sortType) {
				case 'name-az': return a.name.localeCompare(b.name);
				case 'name-za': return b.name.localeCompare(a.name);
				case 'mtime-new': return (b instanceof TFile ? b.stat.mtime : 0) - (a instanceof TFile ? a.stat.mtime : 0);
				case 'mtime-old': return (a instanceof TFile ? a.stat.mtime : 0) - (b instanceof TFile ? b.stat.mtime : 0);
				case 'ctime-new': return (b instanceof TFile ? b.stat.ctime : 0) - (a instanceof TFile ? a.stat.ctime : 0);
				case 'ctime-old': return (a instanceof TFile ? a.stat.ctime : 0) - (b instanceof TFile ? b.stat.ctime : 0);
				default: return a.name.localeCompare(b.name);
			}
		});

		// Render List Items
		sorted.forEach(child => {
			const item = list.createDiv({ cls: 'file-item' });
			item.createSpan({ text: (child instanceof TFolder ? '📁 ' : '📄 ') + child.name });

			if (this.plugin.settings.showTags && child instanceof TFile) {
				const tags = getAllTags(this.app, child);
				if (tags.length) {
					const tc = item.createDiv({ cls: 'tag-container' });
					tags.forEach(t => tc.createSpan({ text: t, cls: 'tag-chip' }));
				}
			}

			item.onclick = () => {
				if (child instanceof TFolder) this.showFiles(h, child.path);
				else if (child instanceof TFile) this.app.workspace.getLeaf('tab').openFile(child);
			};
		});
	}
}
