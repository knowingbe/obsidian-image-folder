import { App, PluginSettingTab, Setting } from 'obsidian';
import MeloPlugin from '../main';
import { ProfileManager } from './ProfileManager';
import { ImportProfileModal } from './Modals';
import { VIEW_TYPE } from './types';
import { MeloView } from './MeloView';

/**
 * The settings tab for the Melo Plugin.
 * Allows users to configure global preferences.
 */
export class MeloSettingTab extends PluginSettingTab {
	plugin: MeloPlugin;

	constructor(app: App, plugin: MeloPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl: c } = this;
		c.empty();
		c.createEl('h2', { text: 'Melo View Settings' });

		// --- Default Profile ---
		new Setting(c)
			.setName('Default Profile')
			.setDesc('Automatically load this profile when opening Melo View.')
			.addDropdown(d => {
				const files = new ProfileManager(this.app, this.plugin).getProfileFiles();
				files.sort((a, b) => a.path.localeCompare(b.path));
				d.addOption('', 'None');
				files.forEach(f => d.addOption(f.path, f.basename));
				d.setValue(this.plugin.settings.defaultProfilePath);
				d.onChange(async (v) => {
					this.plugin.settings.defaultProfilePath = v;
					await this.plugin.saveSettings();
				});
			});

		// --- Maps Folder ---
		new Setting(c)
			.setName('Maps Folder')
			.setDesc('Default folder to save new Melo Maps.')
			.addText(t => t
				.setValue(this.plugin.settings.mapsFolder)
				.onChange(async (v) => {
					this.plugin.settings.mapsFolder = v;
					await this.plugin.saveSettings();
				})
			);

		// --- HUD Toggle ---
		new Setting(c)
			.setName('Enable HUD')
			.setDesc('Show a card with file details when hovering over a region.')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableHUD)
				.onChange(async (v) => {
					this.plugin.settings.enableHUD = v;
					await this.plugin.saveSettings();
					this.refreshViews();
				})
			);

		// --- Label Style ---
		new Setting(c)
			.setName('Label Style')
			.setDesc('What to show on region labels')
			.addDropdown(d => d
				.addOption('name', 'Name')
				.addOption('path', 'Path')
				.addOption('both', 'Both')
				.setValue(this.plugin.settings.displayLabelType)
				.onChange(async (v) => {
					this.plugin.settings.displayLabelType = v as any;
					await this.plugin.saveSettings();
				})
			);

		// --- Default Hover Label Style ---
		new Setting(c)
			.setName('Default Hover Label Style')
			.setDesc('Default visual style for new profiles. Can be changed per profile.')
			.addDropdown(d => d
				.addOption('default', 'Default (Yellow)')
				.addOption('glass', 'Glass')
				.addOption('neon', 'Neon')
				.addOption('minimal', 'Minimal')
				.addOption('comic', 'Comic')
				.addOption('scale', 'Scale (Big Text)')
				.addOption('fantasy', 'Fantasy')
				.setValue(this.plugin.settings.defaultHoverLabelStyle)
				.onChange(async (v) => {
					this.plugin.settings.defaultHoverLabelStyle = v as any;
					await this.plugin.saveSettings();
					// Note: This won't affect existing profiles that have a style set
				})
			);

		// --- Show Tags ---
		new Setting(c)
			.setName('Show Tags')
			.addToggle(t => t
				.setValue(this.plugin.settings.showTags)
				.onChange(async (v) => {
					this.plugin.settings.showTags = v;
					await this.plugin.saveSettings();
				})
			);

		// --- Always Show Labels ---
		new Setting(c)
			.setName('Always Show Labels')
			.setDesc('Show labels permanently with a subtle style, clearer on hover')
			.addToggle(t => t
				.setValue(this.plugin.settings.alwaysShowLabels)
				.onChange(async (v) => {
					this.plugin.settings.alwaysShowLabels = v;
					await this.plugin.saveSettings();
					this.refreshViews();
				})
			);

		// --- Hover Effect ---
		new Setting(c)
			.setName('Hover Effect')
			.setDesc('Visual feedback when hovering a region')
			.addDropdown(d => d
				.addOption('none', 'None (native)')
				.addOption('subtle', 'Subtle')
				.addOption('high', 'High')
				.setValue(this.plugin.settings.hoverEffectType)
				.onChange(async (v) => {
					this.plugin.settings.hoverEffectType = v as any;
					await this.plugin.saveSettings();
					this.refreshViews();
				})
			);

		// --- Panel Background Color ---
		let colorMode = 'default';
		if (this.plugin.settings.panelColor === 'auto') colorMode = 'auto';
		else if (this.plugin.settings.panelColor) colorMode = 'custom';

		new Setting(c)
			.setName('Panel Background Color')
			.setDesc('Choose how the file list panel background is colored.')
			.addDropdown(d => d
				.addOption('default', 'Default')
				.addOption('auto', 'Auto-detect')
				.addOption('custom', 'Color Code')
				.setValue(colorMode)
				.onChange(async (v) => {
					if (v === 'default') {
						this.plugin.settings.panelColor = '';
					} else if (v === 'auto') {
						this.plugin.settings.panelColor = 'auto';
					} else {
						this.plugin.settings.panelColor = '#000000'; // Default hex if switching to custom
					}
					await this.plugin.saveSettings();
					this.display(); // Re-render to show/hide picker
					this.refreshViews();
				})
			);

		if (colorMode === 'custom') {
			new Setting(c)
				.setName('Custom Color')
				.addColorPicker(cp => cp
					.setValue(this.plugin.settings.panelColor)
					.onChange(async (v) => {
						this.plugin.settings.panelColor = v;
						await this.plugin.saveSettings();
						this.refreshViews();
					})
				);
		}

		// --- Import Profile ---
		c.createEl('h3', { text: 'Import Profile' });
		c.createDiv({ text: 'Import an existing Melo Map profile from a Markdown file.', attr: { style: 'margin-bottom: 15px; color: var(--text-muted);' } });

		new Setting(c)
			.setName('Import Profile')
			.setDesc('Select a Markdown file containing a Melo Map profile.')
			.addButton(b => b
				.setButtonText('Import')
				.setCta()
				.onClick(() => {
					new ImportProfileModal(this.app, this.plugin, () => this.display()).open();
				})
			);
	}

	/**
	 * Refreshes all active Melo Views to apply setting changes immediately.
	 */
	refreshViews() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
			if (leaf.view instanceof MeloView) leaf.view.render();
		});
	}
}
