import {
    App,
    ItemView,
    Menu,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
    WorkspaceLeaf,
} from 'obsidian';

// Interface definitions
interface Hotspot {
    id: string;
    name: string;
    path: string;
    // We will keep top/left/width/height for backward compatibility or rectangle hotspots
    top?: string;
    left?: string;
    width?: string;
    height?: string;
    // New field for polygon points (array of percentages [x, y])
    points?: [number, number][];
    // Shape type for rendering
    shapeType?: "rect" | "ellipse" | "triangle";
}

interface Profile {
    id: string;
    name: string; // User-friendly name for the profile
    imagePath: string; // The image file path relative to plugin folder or absolute
    hotspots: Hotspot[];
}

interface LoomViewSettings {
    // Display settings
    displayLabelType: "name" | "path" | "both";

    // Deprecated fields, kept for migration
    roomImagePath?: string;
    hotspots?: Hotspot[];

    // New fields
    profiles: Profile[];
    activeProfileId: string;
}

const DEFAULT_SETTINGS: LoomViewSettings = {
    displayLabelType: "path",
    profiles: [],
    activeProfileId: ""
};

const VIEW_TYPE_LOOM = "image-map-view";

// Generate a smooth closed SVG path through control points using cubic bezier curves
function smoothClosedPath(points: [number, number][]): string {
    const n = points.length;
    if (n < 3) {
        return points.map((p, i) => (i === 0 ? `M ${p[0]},${p[1]}` : `L ${p[0]},${p[1]}`)).join(" ") + " Z";
    }

    let d = `M ${points[0][0]},${points[0][1]}`;

    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];

        // Catmull-Rom to Cubic Bezier conversion
        const tension = 0.35;
        const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
        const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
        const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
        const cp2y = p2[1] - (p3[1] - p1[1]) * tension;

        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
    }
    d += " Z";
    return d;
}

// Calculate centroid of polygon vertices (average of all points)
function centroid(points: [number, number][]): [number, number] {
    const n = points.length;
    if (n === 0) return [50, 50];
    const sumX = points.reduce((s, p) => s + p[0], 0);
    const sumY = points.reduce((s, p) => s + p[1], 0);
    return [sumX / n, sumY / n];
}

class LoomView extends ItemView {
    plugin: LoomViewPlugin;

    // Edit Mode & Shape Selection
    isEditMode = false;
    selectedHotspotId: string | null = null;
    draggedPoint: { hotspotId: string, pointIndex: number } | null = null;

    // Paint-style drawing tool
    drawingShapeType: "rect" | "ellipse" | "triangle" | null = null;

    // Edge editing state
    editingEdgesHotspotId: string | null = null;
    undoStack: [number, number][][] = [];

    // Folder sort
    sortType: string = "created-new";

    constructor(leaf: WorkspaceLeaf, plugin: LoomViewPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_LOOM;
    }

    getDisplayText() {
        return "Image Map";
    }

    getIcon() {
        return "map";
    }

    async onOpen() {
        await this.renderRoom();
        // Register event to re-render when file changes (e.g. image update)
        this.registerEvent(this.app.metadataCache.on("changed", () => {
            this.renderRoom();
        }));
    }

    // Helper to get current profile
    getCurrentProfile(): Profile | undefined {
        // If no active profile set, default to the first one
        if (!this.plugin.settings.activeProfileId && this.plugin.settings.profiles.length > 0) {
            this.plugin.settings.activeProfileId = this.plugin.settings.profiles[0].id;
            this.plugin.saveSettings();
        }
        return this.plugin.settings.profiles.find(p => p.id === this.plugin.settings.activeProfileId);
    }

    async renderRoom() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("library-image-room-wrapper");

        const dashboard = container.createDiv({ cls: "room-dashboard" });

        // Create toolbar
        const tools = dashboard.createDiv({ cls: "room-tools" });
        tools.style.display = "flex";
        tools.style.gap = "10px";
        tools.style.marginBottom = "10px";
        tools.style.alignItems = "center";

        // EDIT MODE TOGGLE
        const editModeBtn = tools.createEl("button", { text: this.isEditMode ? "✅ Done Editing" : "✏️ Edit Layout" });
        if (this.isEditMode) editModeBtn.style.backgroundColor = "#2e7d32";
        editModeBtn.onclick = async () => {
            if (this.isEditMode) {
                // Leaving edit mode - save all changes
                await this.plugin.saveSettings();
                new Notice("Layout saved!");
            }
            this.isEditMode = !this.isEditMode;
            this.selectedHotspotId = null;
            this.drawingShapeType = null;
            this.renderRoom();
        };

        if (this.isEditMode) {
            // SHAPE TOOL BUTTONS (Paint-style)
            const shapeTools: { type: "rect" | "ellipse" | "triangle"; icon: string; label: string }[] = [
                { type: "rect", icon: "⬜", label: "Rectangle" },
                { type: "ellipse", icon: "⭕", label: "Ellipse" },
                { type: "triangle", icon: "🔺", label: "Triangle" },
            ];

            shapeTools.forEach(tool => {
                const btn = tools.createEl("button", { text: `${tool.icon} ${tool.label}` });
                btn.style.padding = "4px 10px";
                btn.style.borderRadius = "4px";
                btn.style.border = "1px solid rgba(255,255,255,0.3)";
                if (this.drawingShapeType === tool.type) {
                    btn.style.backgroundColor = "#1976d2";
                    btn.style.color = "white";
                    btn.style.fontWeight = "bold";
                }
                btn.onclick = () => {
                    // Toggle: click same tool again to deselect
                    if (this.drawingShapeType === tool.type) {
                        this.drawingShapeType = null;
                    } else {
                        this.drawingShapeType = tool.type;
                        this.selectedHotspotId = null; // Deselect shape when picking a tool
                    }
                    this.renderRoom();
                };
            });

            const sep = tools.createEl("span", { text: "|" });
            sep.style.color = "rgba(255,255,255,0.4)";
            sep.style.margin = "0 5px";
        }

