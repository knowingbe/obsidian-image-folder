import { App, Modal, Notice, TFile, MarkdownRenderer, Component } from 'obsidian';
import MeloPlugin from '../main';
import { ProfileManager } from './ProfileManager';
import { PathSuggest } from './PathSuggest';

/**
 * Modal for creating a new Melo Map profile.
 * Prompts for a name and an image path.
 */
export class NewProfileModal extends Modal {
	plugin: MeloPlugin;
	onSave: (file: TFile) => void;

	constructor(app: App, plugin: MeloPlugin, onSave: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Create New Profile' });
		
		const container = contentEl.createDiv({ cls: 'panel-file-list' });
		
		// Name Input
		container.createEl('label', { text: 'Name', attr: { style: 'display:block;margin-bottom:5px;font-weight:bold' } });
		const nameInput = container.createEl('input', { attr: { type: 'text' } });
		nameInput.style.cssText = 'display:block;margin-bottom:15px;width:100%';

		// Image Path Input
		container.createEl('label', { text: 'Image Path', attr: { style: 'display:block;margin-bottom:5px;font-weight:bold' } });
		const pathInput = container.createEl('input', { attr: { type: 'text', placeholder: 'e.g. assets/room.jpg' } });
		pathInput.style.cssText = 'display:block;margin-bottom:20px;width:100%';
		
		// Attach path suggester for images
		new PathSuggest(this.app, pathInput, ['png', 'jpg', 'jpeg', 'webp', 'gif']);

		// Buttons
		const row = container.createDiv({ attr: { style: 'display:flex;justify-content:flex-end;gap:10px' } });
		row.createEl('button', { text: 'Create', cls: 'mod-cta' }).onclick = async () => {
			if (!nameInput.value) return;
			const manager = new ProfileManager(this.app, this.plugin);
			const file = await manager.createProfile(nameInput.value, pathInput.value);
			this.onSave(file);
			this.close();
		};
		row.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
	}

	onClose() { this.contentEl.empty(); }
}

/**
 * Modal for importing an existing Melo Map profile from a Markdown file.
 * Lists all files with 'melo-profile: true' frontmatter.
 */
export class ImportProfileModal extends Modal {
	plugin: MeloPlugin;
	onSave: () => void;

	constructor(app: App, plugin: MeloPlugin, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Import Profile from Markdown' });
		
		// Find all profile files
		const files = this.app.vault.getMarkdownFiles().filter(f => {
			const c = this.app.metadataCache.getFileCache(f);
			return c?.frontmatter && c.frontmatter['image-map-profile'] === true;
		});

		if (files.length === 0) {
			contentEl.createDiv({ text: 'No profile files found in vault. (Files must have "image-map-profile: true" in frontmatter)', attr: { style: 'color:var(--text-muted);font-style:italic' } });
			return;
		}

		// Render file list
		const list = contentEl.createDiv({ cls: 'import-file-list' });
		list.style.cssText = 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:4px;margin-bottom:20px';

		files.forEach(f => {
			const item = list.createDiv({ cls: 'import-item' });
			item.style.cssText = 'padding:10px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;display:flex;justify-content:space-between;align-items:center';
			item.onmouseover = () => item.style.background = 'var(--background-modifier-hover)';
			item.onmouseout = () => item.style.background = 'transparent';
			
			const info = item.createDiv();
			info.createDiv({ text: f.basename, attr: { style: 'font-weight:bold' } });
			info.createDiv({ text: f.path, attr: { style: 'font-size:0.8em;color:var(--text-muted)' } });

			item.onclick = async () => {
				const c = this.app.metadataCache.getFileCache(f);
				if (c?.frontmatter) {
					new Notice(`Profile "${f.basename}" is ready to use.`);
					this.onSave();
					this.close();
				}
			};
		});
	}

	onClose() { this.contentEl.empty(); }
}

/**
 * Modal for previewing file content (embedded view).
 * Renders Markdown content in a modal window.
 */
export class FilePreviewModal extends Modal {
	content: string;
	title: string;
	file: TFile;

	constructor(app: App, title: string, content: string, file: TFile) {
		super(app);
		this.title = title;
		this.content = content;
		this.file = file;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('melo-preview-modal');
		
		const header = contentEl.createDiv({ cls: 'preview-header' });
		header.createEl('h2', { text: this.title });
		
		const openBtn = header.createEl('button', { text: 'Open in New Tab', cls: 'mod-cta' });
		openBtn.onclick = () => {
			this.app.workspace.getLeaf('tab').openFile(this.file);
			this.close();
		};
		
		const body = contentEl.createDiv({ cls: 'markdown-preview-view' });
		MarkdownRenderer.render(this.app, this.content, body, '', new Component());
	}

	onClose() {
		this.contentEl.empty();
	}
}
