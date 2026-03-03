import { App, TFile, stringifyYaml } from 'obsidian';
import MeloPlugin from '../main';
import { Hotspot, PROFILE_TAG } from './types';

/**
 * Manages the creation, loading, and saving of Melo Map profiles (Markdown files).
 */
export class ProfileManager {
	app: App;
	plugin: MeloPlugin;

	constructor(app: App, plugin: MeloPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * Retrieves all Markdown files in the vault that are marked as Melo Profiles.
	 * Checks for the 'melo-profile: true' frontmatter property.
	 * @returns Array of TFile objects.
	 */
	getProfileFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter(f => {
			const cache = this.app.metadataCache.getFileCache(f);
			return cache?.frontmatter && cache.frontmatter[PROFILE_TAG] === true;
		});
	}

	/**
	 * Ensures that a folder exists in the vault, creating it if necessary.
	 * @param folderPath The path to the folder.
	 */
	async ensureFolderExists(folderPath: string) {
		if (!this.app.vault.getAbstractFileByPath(folderPath)) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	/**
	 * Creates a new Melo Profile file.
	 * @param name The name of the profile (filename).
	 * @param imagePath The path to the background image.
	 * @returns The created TFile.
	 */
	async createProfile(name: string, imagePath: string): Promise<TFile> {
		const folder = this.plugin.settings.mapsFolder || 'Melo Maps';
		await this.ensureFolderExists(folder);
		
		let filename = `${folder}/${name}.md`;
		let counter = 1;
		
		// Handle duplicate filenames by appending a number
		while (this.app.vault.getAbstractFileByPath(filename)) {
			filename = `${folder}/${name} (${counter}).md`;
			counter++;
		}

		// Initial frontmatter data
		const frontmatter = {
			[PROFILE_TAG]: true,
			'image-path': imagePath,
			'hover-label-style': this.plugin.settings.defaultHoverLabelStyle || 'default',
			'hotspots': [] as Hotspot[]
		};
		
		// Create file content with YAML frontmatter
		const content = `---\n${stringifyYaml(frontmatter)}---\n# ${name}\n`;
		return await this.app.vault.create(filename, content);
	}

	/**
	 * Updates the hotspots data in a profile file's frontmatter.
	 * @param file The profile file to update.
	 * @param hotspots The array of Hotspot objects to save.
	 */
	async updateHotspots(file: TFile, hotspots: Hotspot[]) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			// Remove temporary properties (like isNew) before saving
			const cleanHotspots = hotspots.map(h => {
				const { isNew, ...rest } = h;
				return rest;
			});
			fm['hotspots'] = cleanHotspots;
		});
	}

	/**
	 * Updates the hover label style for a specific profile.
	 * @param file The profile file to update.
	 * @param style The new style string.
	 */
	async updateProfileStyle(file: TFile, style: string) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm['hover-label-style'] = style;
		});
	}
}