        // PROFILE SELECTOR (New Feature)
        const profileSelect = tools.createEl("select");
        profileSelect.style.marginLeft = "auto"; // Push to right
        profileSelect.disabled = this.isEditMode; // Disable profile switching while editing to avoid confusion
        // Populate options
        this.plugin.settings.profiles.forEach(p => {
            const option = profileSelect.createEl("option", {
                text: p.name,
                value: p.id
            });
            if (p.id === this.plugin.settings.activeProfileId) {
                option.selected = true;
            }
        });
        // Add "Create New" option
        const newProfileOption = profileSelect.createEl("option", { text: "➕ Add New Profile...", value: "NEW_PROFILE" });

        profileSelect.onchange = async (e) => {
            const val = (e.target as HTMLSelectElement).value;
            if (val === "NEW_PROFILE") {
                await this.createNewProfile();
            } else {
                this.plugin.settings.activeProfileId = val;
                await this.plugin.saveSettings();
                this.renderRoom();
            }
        };

        // GET CURRENT PROFILE
        const currentProfile = this.getCurrentProfile();

        if (!currentProfile) {
            dashboard.createEl("h3", { text: "No profiles found. Create one!" });
            // Button to create first profile
            const createFirstBtn = dashboard.createEl("button", { text: "Create First Profile" });
            createFirstBtn.onclick = () => this.createNewProfile();
            return;
        }

        // IMAGE BACKGROUND
        // Use manifest.dir if available, otherwise fall back to default
        const pluginDir = this.plugin.manifest.dir || (this.app.vault.configDir + "/plugins/loom-view");


        // If imagePath is just filename, assume in plugin dir. If path, try to resolve.
        let layoutImage = currentProfile.imagePath || "room-bg.png";
        // Construct path. 
        // Note: The previous code hardcoded 'loom-view'. We should probably check if that folder exists or use the current plugin id.
        // But let's stick to the previous behavior + flexibility.
        // If the user provides a full path in vault (e.g. "Assets/image.png"), we should use that.
        // If just a filename, use plugin folder.

        let src = "";
        if (layoutImage.includes("/")) {
            // Assume vault path
            const file = this.app.vault.getAbstractFileByPath(layoutImage);
            if (file instanceof TFile) {
                src = this.app.vault.getResourcePath(file);
            } else {
                // Fallback or external URL?
                // Try adapter for absolute path? obsidian doesn't allow absolute path usually.
                // Let's try as plugin folder relative if not found.
                src = this.app.vault.adapter.getResourcePath(pluginDir + "/" + layoutImage);
            }
        } else {
            src = this.app.vault.adapter.getResourcePath(pluginDir + "/" + layoutImage);
        }

        // Wrap image in a container to handle overlay positioning correctly
        const imageContainer = dashboard.createDiv({ cls: "room-image-container" });

        const img = imageContainer.createEl("img", {
            cls: "room-bg-img",
            attr: {
                src: src
            }
        });

        // RENDER EXISTING HOTSPOTS using SVG with viewBox 0-100
        const displaySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        displaySvg.setAttribute("viewBox", "0 0 100 100");
        displaySvg.setAttribute("preserveAspectRatio", "none");
        displaySvg.style.position = "absolute";
        displaySvg.style.top = "0";
        displaySvg.style.left = "0";
        displaySvg.style.width = "100%";
        displaySvg.style.height = "100%";
        displaySvg.style.zIndex = "5";
        imageContainer.appendChild(displaySvg);

        const overlay = imageContainer.createDiv({ cls: "room-overlay" });
        overlay.style.zIndex = "6";
        overlay.style.pointerEvents = "none"; // Let clicks pass through to SVG shapes

