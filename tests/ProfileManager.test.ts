import { ProfileManager } from '../src/ProfileManager';
import { App, TFile, TFolder, Vault, MetadataCache, FileManager } from 'obsidian';
import MeloPlugin from '../main';
import { Hotspot, PROFILE_TAG } from '../src/types';

// Mock Obsidian classes
jest.mock('obsidian', () => ({
    App: jest.fn(),
    TFile: jest.fn(),
    TFolder: jest.fn(),
    Vault: jest.fn(),
    MetadataCache: jest.fn(),
    FileManager: jest.fn(),
    stringifyYaml: jest.fn((obj) => JSON.stringify(obj)), // Simple mock
}));

describe('ProfileManager', () => {
    let app: App;
    let plugin: MeloPlugin;
    let manager: ProfileManager;
    let mockVault: any;
    let mockMetadataCache: any;
    let mockFileManager: any;

    beforeEach(() => {
        // Setup mocks
        mockVault = {
            getMarkdownFiles: jest.fn(),
            getAbstractFileByPath: jest.fn(),
            createFolder: jest.fn(),
            create: jest.fn(),
        };
        mockMetadataCache = {
            getFileCache: jest.fn(),
        };
        mockFileManager = {
            processFrontMatter: jest.fn(),
        };

        app = new App();
        (app as any).vault = mockVault;
        (app as any).metadataCache = mockMetadataCache;
        (app as any).fileManager = mockFileManager;

        plugin = new MeloPlugin(app, {} as any);
        plugin.settings = {
            mapsFolder: 'Melo Maps',
            // ... other settings
        } as any;

        manager = new ProfileManager(app, plugin);
    });

    describe('getProfileFiles', () => {
        it('should return only files with melo-profile tag', () => {
            const file1 = new TFile();
            const file2 = new TFile();
            const files = [file1, file2];

            mockVault.getMarkdownFiles.mockReturnValue(files);
            
            // Mock cache responses
            mockMetadataCache.getFileCache.mockImplementation((file: TFile) => {
                if (file === file1) return { frontmatter: { [PROFILE_TAG]: true } };
                return { frontmatter: {} };
            });

            const result = manager.getProfileFiles();
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(file1);
        });
    });

    describe('createProfile', () => {
        it('should create folder if not exists', async () => {
            mockVault.getAbstractFileByPath.mockReturnValue(null); // Folder doesn't exist
            
            await manager.createProfile('Test Profile', 'image.png');
            
            expect(mockVault.createFolder).toHaveBeenCalledWith('Melo Maps');
        });

        it('should create file with correct content', async () => {
            mockVault.getAbstractFileByPath.mockReturnValue(new TFolder()); // Folder exists
            
            await manager.createProfile('Test Profile', 'image.png');
            
            expect(mockVault.create).toHaveBeenCalledWith(
                'Melo Maps/Test Profile.md',
                expect.stringContaining('image-path": "image.png"')
            );
        });
    });

    describe('updateHotspots', () => {
        it('should process frontmatter correctly', async () => {
            const file = new TFile();
            const hotspots: Hotspot[] = [
                { id: '1', name: 'H1', path: '', points: [], shapeType: 'rect', isNew: true }
            ];

            await manager.updateHotspots(file, hotspots);

            expect(mockFileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
            
            // Simulate callback execution to verify logic inside
            const callback = mockFileManager.processFrontMatter.mock.calls[0][1];
            const fm: any = {};
            callback(fm);

            expect(fm['hotspots']).toHaveLength(1);
            expect(fm['hotspots'][0].isNew).toBeUndefined(); // Should be cleaned up
        });
    });
});
