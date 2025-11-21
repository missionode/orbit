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
        nodes: [],
        lastModified: new Date().toISOString()
    };

    // Viewport State
    let pan = { x: 0, y: 0 };
    let scale = 1; // Ready for zoom implementation later

    // Interaction State
    let linkingFromId = null;

    let fileHandle = null;

    const saveState = () => {
        state.lastModified = new Date().toISOString();
        localStorage.setItem('orbitMindData', JSON.stringify(state));
    };

    const loadState = () => {
        const savedData = localStorage.getItem('orbitMindData');
        if (savedData) {
            state = JSON.parse(savedData);
            // Migration: Ensure all nodes have an id and convert parentId to parentIds
            state.nodes.forEach(n => {
                if (!n.id) n.id = `node-${Date.now()}-${Math.random()}`;

                // Migrate single parent to multiple parents
                if (!n.parentIds) {
                    n.parentIds = [];
                    if (n.parentId) {
                        n.parentIds.push(n.parentId);
                    }
                }
                // Cleanup old property
                delete n.parentId;
            });
        }
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
        nodesContainer.innerHTML = '';
        state.nodes.forEach(nodeData => {
            createNodeElement(nodeData);
        });
    };

    const renderGroups = () => {
        const groupsSvg = document.getElementById('groups');
        groupsSvg.innerHTML = '';

        // 1. Group children by parent
        // Since a node can have multiple parents, it can belong to multiple groups.
        const childrenByParent = {};
        state.nodes.forEach(node => {
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
                const parent = state.nodes.find(n => n.id === parentId);
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
        const groupsSvg = document.getElementById('groups'); // Get ref here

        if (state.nodes.length === 0) {
            connectionsSvg.innerHTML = '';
            groupsSvg.innerHTML = '';
            return;
        }

        // Calculate bounding box of all nodes to size the SVG correctly
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        state.nodes.forEach(node => {
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
        groupsSvg.style.left = `${minX}px`;
        groupsSvg.style.top = `${minY}px`;
        groupsSvg.style.width = `${width}px`;
        groupsSvg.style.height = `${height}px`;
        groupsSvg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);

        connectionsSvg.innerHTML = '';

        // Map for quick lookup
        const nodeMap = new Map(state.nodes.map(n => [n.id, n]));

        state.nodes.forEach(node => {
            if (node.parentIds && node.parentIds.length > 0) {
                node.parentIds.forEach(parentId => {
                    if (nodeMap.has(parentId)) {
                        const parent = nodeMap.get(parentId);
                        drawConnection(parent, node);
                    }
                });
            }
        });
    };

    const drawConnection = (parent, child) => {
        // Calculate centers
        // Note: We need to get the actual DOM elements to know width/height if dynamic, 
        // but for simplicity/performance we can assume standard sizes or read from data if we stored it.
        // Better: Read from DOM if available, else estimate.

        const parentEl = document.querySelector(`.node[data-id="${parent.id}"]`);
        const childEl = document.querySelector(`.node[data-id="${child.id}"]`);

        if (!parentEl || !childEl) return;

        // Positions are in state (world coordinates)
        // Dimensions are static/CSS based, so we can just use offsetWidth/Height
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

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        // Bezier curve for "Orbit" look
        const deltaX = endX - startX;
        // Control points to make it curve nicely
        const c1x = startX + deltaX * 0.4;
        const c1y = startY;
        const c2x = endX - deltaX * 0.4;
        const c2y = endY;

        const d = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;

        line.setAttribute('d', d);
        // Use parent's color for the connection, or default gray
        line.setAttribute('stroke', parent.color || '#555');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('fill', 'none');

        connectionsSvg.appendChild(line);
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
            const nodeToUpdate = state.nodes.find(n => n.id === nodeData.id);
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
            updateBranchColor(nodeData.id, newColor);
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

        content.addEventListener('touchstart', stopTouchPropagation, { passive: false });

        controls.appendChild(colorWrapper);
        controls.appendChild(linkBtn);
        controls.appendChild(addChildBtn);
        controls.appendChild(deleteButton);
        node.appendChild(content);
        node.appendChild(controls);
        nodesContainer.appendChild(node);

        makeDraggable(node);
    };

    const startLinkMode = (id) => {
        if (linkingFromId === id) {
            linkingFromId = null; // Toggle off
        } else {
            linkingFromId = id;
            alert("Select another node to connect to.");
        }
        renderNodes(); // Re-render to show visual cue
    };

    const completeLink = (parentId, childId) => {
        const child = state.nodes.find(n => n.id === childId);
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

        const node = state.nodes.find(n => n.id === nodeId);
        if (node) {
            node.x += dx;
            node.y += dy;

            // Find children (nodes that have this node as a parent)
            const children = state.nodes.filter(n => n.parentIds && n.parentIds.includes(nodeId));
            children.forEach(child => moveSubtree(child.id, dx, dy, visited));
        }
    };

    const resolveOverlaps = (movedNodeId) => {
        const movedNode = state.nodes.find(n => n.id === movedNodeId);
        if (!movedNode) return;

        const minDistance = 220; // Minimum spacing between nodes (node width + gap)
        let iterations = 0;
        const maxIterations = 5; // Prevent infinite loops/jitter

        // Simple iterative relaxation
        while (iterations < maxIterations) {
            let moved = false;
            state.nodes.forEach(other => {
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

        let sumX = 0;
        let sumY = 0;
        let count = 0;

        childNode.parentIds.forEach(pId => {
            const parent = state.nodes.find(n => n.id === pId);
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
        // Update the root node
        const rootNode = state.nodes.find(n => n.id === rootId);
        if (rootNode) {
            rootNode.color = newColor;
        }

        // Recursively update all children
        // With multiple parents, this might overwrite colors from other parents.
        // We'll stick to simple propagation for now.
        const updateChildren = (parentId) => {
            state.nodes.forEach(n => {
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
        const { x, y } = findSmartPosition(parentNode, state.nodes);

        let nodeColor = parentNode.color;

        // Extended palette of vibrant colors
        const colors = [
            '#FF5733', '#33FF57', '#3357FF', '#F033FF', '#FF33A8',
            '#33FFF5', '#FFC300', '#DAF7A6', '#FF6B6B', '#4ECDC4',
            '#45B7D1', '#96CEB4', '#D4A5A5', '#9B59B6', '#3498DB'
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // Logic for auto-coloring
        if (!parentNode.parentIds || parentNode.parentIds.length === 0) {
            // Case 1: Parent is Root. 
            // The new node starts a new branch, so it gets a fresh color.
            // The Root node itself remains neutral.
            nodeColor = randomColor;
        } else if (!nodeColor) {
            // Case 2: Parent is NOT Root, but currently has no color.
            // It is "becoming a parent" of a colored branch.
            // We assign a color to the Parent, and the Child inherits it.
            nodeColor = randomColor;
            parentNode.color = nodeColor;

            // Also update any existing children of this parent to match
            // (In case it had children before but no color)
            state.nodes.forEach(n => {
                if (n.parentIds && n.parentIds.includes(parentNode.id)) {
                    n.color = nodeColor;
                }
            });
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

        state.nodes.push(newNode);
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

        const nodesToDelete = new Set([nodeId]);

        // Helper to find orphans
        const findOrphans = () => {
            let changed = false;
            state.nodes.forEach(n => {
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
        state.nodes = state.nodes.filter(n => !nodesToDelete.has(n.id));

        // For any nodes that survived, ensure their parentIds list doesn't contain
        // any IDs of nodes that were just deleted.
        state.nodes.forEach(n => {
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
                e.target.closest('.color-picker-wrapper')) return;

            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            // Get current node position from state (world coordinates)
            const nodeId = element.dataset.id;
            const nodeData = state.nodes.find(n => n.id === nodeId);
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
            const nodeData = state.nodes.find(n => n.id === nodeId);
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
            const nodeToUpdate = state.nodes.find(n => n.id === nodeId);
            if (nodeToUpdate) {
                saveState();
            }
        };

        // Touch Events for Node Dragging
        const onTouchStart = (e) => {
            if (e.touches.length !== 1 ||
                e.target.getAttribute('contenteditable') === 'true' ||
                e.target.closest('button') ||
                e.target.closest('.color-picker-wrapper')) return;

            isDragging = true;
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;

            const nodeId = element.dataset.id;
            const nodeData = state.nodes.find(n => n.id === nodeId);
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
            const nodeData = state.nodes.find(n => n.id === nodeId);
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
            const nodeToUpdate = state.nodes.find(n => n.id === nodeId);
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
        // P_world = (P_screen - Pan) / Scale
        // We want P_world to stay at P_screen
        // NewPan = P_screen - P_world * NewScale

        const mouseX = center.x;
        const mouseY = center.y;

        const worldX = (mouseX - pan.x) / oldScale;
        const worldY = (mouseY - pan.y) / oldScale;

        pan.x = mouseX - worldX * scale;
        pan.y = mouseY - worldY * scale;

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

    canvas.addEventListener('dblclick', (e) => {
        // Do not create a node if the double-click was on an existing node or its children
        if (e.target.closest('.node')) {
            return;
        }

        // Calculate world coordinates for the new node
        // Screen coordinates (e.clientX, e.clientY) - Pan offset = World coordinates * Scale
        // World = (Screen - Pan) / Scale
        const worldX = (e.clientX - pan.x) / scale;
        const worldY = (e.clientY - pan.y) / scale;

        const newNodeData = {
            id: `node-${Date.now()}`,
            content: 'Root Idea',
            x: worldX - 75, // Center the node on the click point
            y: worldY - 40,
            parentId: null // Root node
        };

        state.nodes.push(newNodeData);
        saveState();
        createNodeElement(newNodeData);
    });

    syncButton.addEventListener('click', async () => {
        try {
            if (!fileHandle) {
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
            } else {
                alert(`An error occurred during sync: ${error.message}`);
            }
        }
    });

    // Save as Image
    const saveBtn = document.getElementById('save-button');
    saveBtn.addEventListener('click', async () => {
        if (state.nodes.length === 0) {
            alert("Nothing to save!");
            return;
        }

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const nodeElements = document.querySelectorAll('.node');

        // Map to store dimensions for line drawing
        const nodeDims = new Map();

        nodeElements.forEach(el => {
            const id = el.dataset.id;
            const x = parseFloat(el.style.left);
            const y = parseFloat(el.style.top);
            const w = el.offsetWidth;
            const h = el.offsetHeight;

            nodeDims.set(id, { w, h });

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
        });

        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const width = maxX - minX;
        const height = maxY - minY;

        // Create container
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
        container.style.backgroundColor = getComputedStyle(document.body).backgroundColor || '#1e1e1e';

        // Clone world
        const worldClone = world.cloneNode(true);
        worldClone.style.transform = `translate(${-minX}px, ${-minY}px) scale(1)`;
        worldClone.style.transformOrigin = '0 0';

        // Remove existing SVGs from clone (we will redraw them)
        const oldConnections = worldClone.querySelector('#connections');
        if (oldConnections) oldConnections.remove();
        const oldGroups = worldClone.querySelector('#groups');
        if (oldGroups) oldGroups.remove();

        // Create a canvas for connections
        const canvasLayer = document.createElement('canvas');
        canvasLayer.width = width;
        canvasLayer.height = height;
        canvasLayer.style.position = 'absolute';
        canvasLayer.style.left = `${minX}px`;
        canvasLayer.style.top = `${minY}px`;
        canvasLayer.style.zIndex = '0'; // Behind nodes

        const ctx = canvasLayer.getContext('2d');

        // Translate context so we can draw in world coordinates
        ctx.translate(-minX, -minY);

        // Draw Connections
        state.nodes.forEach(node => {
            if (node.parentIds && node.parentIds.length > 0) {
                node.parentIds.forEach(parentId => {
                    const parent = state.nodes.find(n => n.id === parentId);
                    if (parent) {
                        const pDim = nodeDims.get(parent.id) || { w: 100, h: 50 };
                        const cDim = nodeDims.get(node.id) || { w: 100, h: 50 };

                        const startX = parent.x + pDim.w / 2;
                        const startY = parent.y + pDim.h / 2;
                        const endX = node.x + cDim.w / 2;
                        const endY = node.y + cDim.h / 2;

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

        // Insert canvas into worldClone before nodes
        const nodesContainerClone = worldClone.querySelector('#nodes-container');
        worldClone.insertBefore(canvasLayer, nodesContainerClone);

        container.appendChild(worldClone);
        document.body.appendChild(container);

        try {
            const canvas = await html2canvas(container, {
                backgroundColor: container.style.backgroundColor,
                scale: 2,
                logging: false
            });

            const link = document.createElement('a');
            link.download = `orbit-mindmap-${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error("Export failed:", err);
            alert("Failed to export image.");
        } finally {
            document.body.removeChild(container);
        }
    });

    // Initial Load
    loadState();
    render();
    updateTransform(); // Apply initial pan/scale

    // Handle window resize to update connections if needed
    window.addEventListener('resize', renderConnections);
});