        // ===== PAINT-STYLE DRAWING =====
        // When a shape tool is selected, enable click-and-drag drawing on imageContainer
        if (this.isEditMode && this.drawingShapeType) {
            imageContainer.style.cursor = "crosshair";

            let drawStartX = 0, drawStartY = 0;
            let previewShape: SVGElement | null = null;
            let isDragging = false;

            // We need a drawing SVG layer on top
            const drawingSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            drawingSvg.setAttribute("viewBox", "0 0 100 100");
            drawingSvg.setAttribute("preserveAspectRatio", "none");
            drawingSvg.style.position = "absolute";
            drawingSvg.style.top = "0";
            drawingSvg.style.left = "0";
            drawingSvg.style.width = "100%";
            drawingSvg.style.height = "100%";
            drawingSvg.style.zIndex = "1000";
            drawingSvg.style.pointerEvents = "none"; // Pass clicks to imageContainer
            imageContainer.appendChild(drawingSvg);

            const shapeType = this.drawingShapeType; // Capture for closures

            imageContainer.onmousedown = (e: MouseEvent) => {
                // Only react to left mouse button, and only on the image area
                if (e.button !== 0) return;
                const imgRect = img.getBoundingClientRect();
                // Check click is within the image bounds
                if (e.clientX < imgRect.left || e.clientX > imgRect.right ||
                    e.clientY < imgRect.top || e.clientY > imgRect.bottom) return;

                e.preventDefault();
                isDragging = true;

                drawStartX = ((e.clientX - imgRect.left) / imgRect.width) * 100;
                drawStartY = ((e.clientY - imgRect.top) / imgRect.height) * 100;

                // Create preview shape
                if (shapeType === "rect") {
                    previewShape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                    previewShape.setAttribute("x", drawStartX.toString());
                    previewShape.setAttribute("y", drawStartY.toString());
                    previewShape.setAttribute("width", "0");
                    previewShape.setAttribute("height", "0");
                } else if (shapeType === "ellipse") {
                    previewShape = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
                    previewShape.setAttribute("cx", drawStartX.toString());
                    previewShape.setAttribute("cy", drawStartY.toString());
                    previewShape.setAttribute("rx", "0");
                    previewShape.setAttribute("ry", "0");
                } else if (shapeType === "triangle") {
                    previewShape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                    previewShape.setAttribute("points", `${drawStartX},${drawStartY} ${drawStartX},${drawStartY} ${drawStartX},${drawStartY}`);
                }

                if (previewShape) {
                    previewShape.style.fill = "rgba(33, 150, 243, 0.2)";
                    previewShape.style.stroke = "#2196f3";
                    previewShape.style.strokeWidth = "0.5";
                    previewShape.setAttribute("vector-effect", "non-scaling-stroke");
                    // Dashed stroke for preview
                    previewShape.style.strokeDasharray = "2 1";
                    drawingSvg.appendChild(previewShape);
                }
            };

            const onDrawMove = (e: MouseEvent) => {
                if (!isDragging || !previewShape) return;
                const imgRect = img.getBoundingClientRect();
                let curX = ((e.clientX - imgRect.left) / imgRect.width) * 100;
                let curY = ((e.clientY - imgRect.top) / imgRect.height) * 100;
                curX = Math.max(0, Math.min(100, curX));
                curY = Math.max(0, Math.min(100, curY));

                const minX = Math.min(drawStartX, curX);
                const minY = Math.min(drawStartY, curY);
                const maxX = Math.max(drawStartX, curX);
                const maxY = Math.max(drawStartY, curY);
                const w = maxX - minX;
                const h = maxY - minY;

                if (shapeType === "rect") {
                    previewShape.setAttribute("x", minX.toString());
                    previewShape.setAttribute("y", minY.toString());
                    previewShape.setAttribute("width", w.toString());
                    previewShape.setAttribute("height", h.toString());
                } else if (shapeType === "ellipse") {
                    previewShape.setAttribute("cx", (minX + w / 2).toString());
                    previewShape.setAttribute("cy", (minY + h / 2).toString());
                    previewShape.setAttribute("rx", (w / 2).toString());
                    previewShape.setAttribute("ry", (h / 2).toString());
                } else if (shapeType === "triangle") {
                    // Triangle: top-center, bottom-left, bottom-right
                    const topX = minX + w / 2;
                    const topY = minY;
                    const blX = minX;
                    const blY = maxY;
                    const brX = maxX;
                    const brY = maxY;
                    previewShape.setAttribute("points", `${topX},${topY} ${blX},${blY} ${brX},${brY}`);
                }
            };

            const onDrawUp = async (e: MouseEvent) => {
                if (!isDragging || !previewShape) return;
                isDragging = false;
                const imgRect = img.getBoundingClientRect();
                let curX = ((e.clientX - imgRect.left) / imgRect.width) * 100;
                let curY = ((e.clientY - imgRect.top) / imgRect.height) * 100;
                curX = Math.max(0, Math.min(100, curX));
                curY = Math.max(0, Math.min(100, curY));

                const minX = Math.min(drawStartX, curX);
                const minY = Math.min(drawStartY, curY);
                const maxX = Math.max(drawStartX, curX);
                const maxY = Math.max(drawStartY, curY);
                const w = maxX - minX;
                const h = maxY - minY;

                // Ignore too-small shapes (accidental clicks)
                if (w < 2 && h < 2) {
                    previewShape.remove();
                    previewShape = null;
                    return;
                }

                // Build points and create hotspot
                let points: [number, number][];
                if (shapeType === "rect") {
                    points = [
                        [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]
                    ];
                } else if (shapeType === "ellipse") {
                    // Approximate ellipse with 8 control points
                    points = [];
                    const cx = minX + w / 2;
                    const cy = minY + h / 2;
                    const rx = w / 2;
                    const ry = h / 2;
                    const segments = 8;
                    for (let i = 0; i < segments; i++) {
                        const angle = (2 * Math.PI * i) / segments;
                        points.push([
                            cx + rx * Math.cos(angle),
                            cy + ry * Math.sin(angle)
                        ]);
                    }
                } else {
                    // Triangle: top-center, bottom-left, bottom-right
                    points = [
                        [minX + w / 2, minY],
                        [minX, maxY],
                        [maxX, maxY]
                    ];
                }

                // Clean up listeners
                document.removeEventListener("mousemove", onDrawMove);
                document.removeEventListener("mouseup", onDrawUp);

                // NEW FLOW: Create hotspot and enter edge editing mode
                const newHotspot: Hotspot = {
                    id: Date.now().toString(),
                    name: "",
                    path: "",
                    points: points,
                    shapeType: shapeType
                };
                currentProfile.hotspots.push(newHotspot);
                this.selectedHotspotId = newHotspot.id;
                this.editingEdgesHotspotId = newHotspot.id;
                this.drawingShapeType = null;
                this.undoStack = [points.map(p => [...p]) as [number, number][]]; // initial snapshot
                await this.plugin.saveSettings();
                this.renderRoom();
            };

            document.addEventListener("mousemove", onDrawMove);
            document.addEventListener("mouseup", onDrawUp);
        }

