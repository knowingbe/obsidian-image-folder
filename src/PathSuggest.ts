import { App, TFile, TFolder } from 'obsidian';

/**
 * Provides auto-completion for file paths in an input element.
 * Shows a dropdown of matching files and folders from the vault.
 */
export class PathSuggest {
	app: App;
	input: HTMLInputElement;
	box: HTMLElement | null = null;
	items: { label: string; type: 'file' | 'folder' }[] = [];
	idx = 0;
	exts: string[] | null;

	/**
	 * @param app Obsidian App instance.
	 * @param input The HTML input element to attach the suggester to.
	 * @param exts Optional array of file extensions to filter by (e.g. ['png', 'jpg']).
	 */
	constructor(app: App, input: HTMLInputElement, exts: string[] | null = null) {
		this.app = app;
		this.input = input;
		this.exts = exts;
		
		// Attach event listeners
		input.addEventListener('input', () => this.update());
		input.addEventListener('keydown', (e) => this.key(e));
		input.addEventListener('blur', () => setTimeout(() => this.close(), 200));
	}

	/**
	 * Updates the suggestion list based on current input value.
	 */
	update() {
		const q = this.input.value.toLowerCase();
		
		// Filter and sort files
		this.items = this.app.vault.getAllLoadedFiles().filter(f => {
			// Match path against query
			if (!f.path.toLowerCase().includes(q)) return false;
			// Filter by extension if specified
			if (this.exts && f instanceof TFile) return this.exts.includes(f.extension.toLowerCase());
			return true;
		}).sort((a, b) => {
			// Sort folders first, then files alphabetically
			const aIsFolder = a instanceof TFolder ? 0 : 1;
			const bIsFolder = b instanceof TFolder ? 0 : 1;
			if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
			return a.path.localeCompare(b.path);
		}).slice(0, 10) // Limit to 10 results
		.map(f => ({ label: f.path, type: f instanceof TFolder ? 'folder' : 'file' }));
		
		this.show();
	}

	/**
	 * Renders the suggestion dropdown box.
	 */
	show() {
		if (!this.items.length) {
			this.close();
			return;
		}
		
		// Create box if not exists
		if (!this.box) this.box = document.body.createDiv({ cls: 'path-suggestion-container' });
		
		// Position box below input
		const r = this.input.getBoundingClientRect();
		this.box.style.cssText = `left:${r.left}px;top:${r.bottom + 4}px;width:${r.width}px;position:fixed;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.4);z-index:10000;max-height:200px;overflow-y:auto`;
		this.box.empty();
		
		this.idx = 0;
		
		// Render items
		this.items.forEach((it, i) => {
			const d = this.box!.createDiv({ cls: 'path-suggestion-item' + (i === this.idx ? ' is-selected' : '') });
			d.createSpan({ text: (it.type === 'folder' ? '📁 ' : '📄 ') + it.label });
			
			d.onclick = () => {
				this.input.value = it.label;
				this.close();
				// Trigger input event to notify listeners
				this.input.dispatchEvent(new Event('input'));
			};
		});
	}

	/**
	 * Closes the suggestion box.
	 */
	close() {
		this.box?.remove();
		this.box = null;
	}

	/**
	 * Handles keyboard navigation (Up/Down/Enter/Esc).
	 */
	key(e: KeyboardEvent) {
		if (!this.box) return;
		
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.idx = (this.idx + 1) % this.items.length;
			this.show();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.idx = (this.idx - 1 + this.items.length) % this.items.length;
			this.show();
		} else if (e.key === 'Enter' && this.items[this.idx]) {
			e.preventDefault();
			this.input.value = this.items[this.idx].label;
			this.close();
		} else if (e.key === 'Escape') {
			this.close();
		}
	}
}
