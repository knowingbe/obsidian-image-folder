export class App {
    vault: any;
    metadataCache: any;
    fileManager: any;
}

export class TFile {
    path: string;
    basename: string;
    extension: string;
    stat: any;
}

export class TFolder {
    path: string;
    name: string;
    children: any[];
}

export class Vault {
    getMarkdownFiles(): any[] { return []; }
    getAbstractFileByPath(path: string): any { return null; }
    createFolder(path: string) {}
    create(path: string, data: string) {}
}

export class MetadataCache {
    getFileCache(file: any): any { return null; }
}

export class FileManager {
    processFrontMatter(file: any, fn: (data: any) => void) {}
}

export class Plugin {
    app: App;
    manifest: any;
    settings: any;
    constructor(app: App, manifest: any) {
        this.app = app;
        this.manifest = manifest;
    }
    loadData() { return Promise.resolve({}); }
    saveData(settings: any) { return Promise.resolve(); }
    addRibbonIcon(icon: string, title: string, callback: () => void) {}
    addCommand(command: any) {}
    addSettingTab(tab: any) {}
    registerView(type: string, callback: (leaf: any) => any) {}
}

export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = document.createElement('div');
    }
    display() {}
}

export class Setting {
    constructor(containerEl: HTMLElement) {}
    setName(name: string) { return this; }
    setDesc(desc: string) { return this; }
    addText(cb: (text: any) => any) { return this; }
    addToggle(cb: (toggle: any) => any) { return this; }
    addDropdown(cb: (dropdown: any) => any) { return this; }
    addButton(cb: (button: any) => any) { return this; }
    addColorPicker(cb: (color: any) => any) { return this; }
}

export class ItemView {
    constructor(leaf: any) {}
    getViewType() { return ''; }
    getDisplayText() { return ''; }
    getIcon() { return ''; }
    onOpen() {}
    onClose() {}
}

export class WorkspaceLeaf {
    view: any;
    setViewState(state: any) {}
}

export class Modal {
    contentEl: HTMLElement;
    constructor(app: App) {
        this.contentEl = document.createElement('div');
    }
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
}

export class Notice {
    constructor(message: string) {}
}

export class Menu {
    addItem(cb: (item: any) => any) {}
    showAtMouseEvent(evt: MouseEvent) {}
}

export class Component {}

export const MarkdownRenderer = {
    render: jest.fn(),
};

export const moment = jest.fn(() => ({
    format: jest.fn(),
}));

export function stringifyYaml(obj: any) {
    return JSON.stringify(obj);
}