        // Ctrl+Z and Esc handler for edge editing
        if (this.isEditMode && this.editingEdgesHotspotId) {
            const edgeEditKeyHandler = (e: KeyboardEvent) => {
                if (!this.editingEdgesHotspotId) return;
                const hotspot = currentProfile.hotspots.find(h => h.id === this.editingEdgesHotspotId);
                if (!hotspot || !hotspot.points) return;

                if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (this.undoStack.length > 1) {
                        this.undoStack.pop(); // Remove current
                        const prev = this.undoStack[this.undoStack.length - 1];
                        hotspot.points = prev.map(p => [...p]) as [number, number][];
                        this.renderRoom();
                        new Notice("Undo!");
                    } else {
                        new Notice("Nothing to undo");
                    }
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    // Delete the shape
                    const idx = currentProfile.hotspots.findIndex(h => h.id === this.editingEdgesHotspotId);
                    if (idx >= 0) currentProfile.hotspots.splice(idx, 1);
                    this.editingEdgesHotspotId = null;
                    this.selectedHotspotId = null;
                    this.undoStack = [];
                    this.plugin.saveSettings();
                    this.renderRoom();
                    new Notice("Shape deleted");
                }
            };
            document.addEventListener("keydown", edgeEditKeyHandler);
            // Clean up on next render (will be re-attached if still editing)
            this.register(() => document.removeEventListener("keydown", edgeEditKeyHandler));
        }

        currentProfile.hotspots.forEach((hotspot, index) => {
            let shape: SVGElement;
            const isEllipse = hotspot.shapeType === "ellipse";

            if (hotspot.points && hotspot.points.length > 0) {
                if (isEllipse) {
                    // Smooth bezier path for ellipse shapes
                    shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    shape.setAttribute("d", smoothClosedPath(hotspot.points));
                } else {
                    shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                    const pts = hotspot.points.map(p => `${p[0]},${p[1]}`).join(" ");
                    shape.setAttribute("points", pts);
                }
            } else if (hotspot.top) {
                shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                const y = parseFloat(hotspot.top);
                const x = parseFloat(hotspot.left || "0");
                const w = parseFloat(hotspot.width || "10");
                const h = parseFloat(hotspot.height || "10");
                shape.setAttribute("x", x.toString());
                shape.setAttribute("y", y.toString());
                shape.setAttribute("width", w.toString());
                shape.setAttribute("height", h.toString());
            } else {
                return;
            }

            const isEdgeEditing = this.editingEdgesHotspotId === hotspot.id;
            const isSelected = this.isEditMode && this.selectedHotspotId === hotspot.id;

            if (this.isEditMode) {
                if (isEdgeEditing) {
                    shape.style.fill = "rgba(76, 175, 80, 0.25)";
                    shape.style.stroke = "#4caf50";
                    shape.style.strokeWidth = "2";
                    shape.style.strokeDasharray = "3 1";
                } else if (isSelected) {
                    shape.style.fill = "rgba(33, 150, 243, 0.3)";
                    shape.style.stroke = "#2196f3";
                    shape.style.strokeWidth = "2";
                } else {
                    shape.style.fill = "rgba(255, 255, 255, 0.1)";
                    shape.style.stroke = "rgba(255, 255, 255, 0.5)";
                    shape.style.strokeWidth = "1";
                }
                shape.style.cursor = isEdgeEditing ? "default" : "pointer";
            } else {
                shape.style.fill = "transparent";
                shape.style.stroke = "transparent";
                shape.style.strokeWidth = "0";
                shape.style.cursor = "pointer";
            }

            shape.setAttribute("vector-effect", "non-scaling-stroke");
            shape.style.pointerEvents = "auto";
            displaySvg.appendChild(shape);

            // Label - use centroid (average of vertices) for accurate positioning
            let labelX = 50, labelY = 50;
            if (hotspot.points && hotspot.points.length > 0) {
                const [cx, cy] = centroid(hotspot.points);
                labelX = cx;
                labelY = cy;
            } else if (hotspot.top) {
                labelX = parseFloat(hotspot.left || "0") + parseFloat(hotspot.width || "0") / 2;
                labelY = parseFloat(hotspot.top || "0") + parseFloat(hotspot.height || "0") / 2;
            }

            const spotEl = overlay.createDiv({ cls: "zone-label" });
            spotEl.style.position = "absolute";
            spotEl.style.left = `${labelX}%`;
            spotEl.style.top = `${labelY}%`;
            spotEl.style.transform = "translate(-50%, -50%)";
            spotEl.style.pointerEvents = "none";
            spotEl.style.display = "none";

            let labelText = hotspot.name || "(unnamed)";
            if (this.plugin.settings.displayLabelType === "path") labelText = hotspot.path || "(no path)";
            if (this.plugin.settings.displayLabelType === "both") labelText = `${hotspot.name || "?"} (${hotspot.path || "?"})`;
            spotEl.textContent = labelText;
            spotEl.style.color = "white";
            spotEl.style.textShadow = "0px 0px 4px black";
            spotEl.style.fontSize = "12px";
            spotEl.style.backgroundColor = "rgba(0,0,0,0.5)";
            spotEl.style.padding = "2px 6px";
            spotEl.style.borderRadius = "4px";

            // ===== EDGE EDITING MODE =====
            if (isEdgeEditing && hotspot.points) {
                spotEl.style.display = "block"; // Show label during editing

                // Render vertex handles
                hotspot.points.forEach((pt, idx) => {
                    const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    handle.setAttribute("cx", pt[0].toString());
                    handle.setAttribute("cy", pt[1].toString());
                    handle.setAttribute("r", "1.2");
                    handle.style.fill = "#fff";
                    handle.style.stroke = "#4caf50";
                    handle.style.strokeWidth = "0.5";
                    handle.style.cursor = "grab";
                    handle.style.setProperty("vector-effect", "non-scaling-stroke");

                    handle.onmousedown = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        // Save snapshot for undo
                        this.undoStack.push(hotspot.points!.map(p => [...p]) as [number, number][]);

                        const onHandleMove = (evt: MouseEvent) => {
                            const rect = img.getBoundingClientRect();
                            let newX = ((evt.clientX - rect.left) / rect.width) * 100;
                            let newY = ((evt.clientY - rect.top) / rect.height) * 100;
                            newX = Math.max(0, Math.min(100, newX));
                            newY = Math.max(0, Math.min(100, newY));

                            if (hotspot.points) {
                                hotspot.points[idx] = [newX, newY];
                                handle.setAttribute("cx", newX.toString());
                                handle.setAttribute("cy", newY.toString());

                                // Update shape - use smooth path for ellipse, polygon points for others
                                if (isEllipse) {
                                    shape.setAttribute("d", smoothClosedPath(hotspot.points));
                                } else {
                                    const newPts = hotspot.points.map(p => `${p[0]},${p[1]}`).join(" ");
                                    shape.setAttribute("points", newPts);
                                }

                                // Update label pos (centroid)
                                const [cX, cY] = centroid(hotspot.points);
                                spotEl.style.left = `${cX}%`;
                                spotEl.style.top = `${cY}%`;
                            }
                        };

                        const onHandleUp = () => {
                            document.removeEventListener("mousemove", onHandleMove);
                            document.removeEventListener("mouseup", onHandleUp);
                            this.plugin.saveSettings();
                        };

                        document.addEventListener("mousemove", onHandleMove);
                        document.addEventListener("mouseup", onHandleUp);
                    };

                    displaySvg.appendChild(handle);
                });

                // ✅ Confirm and ❌ Cancel buttons (positioned near top-right of shape bounding box)
                const xs = hotspot.points.map(p => p[0]);
                const ys = hotspot.points.map(p => p[1]);
                const maxXPct = Math.max(...xs);
                const minYPct = Math.min(...ys);

                const btnContainer = overlay.createDiv({ cls: "edge-edit-btns" });
                btnContainer.style.position = "absolute";
                btnContainer.style.left = `${maxXPct}%`;
                btnContainer.style.top = `${minYPct}%`;
                btnContainer.style.transform = "translate(5px, -100%)";

                const confirmBtn = btnContainer.createEl("button", { text: "✅", cls: "btn-confirm" });
                confirmBtn.title = "Confirm edges";

                const cancelBtn = btnContainer.createEl("button", { text: "❌", cls: "btn-cancel" });
                cancelBtn.title = "Delete shape (Esc)";

                confirmBtn.onclick = () => {
                    this.editingEdgesHotspotId = null;
                    this.undoStack = [];
                    // If hotspot has no name yet, show the name/folder modal
                    if (!hotspot.name || hotspot.name.trim() === "") {
                        this.showNewRegionModal(hotspot, currentProfile);
                    } else {
                        this.plugin.saveSettings();
                        this.renderRoom();
                    }
                };

                cancelBtn.onclick = () => {
                    // Delete the shape
                    const idx = currentProfile.hotspots.findIndex(h => h.id === hotspot.id);
                    if (idx >= 0) currentProfile.hotspots.splice(idx, 1);
                    this.editingEdgesHotspotId = null;
                    this.selectedHotspotId = null;
                    this.undoStack = [];
                    this.plugin.saveSettings();
                    this.renderRoom();
                    new Notice("Shape deleted");
                };

                // Allow dragging the whole shape during edge editing
                shape.onmousedown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.undoStack.push(hotspot.points!.map(p => [...p]) as [number, number][]);
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const rect = img.getBoundingClientRect();
                    const origPts = hotspot.points!.map(p => [...p]);

                    const onMove = (evt: MouseEvent) => {
                        const dx = ((evt.clientX - startX) / rect.width) * 100;
                        const dy = ((evt.clientY - startY) / rect.height) * 100;
                        hotspot.points = origPts.map(p => [p[0] + dx, p[1] + dy]) as [number, number][];
                        if (isEllipse) {
                            shape.setAttribute("d", smoothClosedPath(hotspot.points));
                        } else {
                            const newPts = hotspot.points.map(p => `${p[0]},${p[1]}`).join(" ");
                            shape.setAttribute("points", newPts);
                        }
                    };

                    const onUp = () => {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                        this.plugin.saveSettings();
                        this.renderRoom();
                    };

                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                };
            }
            // ===== EDIT MODE (not edge editing) =====
            else if (this.isEditMode) {
                shape.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    // Show context menu near click
                    const existingMenu = document.querySelector(".shape-context-menu");
                    if (existingMenu) existingMenu.remove();

                    const menu = document.body.createDiv({ cls: "shape-context-menu" });
                    menu.style.left = `${e.clientX}px`;
                    menu.style.top = `${e.clientY}px`;

                    const makeItem = (text: string, onClick: () => void) => {
                        const item = menu.createDiv({ cls: "shape-menu-item" });
                        item.textContent = text;
                        item.onclick = () => {
                            menu.remove();
                            onClick();
                        };
                    };

                    makeItem("✏️ Edit Edges", () => {
                        this.editingEdgesHotspotId = hotspot.id;
                        this.selectedHotspotId = hotspot.id;
                        this.undoStack = hotspot.points ? [hotspot.points.map(p => [...p]) as [number, number][]] : [];
                        this.renderRoom();
                    });

                    makeItem("🔗 Edit Name & Link", () => {
                        this.openEditHotspotModal(hotspot, null);
                    });

                    makeItem("🗑️ Delete Region", () => {
                        const idx = currentProfile.hotspots.findIndex(h => h.id === hotspot.id);
                        if (idx >= 0) currentProfile.hotspots.splice(idx, 1);
                        this.selectedHotspotId = null;
                        this.plugin.saveSettings();
                        this.renderRoom();
                        new Notice(`Deleted: ${hotspot.name || "Unnamed"}`);
                    });

                    // Close menu on click outside
                    const closeMenu = (ev: MouseEvent) => {
                        if (!menu.contains(ev.target as Node)) {
                            menu.remove();
                            document.removeEventListener("mousedown", closeMenu);
                        }
                    };
                    setTimeout(() => document.addEventListener("mousedown", closeMenu), 50);
                };

                // Hover effect in edit mode
                shape.onmouseenter = () => {
                    if (!isEdgeEditing && !isSelected) {
                        shape.style.fill = "rgba(255, 255, 255, 0.15)";
                        shape.style.stroke = "rgba(255, 255, 255, 0.8)";
                    }
                    spotEl.style.display = "block";
                };
                shape.onmouseleave = () => {
                    if (!isEdgeEditing && !isSelected) {
                        shape.style.fill = "rgba(255, 255, 255, 0.1)";
                        shape.style.stroke = "rgba(255, 255, 255, 0.5)";
                    }
                    if (!isEdgeEditing) spotEl.style.display = "none";
                };
            }
            // ===== VIEW MODE =====
            else {
                shape.onclick = (e) => {
                    e.stopPropagation();
                    this.showZoneFiles(hotspot);
                };
                shape.onmouseenter = () => {
                    shape.style.fill = "rgba(255, 255, 255, 0.2)";
                    shape.style.stroke = "rgba(255, 255, 255, 0.8)";
                    shape.style.strokeWidth = "2";
                    spotEl.style.display = "block";
                    spotEl.addClass("is-active");
                };
                shape.onmouseleave = () => {
                    shape.style.fill = "transparent";
                    shape.style.stroke = "transparent";
                    spotEl.style.display = "none";
                    spotEl.removeClass("is-active");
                };
            }
        });
    }


    async createNewProfile() {
        // New Profile Modal? Or just a prompt?
        // Simple separate prompt for now
        // Actually modal is better but for speed let's use a basic modal logic
        const modal = document.body.createDiv({ cls: "hotspot-modal zone-detail-panel" });
        modal.style.zIndex = "9999";
        modal.createDiv({ cls: "panel-header" }).createEl("h2", { text: "Create New Profile" });
        const content = modal.createDiv({ cls: "panel-file-list" });
        content.style.padding = "20px";

        content.createEl("label", { text: "Profile Name" });
        const nameInput = content.createEl("input", { attr: { type: "text", placeholder: "e.g. Living Room..." } });
        nameInput.style.width = "100%";
        nameInput.style.marginBottom = "15px";

        content.createEl("label", { text: "Image Filename (in plugin folder)" });
        const imgInput = content.createEl("input", { attr: { type: "text", placeholder: "room-bg.png" } });
        imgInput.style.width = "100%";
        imgInput.style.marginBottom = "20px";

        const btnRow = content.createDiv({ cls: "modal-btn-row" });
        const saveBtn = btnRow.createEl("button", { text: "Create Profile", cls: "mod-cta" });
        const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

        saveBtn.onclick = async () => {
            if (nameInput.value) {
                const newProfile: Profile = {
                    id: Date.now().toString(),
                    name: nameInput.value,
                    imagePath: imgInput.value || "room-bg.png",
                    hotspots: []
                };
                this.plugin.settings.profiles.push(newProfile);
                this.plugin.settings.activeProfileId = newProfile.id;
                await this.plugin.saveSettings();
                modal.remove();
                this.renderRoom();
            }
        };

        cancelBtn.onclick = () => modal.remove();
    }

    async showZoneFiles(hotspot: Hotspot, currentPath: string | null = null) {
        let path = currentPath || hotspot.path;

        if (!path || path.trim() === "") {
            new Notice(`Region "${hotspot.name}" has no linked folder. Edit it to set a path.`);
            return;
        }

        let linkSubpath = "";

        // Handle links with hash (e.g. "path/to/file#header")
        if (path.includes("#")) {
            const parts = path.split("#");
            path = parts[0];
            linkSubpath = "#" + parts[1];
        }

        // Try to resolve file or folder
        let abstractFile = this.app.vault.getAbstractFileByPath(path);

        // If not found, try adding .md extension (common convenience)
        if (!abstractFile && !path.endsWith(".md")) {
            const tryFile = this.app.vault.getAbstractFileByPath(path + ".md");
            if (tryFile) abstractFile = tryFile;
        }

        // If it is a file, open it directly instead of showing a folder view
        if (abstractFile instanceof TFile) {
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.openFile(abstractFile);

            if (linkSubpath) {
                // Wait a bit for file to load? usually setEphemeralState handles this
                const view = leaf.view;
                // @ts-ignore
                if (view.setEphemeralState) {
                    // @ts-ignore
                    await view.setEphemeralState({ subpath: linkSubpath });
                }
            }
            return;
        }

        const container = this.containerEl.children[1];

        // Find or create panel
        let panel = container.querySelector(".zone-detail-panel") as HTMLElement;
        if (!currentPath && panel) {
            panel.remove();
            // @ts-ignore
            panel = null;
        }

        if (panel) {
            const header = panel.querySelector(".panel-header h2");
            if (header) header.textContent = path.split("/").pop() || hotspot.name;
        } else {
            panel = container.createDiv({ cls: "zone-detail-panel" });
            const header = panel.createDiv({ cls: "panel-header" });
            header.innerHTML = ""; // Clear existing

            // Flex container for header controls
            const headerControls = header.createDiv({ cls: "header-controls" });
            headerControls.style.display = "flex";
            headerControls.style.alignItems = "center";
            headerControls.style.gap = "10px";
            headerControls.style.width = "100%";

            const title = headerControls.createEl("h2", { text: hotspot.name });
            title.style.marginRight = "auto";

            // Edit Button
            const editBtn = headerControls.createEl("button", { text: "✏️" });
            editBtn.title = "Edit Region Path";
            editBtn.onclick = () => this.openEditHotspotModal(hotspot, panel);

            const closeBtn = headerControls.createEl("button", { text: "✕" });
            closeBtn.onclick = () => panel.remove();

            panel.createDiv({ cls: "panel-file-list" });
        }

        const listContainer = panel.querySelector(".panel-file-list");
        listContainer?.empty();

        const folder = this.app.vault.getAbstractFileByPath(path);

        if (!(folder instanceof TFolder)) {
            listContainer?.createDiv({ text: `❌ Path not found: ${path}`, cls: "empty-msg" });
            return;
        }

        const children = folder.children;

        if (currentPath && currentPath !== hotspot.path) {
            const backItem = listContainer?.createDiv({ cls: "file-item back-item" });
            backItem?.createSpan({ text: "⬅️ BACK" });
            backItem!.onclick = () => {
                const parts = path.split("/");
                parts.pop();
                this.showZoneFiles(hotspot, parts.join("/"));
            };
        }

        if (children.length === 0) {
            listContainer?.createDiv({ text: "Empty...", cls: "empty-msg" });
            return;
        }

        // Sort controls
        const sortBar = listContainer?.createDiv({ cls: "sort-bar" });
        if (sortBar) {
            sortBar.style.display = "flex";
            sortBar.style.justifyContent = "flex-end";
            sortBar.style.padding = "4px 8px";
            sortBar.style.borderBottom = "1px solid var(--background-modifier-border, #333)";

            const sortBtn = sortBar.createEl("button", { text: "⇅ Sort" });
            sortBtn.style.fontSize = "12px";
            sortBtn.style.padding = "2px 8px";
            sortBtn.style.borderRadius = "4px";
            sortBtn.style.cursor = "pointer";
            sortBtn.style.backgroundColor = "transparent";
            sortBtn.style.border = "1px solid var(--background-modifier-border, #555)";
            sortBtn.style.color = "var(--text-muted, #aaa)";

            sortBtn.onclick = (e) => {
                e.stopPropagation();
                const existing = document.querySelector(".sort-dropdown-menu");
                if (existing) { existing.remove(); return; }

                const dropdown = document.body.createDiv({ cls: "sort-dropdown-menu" });
                const rect = sortBtn.getBoundingClientRect();
                dropdown.style.left = `${rect.right}px`;
                dropdown.style.top = `${rect.bottom + 4}px`;
                dropdown.style.transform = "translateX(-100%)";

                const options: { key: string; label: string }[] = [
                    { key: "name-az", label: "File name (A to Z)" },
                    { key: "name-za", label: "File name (Z to A)" },
                    { key: "modified-new", label: "Modified time (new to old)" },
                    { key: "modified-old", label: "Modified time (old to new)" },
                    { key: "created-new", label: "Created time (new to old)" },
                    { key: "created-old", label: "Created time (old to new)" },
                ];

                options.forEach(opt => {
                    const isActive = this.sortType === opt.key;
                    const item = dropdown.createDiv({
                        cls: `sort-option ${isActive ? "is-active" : ""}`,
                        text: `${opt.label}${isActive ? " ✓" : ""}`
                    });
                    item.onclick = () => {
                        this.sortType = opt.key;
                        dropdown.remove();
                        this.showZoneFiles(hotspot, path);
                    };
                });

                const closeDropdown = (ev: MouseEvent) => {
                    if (!dropdown.contains(ev.target as Node) && ev.target !== sortBtn) {
                        dropdown.remove();
                        document.removeEventListener("mousedown", closeDropdown);
                    }
                };
                setTimeout(() => document.addEventListener("mousedown", closeDropdown), 50);
            };
        }

        let folders = children.filter(f => f instanceof TFolder) as TFolder[];
        let files = children.filter(f => f instanceof TFile && ["md", "canvas", "png", "jpg", "jpeg", "base"].includes(f.extension)) as TFile[];

        // Apply sort
        const sortFn = (a: any, b: any): number => {
            switch (this.sortType) {
                case "name-az": return a.name.localeCompare(b.name);
                case "name-za": return b.name.localeCompare(a.name);
                case "modified-new": return (b.stat?.mtime || 0) - (a.stat?.mtime || 0);
                case "modified-old": return (a.stat?.mtime || 0) - (b.stat?.mtime || 0);
                case "created-new": return (b.stat?.ctime || 0) - (a.stat?.ctime || 0);
                case "created-old": return (a.stat?.ctime || 0) - (b.stat?.ctime || 0);
                default: return 0;
            }
        };
        folders.sort(sortFn);
        files.sort(sortFn);

        // Render Folders
        folders.forEach(f => {
            const item = listContainer?.createDiv({ cls: "file-item folder-item" });
            item?.createSpan({ text: "📁 " });
            item?.createSpan({ text: f.name, cls: "file-name" });
            item!.onclick = (e) => {
                e.stopPropagation();
                this.showZoneFiles(hotspot, f.path);
            };
        });

        // Render Files
        files.forEach((f: TFile) => {
            const item = listContainer?.createDiv({ cls: "file-item" });
            let icon = "📄 ";
            if (f.extension === "canvas") icon = "🎨 ";
            if (f.extension === "base") icon = "🗃️ ";
            item?.createSpan({ text: icon });
            item?.createSpan({ text: f.basename, cls: "file-name" });
            item!.onclick = () => {
                this.app.workspace.getLeaf("tab").openFile(f);
            };
        });
    }


    // Modal shown after confirming edges - asks for region name and folder path
    showNewRegionModal(hotspot: Hotspot, profile: Profile) {
        const modal = document.body.createDiv({ cls: "hotspot-modal zone-detail-panel" });
        modal.style.zIndex = "9999";

        modal.createDiv({ cls: "panel-header" }).createEl("h2", { text: "🗺️ Name This Region" });

        const content = modal.createDiv({ cls: "panel-file-list" });
        content.style.padding = "20px";

        // Region Name
        content.createEl("label", { text: "Region Name" });
        const nameInput = content.createEl("input", {
            attr: { type: "text", placeholder: "e.g. Living Room, Kitchen..." }
        });
        nameInput.style.width = "100%";
        nameInput.style.marginBottom = "15px";
        nameInput.style.padding = "6px 10px";
        nameInput.style.borderRadius = "4px";

        // Folder Path
        content.createEl("label", { text: "Linked Folder Path" });
        const pathInput = content.createEl("input", {
            attr: { type: "text", placeholder: "e.g. Projects/Room1" }
        });
        pathInput.style.width = "100%";
        pathInput.style.marginBottom = "20px";
        pathInput.style.padding = "6px 10px";
        pathInput.style.borderRadius = "4px";

        // Info text
        const infoText = content.createEl("p", {
            text: "The folder path should match a folder in your vault. Clicking this region will show files from that folder."
        });
        infoText.style.fontSize = "12px";
        infoText.style.color = "rgba(255,255,255,0.5)";
        infoText.style.marginBottom = "15px";

        // Buttons
        const btnRow = content.createDiv({ cls: "modal-btn-row" });
        btnRow.style.display = "flex";
        btnRow.style.gap = "10px";

        const saveBtn = btnRow.createEl("button", { text: "💾 Save Region", cls: "mod-cta" });
        const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

        saveBtn.onclick = async () => {
            const name = nameInput.value.trim();
            if (!name) {
                new Notice("Please enter a region name!");
                nameInput.focus();
                return;
            }

            hotspot.name = name;
            hotspot.path = pathInput.value.trim();
            this.selectedHotspotId = hotspot.id;
            this.drawingShapeType = null;
            await this.plugin.saveSettings();

            modal.remove();
            this.renderRoom();
            new Notice(`Region "${name}" created!`);
        };

        cancelBtn.onclick = () => {
            // Remove the hotspot since user cancelled naming
            const idx = profile.hotspots.findIndex(h => h.id === hotspot.id);
            if (idx >= 0) profile.hotspots.splice(idx, 1);
            this.drawingShapeType = null;
            this.selectedHotspotId = null;
            this.plugin.saveSettings();
            modal.remove();
            this.renderRoom();
        };

        // Focus name input
        setTimeout(() => nameInput.focus(), 100);
    }


    async openEditHotspotModal(hotspot: Hotspot, panelToClose: HTMLElement | null) {
        if (panelToClose) panelToClose.remove();

        const modal = document.body.createDiv({ cls: "hotspot-modal zone-detail-panel" });
        modal.style.zIndex = "9999";

        modal.createDiv({ cls: "panel-header" }).createEl("h2", { text: "Edit Region" });

        const content = modal.createDiv({ cls: "panel-file-list" });
        content.style.padding = "20px";

        content.createEl("label", { text: "Region Name" });
        const nameInput = content.createEl("input", { attr: { type: "text", value: hotspot.name } });
        nameInput.style.width = "100%";
        nameInput.style.marginBottom = "15px";

        content.createEl("label", { text: "Path (Folder or File)" });
        const pathInput = content.createEl("input", { attr: { type: "text", value: hotspot.path } });
        pathInput.style.width = "100%";
        pathInput.style.marginBottom = "20px";

        const btnRow = content.createDiv({ cls: "modal-btn-row" });
        const saveBtn = btnRow.createEl("button", { text: "💾 Save Changes", cls: "mod-cta" });
        const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

        saveBtn.onclick = async () => {
            if (nameInput.value) {
                hotspot.name = nameInput.value;
                hotspot.path = pathInput.value;
                await this.plugin.saveSettings();
                new Notice(`Region updated: ${hotspot.name}`);
                modal.remove();
                this.renderRoom();
            }
        };

        cancelBtn.onclick = () => modal.remove();
    }
}

