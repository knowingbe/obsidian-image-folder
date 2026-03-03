import { Plugin } from 'obsidian';
import { MeloSettings, DEFAULT_SETTINGS, VIEW_TYPE } from './src/types';
import { MeloView } from './src/MeloView';
import { MeloSettingTab } from './src/SettingsTab';

/**
 * Main entry point for the Melo Image Map plugin.
 */
export default class MeloPlugin extends Plugin {
	settings: MeloSettings;

	/**
	 * Called when the plugin is loaded by Obsidian.
	 */
	async onload() {
		await this.loadSettings();

		// Register the custom view type
		this.registerView(VIEW_TYPE, (leaf) => new MeloView(leaf, this));

		// Add a ribbon icon to the left sidebar
		this.addRibbonIcon('map', 'Open Melo View', () => this.activateView());

		// Add a command to the command palette
		this.addCommand({ 
			id: 'open-melo-view', 
			name: 'Open Melo View', 
			callback: () => this.activateView() 
		});

		// Add the settings tab
		this.addSettingTab(new MeloSettingTab(this.app, this));
	}

	/**
	 * Loads settings from disk, merging with defaults.
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Saves current settings to disk.
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Activates the Melo View.
	 * If the view is already open, reveals it. Otherwise, creates a new leaf.
	 */
	async activateView() {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		
		if (!leaf) {
			// Create a new leaf in the main area (tab)
			leaf = this.app.workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}

		this.app.workspace.revealLeaf(leaf);
	}
}
