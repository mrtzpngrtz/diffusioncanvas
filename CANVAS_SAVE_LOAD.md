# Canvas Save/Load Feature

## Overview

The canvas now supports saving and loading your entire workspace, including all nodes, images, connections, and settings. This allows you to:

- **Save your work** and continue later
- **Share canvas files** with others
- **Create templates** for common workflows
- **Backup complex setups** before making changes

## What Gets Saved

The save/load system preserves the complete state of your canvas:

### Nodes
- **Image Nodes**: Original uploaded images (as base64 data), size, and position
- **Prompt Nodes**: Text prompts, aspect ratio settings, and position
- **Action Nodes**: Selected action presets and position
- **Result Nodes**: Generated images (as base64 data), size, and position

### Connections
- All connections between nodes
- Connection relationships (which nodes feed into which)
- Referenced nodes (connected images, prompts, result nodes)

### Canvas Settings
- Zoom level
- Pan position (viewport location)
- Node ID counter (for consistent IDs on reload)

### Node Sizes
- Custom image widths for resized nodes
- Node positions

## How to Use

### Saving Your Canvas

1. Click the **💾 Save Canvas** button in the toolbar
2. A JSON file will be automatically downloaded to your computer
3. The file name includes a timestamp: `diffusion-canvas-YYYY-MM-DD-HH-MM-SS.json`

**Note**: The save is instant and creates a file in your Downloads folder.

### Loading a Canvas

1. Click the **📂 Load Canvas** button in the toolbar
2. Select a previously saved `.json` canvas file
3. If you have existing nodes, you'll be asked to confirm replacement
4. The canvas will be fully restored with all nodes, images, and connections

**Important**: Loading replaces your current canvas. Save first if you want to keep your current work!

## File Format

Canvas files are saved as JSON with the following structure:

```json
{
  "version": "1.0",
  "timestamp": "2025-01-10T20:30:00.000Z",
  "zoom": 1,
  "panX": 0,
  "panY": 0,
  "nodeIdCounter": 10,
  "nodes": [
    {
      "id": "node-0",
      "type": "image|prompt|action|result",
      "position": { "x": 100, "y": 100 },
      "data": {
        "imageData": "base64...",
        "imageWidth": 250,
        "prompt": "text...",
        "aspectRatio": "16:9",
        "action": "colorize this image",
        "connectedImageIds": ["node-1"],
        "connectedPromptIds": ["node-2"],
        "resultNodeId": "node-3",
        "sourcePromptNodeId": "node-4"
      }
    }
  ],
  "connections": [
    { "from": "node-0", "to": "node-1" }
  ]
}
```

## Use Cases

### 1. Iterative Workflows
Save your canvas at different stages to compare results or revert to earlier versions.

### 2. Templates
Create reusable node setups for common tasks:
- Image enhancement chains
- Multi-stage generation pipelines
- Batch processing setups

### 3. Collaboration
Share canvas files with team members to:
- Show your workflow
- Collaborate on prompts
- Share processing techniques

### 4. Backup
Save complex setups before experimenting with changes.

### 5. Portfolio
Save successful workflows for future reference or documentation.

## Technical Details

### Image Storage
- Images are stored as base64-encoded data URLs
- This makes files self-contained but larger
- No external image hosting required
- Files can be shared without breaking image links

### Node References
- Connections are preserved by storing node IDs
- References between nodes are rebuilt on load
- Connected images and prompts are properly linked
- Result nodes maintain links to source prompts

### Compatibility
- Version 1.0 format
- Future versions will maintain backward compatibility
- Invalid files show an error message

## Tips

1. **File Size**: Canvas files can be large due to embedded images. Consider compressing before sharing.

2. **Regular Saves**: Save frequently if working on complex setups.

3. **Naming**: The auto-generated filename includes a timestamp. Rename files to something descriptive.

4. **Sharing**: Canvas files are completely self-contained and can be shared via email, cloud storage, etc.

5. **Organizing**: Create folders for different projects or workflow types.

## Troubleshooting

**Q: What if my file won't load?**
- Check that it's a valid JSON file
- Ensure it was saved from Diffusion Canvas
- Look for error messages in the browser console

**Q: Why are my files so large?**
- Images are embedded as base64, which is larger than binary
- Consider reducing image sizes before saving
- Delete unused nodes before saving

**Q: Can I edit the JSON file manually?**
- Yes, but be careful with the structure
- Useful for batch modifications
- Always keep a backup before editing

**Q: Will my canvas work on a different computer?**
- Yes! Files are completely portable
- All images and data are embedded
- Works across different browsers and operating systems

## Future Enhancements

Potential future features:
- Auto-save functionality
- Cloud storage integration
- Version history
- Compressed file format
- Import/export individual nodes
- Canvas thumbnails

## Security Note

Canvas files can contain sensitive information:
- Your uploaded images
- Your prompts
- Generated results

Be cautious when sharing canvas files publicly if they contain private or proprietary content.