class LoomViewSettingTab extends PluginSettingTab {
    plugin: LoomViewPlugin;

    constructor(app: App, plugin: LoomViewPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Image Map Settings' });

        // DISPLAY SETTINGS
        new Setting(containerEl)
            .setName('Label Display Style')
            .setDesc('What text to show when hovering over a region')
            .addDropdown(drop => drop
                .addOption('name', 'Region Name Only')
                .addOption('path', 'Smart Path Name (Auto)')
                .addOption('both', 'Both')
                .setValue(this.plugin.settings.displayLabelType)
                .onChange(async (value: "name" | "path" | "both") => {
                    this.plugin.settings.displayLabelType = value;
                    await this.plugin.saveSettings();
                }));

        // PROFILES SETTINGS
        containerEl.createEl("h3", { text: "Profiles Management" });

        new Setting(containerEl)
            .setName("Add New Profile")
            .setDesc("Create a new room profile")
            .addButton(btn => btn
                .setButtonText("Creat New Profile")
                .setCta()
                .onClick(async () => {
                    const id = Date.now().toString();
                    this.plugin.settings.profiles.push({
                        id: id,
                        name: "New Profile",
                        imagePath: "room-bg.png",
                        hotspots: []
                    });
                    this.plugin.settings.activeProfileId = id; // Switch to new
                    await this.plugin.saveSettings();
                    this.display();
                }));

        this.plugin.settings.profiles.forEach((profile, index) => {
            const pDiv = containerEl.createDiv({ cls: "profile-setting-item" });
            pDiv.style.border = "1px solid var(--background-modifier-border)";
            pDiv.style.padding = "10px";
            pDiv.style.marginBottom = "10px";
            pDiv.style.borderRadius = "4px";

            new Setting(pDiv)
                .setName(`Profile: ${profile.name}`)
                .addText(text => text
                    .setPlaceholder("Profile Name")
                    .setValue(profile.name)
                    .onChange(async (val) => {
                        profile.name = val;
                        await this.plugin.saveSettings();
                    }))
                .addText(text => text
                    .setPlaceholder("Image Path (e.g. room2.png)")
                    .setValue(profile.imagePath)
                    .onChange(async (val) => {
                        profile.imagePath = val;
                        await this.plugin.saveSettings();
                    }))
                .addButton(btn => btn
                    .setButtonText("Delete")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.profiles.splice(index, 1);
                        if (this.plugin.settings.activeProfileId === profile.id) {
                            this.plugin.settings.activeProfileId = this.plugin.settings.profiles[0]?.id || "";
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            // List hotspots within profile
            if (profile.hotspots.length > 0) {
                const hList = pDiv.createDiv({ cls: "hotspot-list" });
                hList.createEl("h4", { text: "Hotspots in this profile:" });
                profile.hotspots.forEach((h, hIndex) => {
                    const hRow = hList.createDiv({ cls: "hotspot-row" });
                    hRow.style.display = "flex";
                    hRow.style.alignItems = "center";
                    hRow.style.gap = "10px";
                    hRow.createSpan({ text: h.name });

                    const delBtn = hRow.createEl("button", { text: "x" });
                    delBtn.style.color = "red";
                    delBtn.onclick = async () => {
                        profile.hotspots.splice(hIndex, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    };
                });
            }
        });
    }
}

export default class LoomViewPlugin extends Plugin {
    settings: LoomViewSettings;

    async onload() {
        await this.loadSettings();

        // MIGRATION: If old settings exist but no profiles, create default profile
        if (this.settings.profiles.length === 0) {
            const oldHotspots = this.settings.hotspots || [];
            const oldImage = this.settings.roomImagePath || "room-bg.png";

            const defaultProfile: Profile = {
                id: "default",
                name: "Default Room",
                imagePath: oldImage,
                hotspots: oldHotspots
            };

            this.settings.profiles.push(defaultProfile);
            this.settings.activeProfileId = "default";

            // Clear old settings to avoid confusion later? user might downgrade so maybe keep them sync?
            // For now, let's just use profiles.
            await this.saveSettings();
        }

        this.registerView(
            VIEW_TYPE_LOOM,
            (leaf) => new LoomView(leaf, this)
        );

        this.addRibbonIcon('map', 'Open Image Map', (evt: MouseEvent) => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-image-map',
            name: 'Open Image Map',
            callback: () => {
                this.activateView();
            }
        });

        this.addSettingTab(new LoomViewSettingTab(this.app, this));
    }

    async onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_LOOM);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf(true);
            await leaf.setViewState({ type: VIEW_TYPE_LOOM, active: true });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }
}
