# Melo Image Map - User Manual

**Melo Image Map** allows you to create interactive, visual maps within Obsidian. Turn any image into a navigational dashboard by drawing clickable regions (hotspots) that link to your notes, folders, or other maps.

## 🚀 Getting Started

### 1. Creating a New Map
1. Open the **Melo View** (click the map icon in the ribbon or use the command palette).
2. In the top-left dropdown menu, select **"➕ Create New Map..."**.
3. **Name**: Enter a name for your map (e.g., "Home Dashboard", "Fantasy World").
4. **Image Path**: Enter the path to an image in your vault (e.g., `Assets/map.png`). You can use the auto-complete suggestions.
5. Click **Create**. A new Markdown file will be created in your configured Maps folder.

### 2. Importing Existing Maps
If you have existing Markdown files with Melo frontmatter, you can import them via **Settings > Import Profile**, or simply ensure they have the property `melo-profile: true`.

---

## ✏️ Editing Mode

To start adding interactive regions, click the **"✏️ Edit Map"** button in the top-right corner.

### Drawing Shapes
1. Click the **"Shapes ▾"** button to choose a tool:
   - **⬜ Rectangle**: Good for general areas.
   - **◯ Circle**: Good for round objects or locations.
   - **△ Triangle / ⬠ Pentagon**: Geometric shapes.
   - **➜ Arrow**: Directional indicators (drag direction determines orientation).
   - **🗨 Speech Bubble**: Annotations (drag direction determines tail position).
2. **Click and drag** on the image to draw the shape.
3. **Adjust**:
   - Drag the **white handles** (vertices) to reshape.
   - Drag the **shape body** to move it.
   - Use **Ctrl+Z** (or Cmd+Z) to Undo changes.

### Linking Content
Once a shape is drawn, a popup menu appears:
- **✅ Confirm**: Saves the shape geometry.
- **🗑️ Delete**: Removes the shape.

After confirming, or by clicking a shape in Edit Mode, you can configure:
1. **Region Name**: Label displayed on the map.
2. **Vault Path**: The file or folder to open. Supports:
   - **Files**: Opens the note.
   - **Folders**: Opens a file list panel inside the map.
   - **Headings/Blocks**: Link to specific parts of a note (e.g., `Note.md#Section`).
   - **Other Maps**: Linking to another Melo Profile creates a nested navigation experience.
3. **Embed/Preview**: Check this to show the linked note content in a popup modal instead of navigating away.

Click **"✅ Done"** in the toolbar to save changes and exit Edit Mode.

---

## 🧭 Viewing & Interaction

### Navigation
- **Hover**: Hover over regions to see their labels. If **HUD** is enabled, a detail card will appear with file metadata and a content preview.
- **Click**:
   - **File**: Opens the note in a new tab.
   - **Folder**: Opens a floating panel listing files in that folder.
   - **Embed**: Opens a preview modal.
   - **Map**: Loads the linked Melo Map.

### Folder Panel
When you click a region linked to a folder:
- **Sort**: Order files by Name, Created Time, or Modified Time.
- **Tags**: Toggle tag visibility for files in the list.
- **Back**: Navigate up if you drill down into subfolders.

---

## ⚙️ Settings

Customize the experience in **Settings > Melo View Settings**:

- **Default Profile**: Choose a map to load automatically when Obsidian starts.
- **Maps Folder**: Set where new map files are saved (default: `Melo Maps`).
- **Enable HUD**: Toggle the hover detail card.
- **Label Style**: Choose to display `Name`, `Path`, or `Both`.
- **Always Show Labels**: Keep labels visible without hovering (useful for touch screens or dense maps).
- **Hover Effect**: Adjust the visual highlighting intensity (`None`, `Subtle`, `High`).
- **Panel Color**: Customize the background color of the file list panel (Auto-detect from image, Custom Hex, or Default).
