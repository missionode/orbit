# Orbit Mind Mapper

Orbit is a powerful, offline-first mind mapping application designed to help you organize thoughts, brainstorm ideas, and track tasks visually. It features an infinite canvas, intuitive node management, and seamless local file synchronization.

## 🌟 Features

*   **Infinite Canvas**: Pan and zoom freely to map out ideas of any scale.
*   **Dynamic Nodes**: Create cards with rich text support (Bold, Italic, Lists).
*   **Smart Layout**: Automatic positioning and collision detection keep your map organized.
*   **Link & Connect**: Visually link related ideas with a simple drag-and-drop interface.
*   **Task Management**: Mark nodes as "Resolved" and automatically clean them up to maintain flow.
*   **Focus Mode**: Eliminate distractions by hiding all UI elements except the canvas.
*   **Fullscreen Support**: Immerse yourself completely in your work.
*   **Local Sync**: Save and load your maps directly to a local `db.json` file using the File System Access API.
*   **Responsive Design**: Works seamlessly on desktops, tablets, and mobile devices.
*   **Keyboard Shortcuts**: Speed up your workflow with hotkeys.

## 🚀 Getting Started

Orbit is a client-side web application. You can run it directly in your browser.

1.  **Clone or Download** the repository.
2.  **Open** `index.html` in your preferred web browser (Chrome, Edge, or Firefox recommended for File System API support).
3.  **Start Mapping!**

*Note: For the best experience with File Sync features, serve the project using a local server (e.g., `npx serve` or Live Server extension in VS Code).*

## 📚 Tutorial

### Creating & Editing
*   **Add Node**: Click the **+** button on any card to create a new child node.
*   **Edit Text**: Click on the heading or description of a card to type. A formatting toolbar appears when you focus on the text.
*   **Delete Node**: Click the **Trash** icon or press `Delete` / `Backspace` while a node is selected.

### Linking Nodes
*   **Connect**: Click the **Link** icon (chain) on a card to enter linking mode. A handle will appear. Drag from this handle to any other card to create a connection.
*   **Smart Focus**: The view automatically centers on the connection when you link two cards.

### Task Cleanup
1.  **Resolve**: Double-click the **Checkmark** icon on a card to mark it as resolved (Green).
2.  **Cleanup**: Click the **Checkmark** icon again on a resolved card. You will be asked if you want to clean it up.
3.  **Auto-Reorganize**: Confirming cleanup removes the card and automatically reconnects its parents to its children, shifting the remaining nodes up to fill the gap.

### Navigation
*   **Pan**: Click and drag on the background to move around.
*   **Zoom**: Use the mouse wheel or pinch on a trackpad/touchscreen.
*   **Actual Size**: Click the **1x** button to reset zoom to 100%.
*   **Fit to Screen**: The app automatically zooms to fit your content when you load the page.

### Syncing Data
*   Click the **Sync** button (arrows icon).
*   Choose a location to save your `db.json` file.
*   Orbit will automatically save changes to this file and reload from it if the file changes externally.

## ⌨️ Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `Delete` / `Backspace` | Delete selected node |
| `Esc` | Exit Fullscreen |

## ❓ FAQs

**Q: Where is my data stored?**
A: By default, data is stored in your browser's `localStorage`. When you use the Sync feature, it is also saved to a local JSON file on your computer.

**Q: Can I use this offline?**
A: Yes! Orbit is designed to work entirely offline.

**Q: How do I reset the view if I get lost?**
A: Click the **1x** button to zoom to actual size and center your content, or reload the page to "Fit to Screen".

**Q: Why can't I link a node to its parent?**
A: Orbit prevents loops that would break the hierarchy flow, but allows cross-linking between siblings or cousins.

**Q: Does it support dark mode?**
A: Orbit features a sleek, dark-themed interface by default, optimized for long brainstorming sessions.
