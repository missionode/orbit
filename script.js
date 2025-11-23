// First, check for feature compatibility
if (!('showOpenFilePicker' in window)) {
    alert("Your browser does not support the File System Access API, which is required for file synchronization. Please try a modern browser like Chrome, Edge, or Opera.");
}

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const world = document.getElementById('world'); // New: Reference to the world container
    const nodesContainer = document.getElementById('nodes-container');
    const connectionsSvg = document.getElementById('connections');
    const syncButton = document.getElementById('sync-button');

    let state = {
        canvases: [
            {
                id: 'default',
                title: 'Untitled Canvas',
                nodes: [],
                pan: { x: 0, y: 0 },
                scale: 1,
                lastModified: new Date().toISOString()
            }
        ],
        currentCanvasId: 'default'
    };

    // Helper to get current canvas
    const getCurrentCanvas = () => state.canvases.find(c => c.id === state.currentCanvasId) || state.canvases[0];

    // Viewport State (Now derived from current canvas, but we keep local vars for performance)
    let pan = { x: 0, y: 0 };
    let scale = 1;

    // Interaction State
    let linkingFromId = null;

    let fileHandle = null;

    // History State (Per canvas? For simplicity, global history clears on switch)
    let history = [];
    let historyIndex = -1;
    let isUndoing = false;

    const pushHistory = () => {
        if (isUndoing) return;

        const currentState = JSON.parse(JSON.stringify(state));

        // If we are not at the end of history, discard future
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }

        history.push(currentState);
        historyIndex++;

        // Limit history size
        if (history.length > 50) {
            history.shift();
            historyIndex--;
        }
    };

    const undo = () => {
        if (historyIndex > 0) {
            isUndoing = true;
            historyIndex--;
            state = JSON.parse(JSON.stringify(history[historyIndex]));
            saveState(true); // Save to local storage but don't push to history
            render();
            isUndoing = false;
        }
    };

    const redo = () => {
        if (historyIndex < history.length - 1) {
            isUndoing = true;
            historyIndex++;
            state = JSON.parse(JSON.stringify(history[historyIndex]));
            saveState(true);
            render();
            isUndoing = false;
        }
    };

    // Auto-save logic
    let saveTimeout;
    const saveToFile = async () => {
        if (!fileHandle) return;
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(state, null, 2));
            await writable.close();
            console.log("Auto-saved to file.");
        } catch (err) {
            console.error("Failed to auto-save to file:", err);
            fileHandle = null;
            alert("Connection to db.json lost! Your changes are saved locally, but file sync has stopped.\n\nPlease click the Sync button to reconnect.");
        }
    };

    const debouncedSaveToFile = () => {
        if (!fileHandle) return;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveToFile, 1000);
    };

    const saveState = (skipHistory = false) => {
        const currentCanvas = getCurrentCanvas();
        currentCanvas.lastModified = new Date().toISOString();
        // Update current canvas props
        currentCanvas.pan = pan;
        currentCanvas.scale = scale;

        localStorage.setItem('orbitMindData', JSON.stringify(state));

        if (!skipHistory) {
            pushHistory();
        }
        debouncedSaveToFile();
    };

    const loadState = () => {
        const savedData = localStorage.getItem('orbitMindData');
        if (savedData) {
            const parsed = JSON.parse(savedData);

            // Migration: Check if it's the old single-canvas format
            if (Array.isArray(parsed.nodes)) {
                state.canvases[0].nodes = parsed.nodes;
                state.canvases[0].lastModified = parsed.lastModified || new Date().toISOString();
            } else {
                // New format
                state = parsed;
            }

            // Ensure all nodes have IDs (Migration safety)
            state.canvases.forEach(canvas => {
                if (!canvas.nodes) canvas.nodes = [];
                canvas.nodes.forEach(n => {
                    if (!n.id) n.id = `node-${Date.now()}-${Math.random()}`;
                    if (!n.parentIds) {
                        n.parentIds = [];
                        if (n.parentId) n.parentIds.push(n.parentId);
                    }
                    delete n.parentId;
                });
            });
        }

        // Load viewport from current canvas
        const currentCanvas = getCurrentCanvas();
        pan = currentCanvas.pan || { x: 0, y: 0 };
        scale = currentCanvas.scale || 1;

        // Update Title UI
        document.getElementById('canvas-title').innerText = currentCanvas.title;
    };

    // New: Function to apply pan and scale to the world
    const updateTransform = () => {
        world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
        // The SVG element itself should also be transformed to match the world's coordinate system
        // Its width/height should be large enough to cover the visible area, but its content
        // will be drawn relative to its own (transformed) coordinate system.
        // For simplicity, we'll let the CSS transform handle the visual positioning of the SVG.
    };

    const render = () => {
        renderNodes();
        renderConnections();
        renderGroups();
    };

    const renderNodes = () => {
        const currentCanvas = getCurrentCanvas();
        const existingNodeIds = new Set();

        // Calculate parent counts to identify leaf nodes
        const parentCounts = {};
        currentCanvas.nodes.forEach(n => {
            if (n.parentIds) {
                n.parentIds.forEach(pId => {
                    parentCounts[pId] = (parentCounts[pId] || 0) + 1;
                });
            }
        });

        currentCanvas.nodes.forEach(nodeData => {
            existingNodeIds.add(nodeData.id);
            let nodeEl = document.querySelector(`.node[data-id="${nodeData.id}"]`);

            if (nodeEl) {
                // Update position
                nodeEl.style.left = `${nodeData.x}px`;
                nodeEl.style.top = `${nodeData.y}px`;

                // Update heading if it changed externally
                const headingEl = nodeEl.querySelector('.node-heading');
                if (headingEl && headingEl.innerText !== (nodeData.heading || nodeData.content || '') && document.activeElement !== headingEl) {
                    headingEl.innerText = nodeData.heading || nodeData.content || '';
                }

                // Update description if it changed externally
                const descEl = nodeEl.querySelector('.node-description');
                if (descEl && descEl.innerText !== (nodeData.description || '') && document.activeElement !== descEl) {
                    descEl.innerText = nodeData.description || '';
                }

                // Update instructions visibility and content
                const instructionsEl = nodeEl.querySelector('.node-instructions');
                if (instructionsEl) {
                    instructionsEl.style.display = nodeData.marked ? 'block' : 'none';

                    // Refresh tags
                    const tagsList = instructionsEl.querySelector('.tags-list');
                    if (tagsList) {
                        tagsList.innerHTML = '';
                        (nodeData.instructions || []).forEach((inst, index) => {
                            const tag = document.createElement('span');
                            tag.classList.add('instruction-tag');
                            tag.innerText = inst;
                            tag.title = 'Click to remove';
                            tag.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (confirm('Remove this instruction?')) {
                                    nodeData.instructions.splice(index, 1);
                                    saveState();
                                    render(); // Full render to update this list
                                }
                            });
                            tagsList.appendChild(tag);
                        });
                    }
                }

                // Update color visual cues
                if (nodeData.color) {
                    nodeEl.style.borderColor = nodeData.marked ? '#00ff88' : nodeData.color;
                    nodeEl.style.boxShadow = nodeData.marked ? '0 4px 12px rgba(0, 255, 136, 0.4)' : `0 4px 12px ${nodeData.color}40`;
                    const colorIcon = nodeEl.querySelector('.color-icon');
                    if (colorIcon) colorIcon.style.backgroundColor = nodeData.color;
                } else if (nodeData.marked) {
                    nodeEl.style.borderColor = '#00ff88';
                    nodeEl.style.boxShadow = '0 4px 12px rgba(0, 255, 136, 0.4)';
                }

                // Update link handle visibility
                const linkHandle = nodeEl.querySelector('.link-handle');
                if (linkHandle) {
                    linkHandle.style.display = linkingFromId === nodeData.id ? 'flex' : 'none';
                }

                // Leaf Node Logic
                const isLeaf = !parentCounts[nodeData.id];
                const markBtn = nodeEl.querySelector('.mark-complete');
                const addChildBtn = nodeEl.querySelector('.add-child');
                const linkBtn = nodeEl.querySelector('.link-node');

                if (markBtn) {
                    markBtn.style.display = isLeaf ? 'block' : 'none';
                    markBtn.style.color = nodeData.marked ? '#00ff88' : '#aaa';
                }

                if (addChildBtn) {
                    if (nodeData.marked) {
                        addChildBtn.style.opacity = '0.3';
                        addChildBtn.style.pointerEvents = 'none';
                    } else {
                        addChildBtn.style.opacity = '1';
                        addChildBtn.style.pointerEvents = 'auto';
                    }
                }

                // Also disable linking FROM a marked node? Maybe.
                if (linkBtn) {
                    if (nodeData.marked) {
                        linkBtn.style.opacity = '0.3';
                        linkBtn.style.pointerEvents = 'none';
                    } else {
                        linkBtn.style.opacity = '1';
                        linkBtn.style.pointerEvents = 'auto';
                    }
                }

            } else {
                const newNode = createNodeElement(nodeData);
                // Apply leaf logic immediately to new node
                const isLeaf = !parentCounts[nodeData.id];
                const markBtn = newNode.querySelector('.mark-complete');
                if (markBtn) {
                    markBtn.style.display = isLeaf ? 'block' : 'none';
                }
            }
        });

        // Remove deleted nodes
        const allNodes = document.querySelectorAll('.node');
        allNodes.forEach(el => {
            if (!existingNodeIds.has(el.dataset.id)) {
                el.remove();
            }
        });
    };

    const renderGroups = () => {
        const groupsSvg = document.getElementById('groups');
        groupsSvg.innerHTML = '';
        const currentCanvas = getCurrentCanvas();

        // 1. Group children by parent
        // Since a node can have multiple parents, it can belong to multiple groups.
        const childrenByParent = {};
        currentCanvas.nodes.forEach(node => {
            if (node.parentIds && node.parentIds.length > 0) {
                node.parentIds.forEach(pId => {
                    if (!childrenByParent[pId]) {
                        childrenByParent[pId] = [];
                    }
                    childrenByParent[pId].push(node);
                });
            }
        });

        // 2. Draw bubbles for parents with > 1 children
        Object.entries(childrenByParent).forEach(([parentId, children]) => {
            if (children.length > 1) {
                const parent = currentCanvas.nodes.find(n => n.id === parentId);
                if (parent && parent.color) {
                    drawGroupBubble(groupsSvg, parent, children);
                }
            }
        });

        // Sync size with connections SVG (which is synced to bounding box)
        // We can just reuse the same sizing logic or let them share it.
        // For simplicity, we'll rely on the CSS/JS update in renderConnections to handle the 'world' bounds,
        // but we need to ensure the SVG attributes are set if we use the bounding box logic.
        // Actually, let's update the sizing in renderConnections to apply to BOTH SVGs.
    };

    const drawGroupBubble = (svg, parent, children) => {
        // Calculate radius to encompass all children
        // Center is Parent
        // We need DOM elements for precise sizes, but we can estimate or use state.
        // Let's use state x/y + fixed size approximation.

        const parentCx = parent.x + 75; // Half width
        const parentCy = parent.y + 40; // Half height

        let maxDist = 0;

        children.forEach(child => {
            const childCx = child.x + 75;
            const childCy = child.y + 40;
            const dist = Math.sqrt(Math.pow(childCx - parentCx, 2) + Math.pow(childCy - parentCy, 2));
            // Add node radius approx (half diagonal of 150x80 is ~85)
            maxDist = Math.max(maxDist, dist + 100);
        });

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', parentCx);
        circle.setAttribute('cy', parentCy);
        circle.setAttribute('r', maxDist);
        circle.setAttribute('fill', parent.color);
        circle.setAttribute('fill-opacity', '0.05'); // Even more subtle for overlaps
        circle.setAttribute('stroke', parent.color);
        circle.setAttribute('stroke-opacity', '0.1');
        circle.setAttribute('stroke-width', '1');

        svg.appendChild(circle);
    };



    const renderConnections = () => {
        const currentCanvas = getCurrentCanvas();

        // Calculate bounding box of all nodes to size the SVG correctly
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        currentCanvas.nodes.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + 150); // Add node width approximation
            maxY = Math.max(maxY, node.y + 80);  // Add node height approximation
        });

        // Add padding for bezier curves and group bubbles
        const padding = 1000;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const width = maxX - minX;
        const height = maxY - minY;

        // Apply to Connections SVG
        connectionsSvg.style.left = `${minX}px`;
        connectionsSvg.style.top = `${minY}px`;
        connectionsSvg.style.width = `${width}px`;
        connectionsSvg.style.height = `${height}px`;
        connectionsSvg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);

        // Apply to Groups SVG
        const groupsSvg = document.getElementById('groups');
        groupsSvg.style.left = `${minX}px`;
        groupsSvg.style.top = `${minY}px`;
        groupsSvg.style.width = `${width}px`;
        groupsSvg.style.height = `${height}px`;
        groupsSvg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);

        // Optimized rendering: Update existing, create new, remove old
        const activeConnectionIds = new Set();
        const nodeMap = new Map(currentCanvas.nodes.map(n => [n.id, n]));

        currentCanvas.nodes.forEach(node => {
            if (node.parentIds && node.parentIds.length > 0) {
                node.parentIds.forEach(parentId => {
                    if (nodeMap.has(parentId)) {
                        const parent = nodeMap.get(parentId);
                        const connectionId = `conn-${parentId}-${node.id}`;
                        activeConnectionIds.add(connectionId);
                        drawConnection(parent, node, connectionId);
                    }
                });
            }
        });

        // Remove old connections
        const existingGroups = connectionsSvg.querySelectorAll('.connection-group');
        existingGroups.forEach(g => {
            if (!activeConnectionIds.has(g.id)) {
                g.remove();
            }
        });
    };

    // Canvas Management Logic
    const switchCanvas = (direction) => {
        const currentIndex = state.canvases.findIndex(c => c.id === state.currentCanvasId);
        let newIndex;

        if (direction === 'next') {
            newIndex = (currentIndex + 1) % state.canvases.length;
        } else {
            newIndex = (currentIndex - 1 + state.canvases.length) % state.canvases.length;
        }

        // Save current viewport before switching
        const currentCanvas = state.canvases[currentIndex];
        currentCanvas.pan = pan;
        currentCanvas.scale = scale;

        state.currentCanvasId = state.canvases[newIndex].id;

        // Load new viewport
        const newCanvas = state.canvases[newIndex];
        pan = newCanvas.pan || { x: 0, y: 0 };
        scale = newCanvas.scale || 1;

        // Clear history for simplicity
        history = [];
        historyIndex = -1;
        pushHistory(); // Initial history for new canvas

        // Update UI
        document.getElementById('canvas-title').innerText = newCanvas.title;
        saveState(true); // Save switch
        render();
        updateTransform();
    };

    const addCanvas = () => {
        const newId = `canvas-${Date.now()}`;
        const newCanvas = {
            id: newId,
            title: 'Untitled Canvas',
            nodes: [],
            pan: { x: 0, y: 0 },
            scale: 1,
            lastModified: new Date().toISOString()
        };

        state.canvases.push(newCanvas);
        state.currentCanvasId = newId;

        // Reset View
        pan = { x: 0, y: 0 };
        scale = 1;

        history = [];
        historyIndex = -1;
        pushHistory();

        document.getElementById('canvas-title').innerText = newCanvas.title;
        saveState(true);
        render();
        updateTransform();
    };

    // Event Listeners for Canvas UI
    document.getElementById('prev-canvas').addEventListener('click', () => switchCanvas('prev'));
    document.getElementById('next-canvas').addEventListener('click', () => switchCanvas('next'));
    document.getElementById('add-canvas').addEventListener('click', addCanvas);

    const titleEl = document.getElementById('canvas-title');
    titleEl.addEventListener('input', () => {
        const currentCanvas = getCurrentCanvas();
        currentCanvas.title = titleEl.innerText;
        saveState(true); // Skip history for title edits
    });

    document.getElementById('focus-button').addEventListener('click', () => {
        document.body.classList.toggle('focus-mode');
    });

    // Update other functions to use getCurrentCanvas().nodes
    // ... (createNodeElement, deleteNode, etc. need to use getCurrentCanvas().nodes)



    const detachNode = (parentId, childId) => {
        const canvas = getCurrentCanvas();
        if (!canvas || !canvas.nodes) {
            console.error("detachNode: Canvas or nodes missing", canvas);
            return;
        }
        const nodes = canvas.nodes;
        const child = nodes.find(n => n.id === childId);
        if (child && child.parentIds) {
            child.parentIds = child.parentIds.filter(id => id !== parentId);
            saveState();
            render();
        }
    };

    const drawConnection = (parent, child, connectionId) => {
        const parentEl = document.querySelector(`.node[data-id="${parent.id}"]`);
        const childEl = document.querySelector(`.node[data-id="${child.id}"]`);

        if (!parentEl || !childEl) return;

        const pRect = {
            x: parent.x,
            y: parent.y,
            w: parentEl.offsetWidth,
            h: parentEl.offsetHeight
        };

        const cRect = {
            x: child.x,
            y: child.y,
            w: childEl.offsetWidth,
            h: childEl.offsetHeight
        };

        const startX = pRect.x + pRect.w / 2;
        const startY = pRect.y + pRect.h / 2;
        const endX = cRect.x + cRect.w / 2;
        const endY = cRect.y + cRect.h / 2;

        // Bezier curve
        const deltaX = endX - startX;
        const c1x = startX + deltaX * 0.4;
        const c1y = startY;
        const c2x = endX - deltaX * 0.4;
        const c2y = endY;
        const d = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;

        // Check if group exists
        let group = document.getElementById(connectionId);

        if (group) {
            // Update existing
            const line = group.querySelector('.visible-line');
            const hitArea = group.querySelector('.hit-area');

            if (line) {
                line.setAttribute('d', d);
                line.setAttribute('stroke', parent.color || '#555');
            }
            if (hitArea) {
                hitArea.setAttribute('d', d);
            }

            // Update detach button position
            const t = 0.5;
            const midX = Math.pow(1 - t, 3) * startX + 3 * Math.pow(1 - t, 2) * t * c1x + 3 * (1 - t) * Math.pow(t, 2) * c2x + Math.pow(t, 3) * endX;
            const midY = Math.pow(1 - t, 3) * startY + 3 * Math.pow(1 - t, 2) * t * c1y + 3 * (1 - t) * Math.pow(t, 2) * c2y + Math.pow(t, 3) * endY;

            const detachBtn = group.querySelector('.detach-btn');
            if (detachBtn) {
                detachBtn.setAttribute('transform', `translate(${midX - 10}, ${midY - 10})`);
            }

            return; // Done updating
        }

        // Create new group
        group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.id = connectionId;
        group.classList.add('connection-group');
        group.style.pointerEvents = 'all'; // Ensure events are captured

        // 1. Visible Line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.classList.add('visible-line');
        line.setAttribute('d', d);
        line.setAttribute('stroke', parent.color || '#555');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('fill', 'none');

        // 2. Hit Area (Invisible, thicker)
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.classList.add('hit-area');
        hitArea.setAttribute('d', d);
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '20');
        hitArea.setAttribute('fill', 'none');
        hitArea.style.cursor = 'pointer';

        // 3. Detach Button
        // Calculate midpoint of Bezier curve (t=0.5)
        // B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
        const t = 0.5;
        const midX = Math.pow(1 - t, 3) * startX + 3 * Math.pow(1 - t, 2) * t * c1x + 3 * (1 - t) * Math.pow(t, 2) * c2x + Math.pow(t, 3) * endX;
        const midY = Math.pow(1 - t, 3) * startY + 3 * Math.pow(1 - t, 2) * t * c1y + 3 * (1 - t) * Math.pow(t, 2) * c2y + Math.pow(t, 3) * endY;

        const detachBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        detachBtn.classList.add('detach-btn');
        detachBtn.setAttribute('transform', `translate(${midX - 10}, ${midY - 10})`);
        detachBtn.style.display = 'none';
        detachBtn.style.cursor = 'pointer';

        const btnCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        btnCircle.setAttribute('cx', '10');
        btnCircle.setAttribute('cy', '10');
        btnCircle.setAttribute('r', '10');
        btnCircle.setAttribute('fill', '#ff4444');

        const btnMinus = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        btnMinus.setAttribute('x1', '5');
        btnMinus.setAttribute('y1', '10');
        btnMinus.setAttribute('x2', '15');
        btnMinus.setAttribute('y2', '10');
        btnMinus.setAttribute('stroke', 'white');
        btnMinus.setAttribute('stroke-width', '2');

        detachBtn.appendChild(btnCircle);
        detachBtn.appendChild(btnMinus);

        // Event Listeners
        const showBtn = () => detachBtn.style.display = 'block';
        const hideBtn = () => detachBtn.style.display = 'none';

        group.addEventListener('mouseenter', showBtn);
        group.addEventListener('mouseleave', hideBtn);

        // For touch devices, tapping the line toggles the button
        hitArea.addEventListener('click', (e) => {
            e.stopPropagation();
            detachBtn.style.display = detachBtn.style.display === 'none' ? 'block' : 'none';
        });

        detachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Detach this node?')) {
                detachNode(parent.id, child.id);
            }
        });

        group.appendChild(line);
        group.appendChild(hitArea);
        group.appendChild(detachBtn);
        connectionsSvg.appendChild(group);
    };

    const createNodeElement = (nodeData) => {
        const node = document.createElement('div');
        node.classList.add('node');
        node.style.left = `${nodeData.x}px`;
        node.style.top = `${nodeData.y}px`;
        node.dataset.id = nodeData.id;

        // Apply color if present
        if (nodeData.color) {
            node.style.borderColor = nodeData.color;
            node.style.boxShadow = `0 4px 12px ${nodeData.color}40`; // 40 is hex transparency
        }

        // Visual cue if this node is the source of a link
        if (linkingFromId === nodeData.id) {
            node.style.borderColor = '#fff';
            node.style.boxShadow = '0 0 15px #fff';
            node.style.zIndex = '1000';
        }

        const content = document.createElement('div');
        content.classList.add('node-content');
        content.setAttribute('contenteditable', 'true');
        content.innerText = nodeData.content;

        content.addEventListener('input', () => {
            const nodeToUpdate = getCurrentCanvas().nodes.find(n => n.id === nodeData.id);
            if (nodeToUpdate) {
                nodeToUpdate.content = content.innerText;
                saveState();
            }
        });

        // Click to complete link
        node.addEventListener('click', (e) => {
            if (linkingFromId && linkingFromId !== nodeData.id) {
                e.stopPropagation();
                completeLink(linkingFromId, nodeData.id);
            }
        });

        const controls = document.createElement('div');
        controls.classList.add('node-controls');

        // Color Picker
        const colorWrapper = document.createElement('div');
        colorWrapper.classList.add('color-picker-wrapper');
        colorWrapper.title = 'Change Branch Color';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.classList.add('color-picker');
        colorInput.value = nodeData.color || '#444444'; // Default value

        // Visual indicator
        const colorIcon = document.createElement('div');
        colorIcon.classList.add('color-icon');
        colorIcon.style.backgroundColor = nodeData.color || '#555';

        colorInput.addEventListener('input', (e) => {
            const newColor = e.target.value;
            colorIcon.style.backgroundColor = newColor;
            // Just update visual, don't save yet
        });

        colorInput.addEventListener('change', (e) => {
            const newColor = e.target.value;
            updateBranchColor(nodeData.id, newColor); // This calls saveState() which pushes history
        });

        colorWrapper.appendChild(colorInput);
        colorWrapper.appendChild(colorIcon);

        // Link Button
        const linkBtn = document.createElement('button');
        linkBtn.classList.add('control-btn', 'link-node');
        linkBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
        linkBtn.title = 'Link to another node';
        linkBtn.style.color = linkingFromId === nodeData.id ? '#fff' : '#aaa';
        linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startLinkMode(nodeData.id);
        });

        // Add Child Button
        const addChildBtn = document.createElement('button');
        addChildBtn.classList.add('control-btn', 'add-child');
        addChildBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        addChildBtn.title = 'Add Child Node';
        addChildBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addChildNode(nodeData);
        });

        // Delete Button
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('control-btn', 'delete-node');
        deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        deleteButton.title = 'Delete Node';
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(nodeData.id);
        });

        // Prevent touch events on controls from triggering drag/pan
        const stopTouchPropagation = (e) => {
            e.stopPropagation();
        };

        controls.querySelectorAll('button, input').forEach(el => {
            el.addEventListener('touchstart', stopTouchPropagation, { passive: false });
        });

        // Heading Input
        const heading = document.createElement('div');
        heading.classList.add('node-heading');
        heading.setAttribute('contenteditable', 'true');
        heading.setAttribute('placeholder', 'Heading');
        heading.innerText = nodeData.heading || nodeData.content || '';

        let initialHeading = heading.innerText;

        heading.addEventListener('focus', () => {
            initialHeading = heading.innerText;
            // Auto-clear placeholder text
            if (heading.innerText === 'Root Idea' || heading.innerText === 'New Idea') {
                heading.innerText = '';
            }
        });

        heading.addEventListener('input', () => {
            const nodes = getCurrentCanvas().nodes;
            const nodeToUpdate = nodes.find(n => n.id === nodeData.id);
            if (nodeToUpdate) {
                nodeToUpdate.heading = heading.innerText;
                if (nodeToUpdate.content) delete nodeToUpdate.content;
                saveState(true); // Skip history on continuous input
            }
        });

        heading.addEventListener('blur', () => {
            if (heading.innerText !== initialHeading) {
                pushHistory(); // Save history snapshot on blur
            }
        });

        // Description Input
        const description = document.createElement('div');
        description.classList.add('node-description');
        description.setAttribute('contenteditable', 'true');
        description.setAttribute('placeholder', 'Description (optional)');
        description.innerText = nodeData.description || '';

        let initialDescription = description.innerText;

        description.addEventListener('focus', () => {
            initialDescription = description.innerText;
        });

        description.addEventListener('input', () => {
            const nodes = getCurrentCanvas().nodes;
            const nodeToUpdate = nodes.find(n => n.id === nodeData.id);
            if (nodeToUpdate) {
                nodeToUpdate.description = description.innerText;
                saveState(true); // Skip history on continuous input
            }
        });

        description.addEventListener('blur', () => {
            if (description.innerText !== initialDescription) {
                pushHistory(); // Save history snapshot on blur
            }
        });

        // Instructions Container
        const instructionsContainer = document.createElement('div');
        instructionsContainer.classList.add('node-instructions');
        instructionsContainer.style.display = nodeData.marked ? 'block' : 'none';

        // List of tags
        const tagsList = document.createElement('div');
        tagsList.classList.add('tags-list');

        const renderTags = () => {
            tagsList.innerHTML = '';
            (nodeData.instructions || []).forEach((inst, index) => {
                const tag = document.createElement('span');
                tag.classList.add('instruction-tag');
                tag.innerText = inst;
                tag.title = 'Click to remove';
                tag.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('Remove this instruction?')) {
                        nodeData.instructions.splice(index, 1);
                        saveState();
                        renderTags();
                    }
                });
                tagsList.appendChild(tag);
            });
        };
        renderTags();

        // Input for new instruction
        const tagInput = document.createElement('input');
        tagInput.classList.add('instruction-input');
        tagInput.placeholder = '+ Add instruction';
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && tagInput.value.trim()) {
                e.stopPropagation();
                if (!nodeData.instructions) nodeData.instructions = [];
                nodeData.instructions.push(tagInput.value.trim());
                tagInput.value = '';
                saveState();
                renderTags();
            }
        });
        tagInput.addEventListener('touchstart', stopTouchPropagation, { passive: false });

        instructionsContainer.appendChild(tagsList);
        instructionsContainer.appendChild(tagInput);

        // Prevent touch propagation
        heading.addEventListener('touchstart', stopTouchPropagation, { passive: false });
        description.addEventListener('touchstart', stopTouchPropagation, { passive: false });

        // Mark Complete Button (Only for leaf nodes)
        const markBtn = document.createElement('button');
        markBtn.classList.add('control-btn', 'mark-complete');
        markBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        markBtn.title = 'Mark as Solved/Complete';
        markBtn.style.color = nodeData.marked ? '#00ff88' : '#aaa';
        markBtn.style.display = 'none'; // Hidden by default, shown by renderNodes if leaf

        markBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nodes = getCurrentCanvas().nodes;
            const nodeToUpdate = nodes.find(n => n.id === nodeData.id);
            if (nodeToUpdate) {
                nodeToUpdate.marked = !nodeToUpdate.marked;
                saveState();
                render(); // Re-render to update UI state
            }
        });

        markBtn.addEventListener('touchstart', stopTouchPropagation, { passive: false });

        controls.appendChild(colorWrapper);
        controls.appendChild(linkBtn);
        controls.appendChild(addChildBtn);
        controls.appendChild(markBtn); // Add mark button
        controls.appendChild(deleteButton);

        // Link Handle (The "Plus" button that appears)
        const linkHandle = document.createElement('div');
        linkHandle.classList.add('link-handle');
        linkHandle.innerHTML = '+';
        linkHandle.title = 'Drag to connect';
        linkHandle.style.display = linkingFromId === nodeData.id ? 'flex' : 'none';

        // Drag logic for the handle
        const handleDragStart = (e) => {
            e.stopPropagation();
            e.preventDefault(); // Prevent text selection

            const startX = (e.clientX || e.touches[0].clientX) - pan.x; // Adjust for pan? No, get client coords first
            const startY = (e.clientY || e.touches[0].clientY) - pan.y;

            // Actually we need world coordinates for the line start
            const worldStartX = nodeData.x + node.offsetWidth; // Start from right side
            const worldStartY = nodeData.y + node.offsetHeight / 2;

            isLinking = true;
            tempLinkStart = { x: worldStartX, y: worldStartY };

            // Create temp line
            const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempLine.setAttribute('id', 'temp-link-line');
            tempLine.setAttribute('stroke', '#fff');
            tempLine.setAttribute('stroke-width', '2');
            tempLine.setAttribute('stroke-dasharray', '5,5');
            tempLine.setAttribute('fill', 'none');
            connectionsSvg.appendChild(tempLine);

            const moveHandler = (moveEvent) => {
                const clientX = moveEvent.clientX || moveEvent.touches[0].clientX;
                const clientY = moveEvent.clientY || moveEvent.touches[0].clientY;

                // Convert to world coords
                const worldX = (clientX - pan.x) / scale;
                const worldY = (clientY - pan.y) / scale;

                const d = `M ${tempLinkStart.x} ${tempLinkStart.y} L ${worldX} ${worldY}`;
                tempLine.setAttribute('d', d);
            };

            const upHandler = (upEvent) => {
                isLinking = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
                document.removeEventListener('touchmove', moveHandler);
                document.removeEventListener('touchend', upHandler);

                if (tempLine) tempLine.remove();

                // Check if dropped on a node
                const clientX = upEvent.clientX || (upEvent.changedTouches ? upEvent.changedTouches[0].clientX : 0);
                const clientY = upEvent.clientY || (upEvent.changedTouches ? upEvent.changedTouches[0].clientY : 0);

                // Hide the handle after drag
                linkingFromId = null;
                renderNodes();

                // Find element under cursor
                // We need to temporarily hide the handle/line to see what's under
                const targetEl = document.elementFromPoint(clientX, clientY);
                const targetNodeEl = targetEl ? targetEl.closest('.node') : null;

                if (targetNodeEl) {
                    const targetId = targetNodeEl.dataset.id;
                    if (targetId && targetId !== nodeData.id) {
                        completeLink(nodeData.id, targetId);
                    }
                }
            };

            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
            document.addEventListener('touchmove', moveHandler, { passive: false });
            document.addEventListener('touchend', upHandler);
        };

        linkHandle.addEventListener('mousedown', handleDragStart);
        linkHandle.addEventListener('touchstart', handleDragStart, { passive: false });

        // Append elements
        node.appendChild(linkHandle);
        node.appendChild(heading);
        node.appendChild(description);
        node.appendChild(instructionsContainer);
        node.appendChild(controls);
        nodesContainer.appendChild(node);

        makeDraggable(node);

        return node;
    };

    let isLinking = false;
    let tempLinkStart = null;

    const startLinkMode = (id) => {
        if (linkingFromId === id) {
            linkingFromId = null; // Toggle off
        } else {
            linkingFromId = id;
            // Alert removed, visual cue is the handle
        }
        renderNodes();
    };

    const completeLink = (parentId, childId) => {
        const nodes = getCurrentCanvas().nodes;
        const child = nodes.find(n => n.id === childId);
        if (!child) return;

        // Prevent self-linking and duplicate linking
        if (parentId === childId) return;
        if (child.parentIds.includes(parentId)) {
            alert("Nodes are already connected.");
            linkingFromId = null;
            renderNodes();
            return;
        }

        // Check for cycles? (Optional, but good for mind maps)
        // For now, allow general graph connections.

        child.parentIds.push(parentId);

        // Reposition the child to be equidistant from all parents
        repositionSharedNode(child);

        linkingFromId = null;
        saveState();
        render();
    };

    const moveSubtree = (nodeId, dx, dy, visited = new Set()) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const nodes = getCurrentCanvas().nodes;
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            node.x += dx;
            node.y += dy;

            // Find children (nodes that have this node as a parent)
            const children = nodes.filter(n => n.parentIds && n.parentIds.includes(nodeId));
            children.forEach(child => moveSubtree(child.id, dx, dy, visited));
        }
    };

    const resolveOverlaps = (movedNodeId) => {
        const nodes = getCurrentCanvas().nodes;
        const movedNode = nodes.find(n => n.id === movedNodeId);
        if (!movedNode) return;

        const minDistance = 220; // Minimum spacing between nodes (node width + gap)
        let iterations = 0;
        const maxIterations = 5; // Prevent infinite loops/jitter

        // Simple iterative relaxation
        while (iterations < maxIterations) {
            let moved = false;
            nodes.forEach(other => {
                if (other.id === movedNodeId) return;

                // Check distance
                const dx = movedNode.x - other.x;
                const dy = movedNode.y - other.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < minDistance) {
                    // Collision detected
                    // Push movedNode away from 'other'
                    let pushX = dx;
                    let pushY = dy;

                    if (dist === 0) {
                        pushX = Math.random() - 0.5;
                        pushY = 1;
                    }

                    // Normalize
                    const len = Math.sqrt(pushX * pushX + pushY * pushY);
                    const nx = pushX / len;
                    const ny = pushY / len;

                    // Move by overlap amount + buffer
                    const overlap = minDistance - dist;
                    const moveX = nx * (overlap + 20);
                    const moveY = ny * (overlap + 20);

                    moveSubtree(movedNodeId, moveX, moveY);
                    moved = true;
                }
            });

            if (!moved) break;
            iterations++;
        }
    };

    const repositionSharedNode = (childNode) => {
        if (!childNode.parentIds || childNode.parentIds.length === 0) return;

        const nodes = getCurrentCanvas().nodes;
        let sumX = 0;
        let sumY = 0;
        let count = 0;

        childNode.parentIds.forEach(pId => {
            const parent = nodes.find(n => n.id === pId);
            if (parent) {
                sumX += parent.x;
                sumY += parent.y;
                count++;
            }
        });

        if (count > 0) {
            // Move to centroid
            const centerX = sumX / count;
            const centerY = sumY / count;

            let targetX = childNode.x;
            let targetY = childNode.y;

            // Calculate vector from centroid to current child position
            let dx = childNode.x - centerX;
            let dy = childNode.y - centerY;

            // If child is exactly at centroid (rare) or very close, push down
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                dx = 0;
                dy = 150;
            }

            // Normalize and ensure minimum distance
            const len = Math.sqrt(dx * dx + dy * dy);
            const desiredDist = 200;

            if (len < desiredDist) {
                const scale = len > 0 ? desiredDist / len : 1;
                targetX = centerX + dx * scale;
                targetY = centerY + dy * scale;
            } else {
                if (childNode.y < centerY + 50) {
                    targetY = centerY + 150;
                }
            }

            // Calculate delta and move entire subtree
            const deltaX = targetX - childNode.x;
            const deltaY = targetY - childNode.y;

            if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
                moveSubtree(childNode.id, deltaX, deltaY);
            }

            // Resolve collisions for the moved branch
            resolveOverlaps(childNode.id);
        }
    };

    const updateBranchColor = (rootId, newColor) => {
        const nodes = getCurrentCanvas().nodes;
        // Update the root node
        const rootNode = nodes.find(n => n.id === rootId);
        if (rootNode) {
            rootNode.color = newColor;
        }

        // Recursively update all children
        // With multiple parents, this might overwrite colors from other parents.
        // We'll stick to simple propagation for now.
        const updateChildren = (parentId) => {
            nodes.forEach(n => {
                if (n.parentIds && n.parentIds.includes(parentId)) {
                    n.color = newColor;
                    updateChildren(n.id);
                }
            });
        };

        updateChildren(rootId);
        saveState();
        render();
    };

    const addChildNode = (parentNode) => {
        const nodes = getCurrentCanvas().nodes;
        const { x, y } = findSmartPosition(parentNode, nodes);

        let nodeColor = parentNode.color;

        // Extended palette of vibrant colors
        const colors = [
            '#FF5733', '#33FF57', '#3357FF', '#F033FF', '#FF33A8',
            '#33FFF5', '#FFC300', '#DAF7A6', '#FF6B6B', '#4ECDC4',
            '#45B7D1', '#96CEB4', '#D4A5A5', '#9B59B6', '#3498DB'
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // Logic for auto-coloring
        const isRoot = !parentNode.parentIds || parentNode.parentIds.length === 0;

        if (isRoot) {
            // Case 1: Parent is Root.
            // The new node starts a new branch, so it gets a fresh color.
            // The Root node itself remains neutral.
            nodeColor = randomColor;
        } else {
            // Check if this parent already has enough children to form a group
            const existingChildren = nodes.filter(n => n.parentIds && n.parentIds.includes(parentNode.id));

            if (existingChildren.length >= 2) {
                // Parent has 2 or more children already.
                // Change the color of the entire group (Parent + Children) to a new random color
                // to distinguish this dense branch.
                nodeColor = randomColor;
                updateBranchColor(parentNode.id, nodeColor);
            } else if (!nodeColor) {
                // Case 2: Parent is NOT Root, but currently has no color.
                // It is "becoming a parent" of a colored branch.
                // We assign a color to the Parent, and the Child inherits it.
                nodeColor = randomColor;
                parentNode.color = nodeColor;

                // Also update any existing children of this parent to match
                // (In case it had children before but no color)
                nodes.forEach(n => {
                    if (n.parentIds && n.parentIds.includes(parentNode.id)) {
                        n.color = nodeColor;
                    }
                });
            }
        }
        // Case 3: Parent already has a color. Child simply inherits it (nodeColor is already parentNode.color).

        const newNode = {
            id: `node-${Date.now()}`,
            content: 'New Idea',
            x: x,
            y: y,
            parentIds: [parentNode.id],
            color: nodeColor
        };

        nodes.push(newNode);
        saveState();
        render();
    };

    const findSmartPosition = (parent, allNodes) => {
        const nodeWidth = 250; // Assumed width + gap
        const nodeHeight = 150; // Assumed height + gap
        const minDistance = 300; // Minimum distance from parent

        // 1. Determine base angle.
        // If parent has a parent, continue that direction to maintain flow.
        // If root, start at 0 (right).
        let baseAngle = 0;
        if (parent.parentIds && parent.parentIds.length > 0) {
            const grandParent = allNodes.find(n => n.id === parent.parentIds[0]);
            if (grandParent) {
                baseAngle = Math.atan2(parent.y - grandParent.y, parent.x - grandParent.x);
            }
        }

        // 2. Search for free spot spiraling out from base angle
        let radius = minDistance;
        let step = 0;
        const maxSteps = 200;

        while (step < maxSteps) {
            // Alternate sides: 0, +30deg, -30deg, +60deg, ...
            // This creates a fanning out effect from the "forward" direction
            const sign = step % 2 === 0 ? 1 : -1;
            const multiplier = Math.ceil(step / 2);
            const angleOffset = sign * multiplier * (Math.PI / 8); // 22.5 degree increments
            const currentAngle = baseAngle + angleOffset;

            const candidateX = parent.x + Math.cos(currentAngle) * radius;
            const candidateY = parent.y + Math.sin(currentAngle) * radius;

            // Check collision with ALL nodes
            let collision = false;
            for (const node of allNodes) {
                // Simple rectangular collision check
                // We check if the new node's box overlaps with any existing node's box
                const nx = node.x;
                const ny = node.y;

                if (
                    candidateX < nx + nodeWidth &&
                    candidateX + nodeWidth > nx &&
                    candidateY < ny + nodeHeight &&
                    candidateY + nodeHeight > ny
                ) {
                    collision = true;
                    break;
                }
            }

            if (!collision) {
                return { x: candidateX, y: candidateY };
            }

            step++;
            // If we've tried many angles (e.g. full circle), increase radius to find space further out
            if (step > 16 && step % 16 === 0) {
                radius += 100;
            }
        }

        // Fallback if extremely crowded
        return { x: parent.x + 50, y: parent.y + 50 };
    };

    const deleteNode = (nodeId) => {
        // 1. Remove this node from state
        // 2. For all children that had this node as a parent, remove it from their parentIds
        // 3. If a child has NO parentIds left, delete it recursively?

        const nodes = getCurrentCanvas().nodes;
        const nodesToDelete = new Set([nodeId]);

        // Helper to find orphans
        const findOrphans = () => {
            let changed = false;
            nodes.forEach(n => {
                if (nodesToDelete.has(n.id)) return; // Already marked for deletion

                // Check if this node has any parents that are being deleted
                if (n.parentIds && n.parentIds.some(pId => nodesToDelete.has(pId))) {
                    // Filter out parents that are being deleted
                    const remainingParents = n.parentIds.filter(pId => !nodesToDelete.has(pId));

                    // If it had parents, and now has none remaining, it becomes an orphan
                    // and should also be deleted.
                    // We check n.parentIds.length > 0 to ensure we don't delete true root nodes
                    // that never had parents.
                    if (remainingParents.length === 0 && n.parentIds.length > 0) {
                        nodesToDelete.add(n.id);
                        changed = true;
                    }
                }
            });
            return changed;
        };

        // Iteratively find all cascading deletions
        // This loop continues as long as new orphans are found in each pass.
        while (findOrphans()) { }

        // Apply deletions and clean up parentIds for survivors
        getCurrentCanvas().nodes = nodes.filter(n => !nodesToDelete.has(n.id));

        // For any nodes that survived, ensure their parentIds list doesn't contain
        // any IDs of nodes that were just deleted.
        getCurrentCanvas().nodes.forEach(n => {
            if (n.parentIds) {
                n.parentIds = n.parentIds.filter(pId => !nodesToDelete.has(pId));
            }
        });

        saveState();
        render();
    };

    const makeDraggable = (element) => {
        let isDragging = false;
        let dragStartX, dragStartY; // Mouse position when drag started (screen coordinates)
        let initialNodeX, initialNodeY; // Node position when drag started (world coordinates)

        const onMouseDown = (e) => {
            // Only drag with left mouse button and not on content editable or buttons or color picker
            if (e.button !== 0 ||
                e.target.getAttribute('contenteditable') === 'true' ||
                e.target.closest('button') ||
                e.target.closest('input') ||
                e.target.closest('.color-picker-wrapper')) return;

            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            // Get current node position from state (world coordinates)
            const nodeId = element.dataset.id;
            const nodeData = getCurrentCanvas().nodes.find(n => n.id === nodeId);
            if (nodeData) {
                initialNodeX = nodeData.x;
                initialNodeY = nodeData.y;
            }

            element.style.cursor = 'grabbing';
            canvas.style.cursor = 'grabbing'; // Change canvas cursor too for visual consistency
            e.preventDefault();
            e.stopPropagation(); // Crucial: Prevent canvas panning when dragging a node
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const deltaX = (e.clientX - dragStartX) / scale; // Adjust delta by scale
            const deltaY = (e.clientY - dragStartY) / scale;

            // Calculate new world position
            const newX = initialNodeX + deltaX;
            const newY = initialNodeY + deltaY;

            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;

            // Update state immediately for smooth line rendering
            const nodeId = element.dataset.id;
            const nodeData = getCurrentCanvas().nodes.find(n => n.id === nodeId);
            if (nodeData) {
                nodeData.x = newX;
                nodeData.y = newY;
            }

            // Re-draw connections efficiently
            // We could optimize to only redraw lines connected to this node, 
            // but for < 100 nodes, full redraw is fine.
            renderConnections();
        };

        const onMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            element.style.cursor = 'move';
            canvas.style.cursor = 'grab';
            // element.style.zIndex = ''; // Reset z-index if it was changed

            // Node position in state was already updated in onMouseMove, just save it.
            const nodeId = element.dataset.id;
            const nodeToUpdate = getCurrentCanvas().nodes.find(n => n.id === nodeId);
            if (nodeToUpdate) {
                saveState();
            }
        };

        // Touch Events for Node Dragging
        const onTouchStart = (e) => {
            if (e.touches.length !== 1 ||
                e.target.getAttribute('contenteditable') === 'true' ||
                e.target.closest('button') ||
                e.target.closest('input') ||
                e.target.closest('.color-picker-wrapper')) return;

            isDragging = true;
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;

            const nodeId = element.dataset.id;
            const nodes = getCurrentCanvas().nodes;
            const nodeData = nodes.find(n => n.id === nodeId);
            if (nodeData) {
                initialNodeX = nodeData.x;
                initialNodeY = nodeData.y;
            }

            element.style.cursor = 'grabbing';
            e.stopPropagation();
        };

        const onTouchMove = (e) => {
            if (!isDragging) return;
            e.preventDefault(); // Prevent scrolling

            const deltaX = (e.touches[0].clientX - dragStartX) / scale;
            const deltaY = (e.touches[0].clientY - dragStartY) / scale;

            const newX = initialNodeX + deltaX;
            const newY = initialNodeY + deltaY;

            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;

            const nodeId = element.dataset.id;
            const nodes = getCurrentCanvas().nodes;
            const nodeData = nodes.find(n => n.id === nodeId);
            if (nodeData) {
                nodeData.x = newX;
                nodeData.y = newY;
            }

            renderConnections();
        };

        const onTouchEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            element.style.cursor = 'move';

            const nodeId = element.dataset.id;
            const nodes = getCurrentCanvas().nodes;
            const nodeToUpdate = nodes.find(n => n.id === nodeId);
            if (nodeToUpdate) {
                saveState();
            }
        };

        element.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        element.addEventListener('touchstart', onTouchStart, { passive: false });
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    };

    // Canvas Panning Logic
    let isPanning = false;
    let panStartX, panStartY;
    let initialPanX, initialPanY;

    // Touch Panning & Zooming State
    let initialPinchDistance = null;
    let initialScale = null;

    const getDistance = (touch1, touch2) => {
        return Math.sqrt(
            Math.pow(touch2.clientX - touch1.clientX, 2) +
            Math.pow(touch2.clientY - touch1.clientY, 2)
        );
    };

    const getCenter = (touch1, touch2) => {
        return {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
    };

    canvas.addEventListener('mousedown', (e) => {
        // Only pan if clicking directly on canvas or world (not nodes or their children)
        if (e.target === canvas || e.target === world || e.target === connectionsSvg || e.target.id === 'groups') {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            initialPanX = pan.x;
            initialPanY = pan.y;
            canvas.style.cursor = 'grabbing';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;

        const deltaX = e.clientX - panStartX;
        const deltaY = e.clientY - panStartY;

        pan.x = initialPanX + deltaX;
        pan.y = initialPanY + deltaY;

        updateTransform();
    });

    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            canvas.style.cursor = 'grab';
        }
    });

    // Touch Panning & Zooming
    canvas.addEventListener('touchstart', (e) => {
        if (e.target === canvas || e.target === world || e.target === connectionsSvg || e.target.id === 'groups') {
            if (e.touches.length === 1) {
                // Pan
                isPanning = true;
                panStartX = e.touches[0].clientX;
                panStartY = e.touches[0].clientY;
                initialPanX = pan.x;
                initialPanY = pan.y;
            } else if (e.touches.length === 2) {
                // Pinch Zoom
                isPanning = false; // Stop panning if pinching
                initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
                initialScale = scale;
            }
        }
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && isPanning) {
            const deltaX = e.touches[0].clientX - panStartX;
            const deltaY = e.touches[0].clientY - panStartY;

            pan.x = initialPanX + deltaX;
            pan.y = initialPanY + deltaY;

            updateTransform();
        } else if (e.touches.length === 2 && initialPinchDistance) {
            e.preventDefault();
            const currentDistance = getDistance(e.touches[0], e.touches[1]);
            const zoomFactor = currentDistance / initialPinchDistance;

            const newScale = initialScale * zoomFactor;

            // Zoom centered on pinch center
            const center = getCenter(e.touches[0], e.touches[1]);

            // Calculate world pos of center before zoom
            const worldX = (center.x - pan.x) / scale;
            const worldY = (center.y - pan.y) / scale;

            scale = Math.min(Math.max(0.1, newScale), 5);

            // Adjust pan to keep center fixed
            pan.x = center.x - worldX * scale;
            pan.y = center.y - worldY * scale;

            updateTransform();
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            initialPinchDistance = null;
        }
        if (e.touches.length === 0) {
            isPanning = false;
        }
    });

    // Zoom Logic
    const zoom = (delta, center) => {
        const oldScale = scale;
        const zoomFactor = 1.1;

        if (delta < 0) {
            scale *= zoomFactor;
        } else {
            scale /= zoomFactor;
        }

        // Clamp scale
        scale = Math.min(Math.max(0.1, scale), 5);

        // Zoom towards center
        // We want the point under the mouse (center.x, center.y) to remain fixed relative to the screen.
        // World coordinates of the mouse before zoom:
        const worldX = (center.x - pan.x) / oldScale;
        const worldY = (center.y - pan.y) / oldScale;

        // New pan position:
        // center.x = pan.x + worldX * scale
        // pan.x = center.x - worldX * scale
        pan.x = center.x - worldX * scale;
        pan.y = center.y - worldY * scale;

        updateTransform();
    };

    canvas.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            zoom(e.deltaY, { x: e.clientX, y: e.clientY });
        }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                zoom(-1, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
            } else if (e.key === '-') {
                e.preventDefault();
                zoom(1, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
            } else if (e.key === '0') {
                e.preventDefault();
                scale = 1;
                pan = { x: 0, y: 0 };
                updateTransform();
            }
        }
    });

    // Double click to create root node
    canvas.addEventListener('dblclick', (e) => {
        if (e.target.closest('.node')) {
            return;
        }

        const worldX = (e.clientX - pan.x) / scale;
        const worldY = (e.clientY - pan.y) / scale;

        const newNodeData = {
            id: `node-${Date.now()}`,
            content: 'Root Idea',
            heading: '',
            description: '',
            x: worldX - 75,
            y: worldY - 40,
            parentIds: []
        };

        getCurrentCanvas().nodes.push(newNodeData);
        saveState();
        render();
    });

    // Save as Image
    const saveBtn = document.getElementById('save-button');
    saveBtn.addEventListener('click', async () => {
        const nodes = getCurrentCanvas().nodes;
        if (nodes.length === 0) {
            alert("Canvas is empty!");
            return;
        }

        // 1. Clone the world to a hidden container to capture it
        // We need to capture the full extent of the mind map, not just the viewport.
        // So we'll reset the transform on the clone.

        const worldClone = world.cloneNode(true);
        worldClone.style.transform = 'none';
        worldClone.style.position = 'absolute';
        worldClone.style.top = '0';
        worldClone.style.left = '0';
        worldClone.style.width = 'auto';
        worldClone.style.height = 'auto';
        worldClone.style.overflow = 'visible';

        // Create a temporary container
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.top = '-9999px';
        container.style.left = '-9999px';
        container.style.width = '5000px'; // Arbitrary large size
        container.style.height = '5000px';
        container.appendChild(worldClone);
        document.body.appendChild(container);

        // Calculate bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + 250); // Approx width
            maxY = Math.max(maxY, n.y + 150); // Approx height
        });

        // Add padding
        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const width = maxX - minX;
        const height = maxY - minY;

        // Shift clone content so top-left is at 0,0
        const nodesContainerClone = worldClone.querySelector('#nodes-container');
        nodesContainerClone.style.transform = `translate(${-minX}px, ${-minY}px)`;

        // Draw connections on a canvas layer
        // html2canvas has trouble with SVGs sometimes, especially dynamic ones.
        // We'll manually draw lines on a canvas and overlay it.
        const canvasLayer = document.createElement('canvas');
        canvasLayer.width = width;
        canvasLayer.height = height;
        canvasLayer.style.position = 'absolute';
        canvasLayer.style.left = '0';
        canvasLayer.style.top = '0';
        canvasLayer.style.zIndex = '-1'; // Behind nodes
        worldClone.insertBefore(canvasLayer, nodesContainerClone);

        const ctx = canvasLayer.getContext('2d');

        // Map node positions from the clone to get exact centers/edges if needed
        // But using state data is easier and robust enough.
        // We need to adjust state coords by (-minX, -minY)

        const nodeDims = new Map();
        // We can try to measure the cloned nodes for better accuracy
        worldClone.querySelectorAll('.node').forEach(n => {
            const id = n.dataset.id;
            nodeDims.set(id, { w: n.offsetWidth, h: n.offsetHeight });
        });

        nodes.forEach(node => {
            if (node.parentIds && node.parentIds.length > 0) {
                node.parentIds.forEach(parentId => {
                    const parent = nodes.find(n => n.id === parentId);
                    if (parent) {
                        const pDim = nodeDims.get(parent.id) || { w: 150, h: 80 };
                        const cDim = nodeDims.get(node.id) || { w: 150, h: 80 };

                        const startX = (parent.x - minX) + pDim.w; // Right side
                        const startY = (parent.y - minY) + pDim.h / 2;
                        const endX = (node.x - minX); // Left side
                        const endY = (node.y - minY) + cDim.h / 2;

                        const deltaX = endX - startX;
                        const c1x = startX + deltaX * 0.4;
                        const c1y = startY;
                        const c2x = endX - deltaX * 0.4;
                        const c2y = endY;

                        ctx.beginPath();
                        ctx.moveTo(startX, startY);
                        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endX, endY);
                        ctx.strokeStyle = parent.color || '#555';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                });
            }
        });

        // Hide original SVGs in clone to avoid duplicates/artifacts
        const svgClone = worldClone.querySelector('#connections');
        if (svgClone) svgClone.style.display = 'none';
        const groupsClone = worldClone.querySelector('#groups');
        if (groupsClone) groupsClone.style.display = 'none';


        try {
            const canvas = await html2canvas(worldClone, {
                backgroundColor: '#1a1a1a',
                width: width,
                height: height,
                scale: 2, // High res
                logging: false,
                useCORS: true
            });

            const link = document.createElement('a');
            link.download = `orbit-mind-map-${Date.now()}.png`;
            link.href = canvas.toDataURL();
            link.click();
        } catch (err) {
            console.error("Export failed:", err);
            alert("Failed to export image.");
        } finally {
            document.body.removeChild(container);
        }
    });

    // Clear Canvas
    const clearBtn = document.getElementById('clear-button');
    clearBtn.addEventListener('click', () => {
        const currentCanvas = getCurrentCanvas();
        if (currentCanvas.nodes.length === 0) return;

        if (confirm("Are you sure you want to clear the entire canvas? This action cannot be undone.")) {
            currentCanvas.nodes = [];
            saveState();
            render();
            pan = { x: 0, y: 0 };
            scale = 1;
            updateTransform();
        }
    });

    syncButton.addEventListener('click', async () => {
        try {
            if (!fileHandle) {
                // Prompt for sample download
                if (confirm("Do you want to download a sample db.json file first?")) {
                    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'db.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    // Small delay to ensure download starts before picker opens (though picker is blocking)
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                [fileHandle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
            }

            const file = await fileHandle.getFile();
            const fileContent = await file.text();
            const fileData = JSON.parse(fileContent);

            const localLastModified = new Date(state.lastModified);
            const fileLastModified = new Date(fileData.lastModified);

            if (fileLastModified > localLastModified) {
                console.log("File is newer. Loading data from file.");
                state = fileData;
                saveState();
                render();
                alert("Sync complete. Data loaded from the file.");
            } else if (localLastModified > fileLastModified) {
                console.log("Local data is newer. Writing to file.");
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(state, null, 2));
                await writable.close();
                alert("Sync complete. Local changes have been saved to the file.");
            } else {
                console.log("Data is already in sync.");
                alert("Everything is up to date!");
            }
        } catch (error) {
            console.error('Sync failed:', error);
            if (error.name === 'AbortError') {
                fileHandle = null;
                alert("Database connection cancelled. You are working in offline mode.");
            } else {
                alert(`An error occurred during sync: ${error.message}`);
            }
        }
    });



    // Auto Layout Function
    const autoLayout = () => {
        const nodes = getCurrentCanvas().nodes;
        if (nodes.length === 0) return;

        // Identify roots (nodes with no parents)
        const roots = nodes.filter(n => !n.parentIds || n.parentIds.length === 0);

        // If no true roots (cycles), pick the first node as root
        const layoutRoots = roots.length > 0 ? roots : [nodes[0]];

        const visited = new Set();
        const levelHeight = 200;
        const siblingGap = 220;

        const layoutNode = (nodeId, level, startX) => {
            if (visited.has(nodeId)) return startX;
            visited.add(nodeId);

            const node = nodes.find(n => n.id === nodeId);
            // Find children
            const children = nodes.filter(n => n.parentIds && n.parentIds.includes(nodeId));

            let currentX = startX;

            if (children.length === 0) {
                // Leaf node
                node.x = currentX;
                node.y = level * levelHeight;
                return currentX + siblingGap;
            } else {
                // Parent node
                let childX = startX;
                children.forEach(child => {
                    childX = layoutNode(child.id, level + 1, childX);
                });

                // Center parent above children
                const firstChild = nodes.find(n => n.id === children[0].id);
                const lastChild = nodes.find(n => n.id === children[children.length - 1].id);

                node.x = (firstChild.x + lastChild.x) / 2;
                node.y = level * levelHeight;

                return childX; // Return next available X
            }
        };

        let nextRootX = 0;
        layoutRoots.forEach(root => {
            nextRootX = layoutNode(root.id, 0, nextRootX) + 100; // Add gap between trees
        });

        // Center the whole layout
        // Calculate bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x);
            maxY = Math.max(maxY, n.y);
        });

        const layoutWidth = maxX - minX;
        const layoutHeight = maxY - minY;

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        // Shift all nodes to center
        const shiftX = centerX - (minX + layoutWidth / 2);
        const shiftY = centerY - (minY + layoutHeight / 2);

        nodes.forEach(n => {
            n.x += shiftX;
            n.y += shiftY;
        });

        // Reset view to center
        pan = { x: 0, y: 0 };
        scale = 1;
        updateTransform();

        saveState();
        render();
    };

    document.getElementById('reposition-button').addEventListener('click', () => {
        if (confirm("Auto-reposition all nodes? This will overwrite your custom layout.")) {
            autoLayout();
        }
    });

    // Initial Load
    loadState();
    pushHistory(); // Initialize history with the loaded state
    render();
    updateTransform();

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                redo();
            } else {
                undo();
            }
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
            e.preventDefault();
            redo();
        }
    }); // Apply initial pan/scale

    // Handle window resize to update connections if needed
    window.addEventListener('resize', renderConnections);
});