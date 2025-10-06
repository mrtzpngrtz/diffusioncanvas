# Diffusion Canvas - Node-Based Image Prompting

A web-based node editor for interactive image prompting using Google's Gemini API.

## Features

- **Node-Based Interface**: Drag-and-drop nodes to create visual workflows
- **Image Upload**: Drop or select images to use as input
- **Prompt Nodes**: Type prompts to guide image generation
- **Visual Connections**: Connect nodes with visual bezier curves
- **Result Nodes**: View generated images in separate nodes
- **Responsive Design**: Beautiful gradient UI with smooth interactions

## How to Use

1. **Open the Application**
   - Simply open `index.html` in a modern web browser

2. **Add an Image Node**
   - Click "Add Image Node" button
   - Click the drop zone or drag an image file into it
   - The image will appear in the node

3. **Add a Prompt Node**
   - Click "Add Prompt Node" button
   - Type your prompt in the textarea

4. **Connect Nodes**
   - Click and drag from the output point (right side) of the Image Node
   - Drop on the input point (left side) of the Prompt Node
   - A curved line will connect them

5. **Generate Image**
   - Once connected and prompt is entered, click "Generate Image"
   - A result node will appear with the generated image

6. **Move Nodes**
   - Click and drag any node header to reposition
   - Connections update automatically

7. **Delete Nodes**
   - Click the × button on any node to remove it

## Node Types

- **Image Node** (Blue): Upload and display source images
- **Prompt Node** (Blue): Enter text prompts for generation
- **Result Node** (Green): Display generated results

## Google GenAI API Integration

This application uses Google's Gemini API for image generation through a Node.js backend.

### Prerequisites

1. **Node.js** (version 18 or higher)
2. **Google API Key** - Get one from [Google AI Studio](https://makersuite.google.com/app/apikey)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set your Google API Key as an environment variable:

**Windows (Command Prompt):**
```bash
set GOOGLE_API_KEY=your-api-key-here
```

**Windows (PowerShell):**
```bash
$env:GOOGLE_API_KEY="your-api-key-here"
```

**macOS/Linux:**
```bash
export GOOGLE_API_KEY="your-api-key-here"
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

### How It Works

The application consists of:
- **Frontend**: HTML/CSS/JavaScript node editor (runs in browser)
- **Backend**: Node.js Express server with Google GenAI integration

When you generate an image:
1. Frontend sends the prompt and input image to the backend
2. Backend calls Google's Gemini API with the data
3. Generated image is returned and displayed in a result node

### API Model

The application uses the `gemini-2.0-flash-exp` model which supports:
- Text-to-image generation
- Image-based prompting
- Fast generation times

## Technical Details

### Frontend
- **Pure JavaScript**: No frameworks required
- **HTML5 Canvas**: For drawing node connections
- **CSS3**: Modern styling with gradients and animations
- **Drag and Drop API**: Native HTML5 file handling
- **FileReader API**: For image data handling

### Backend
- **Node.js & Express**: RESTful API server
- **Google GenAI SDK**: Official Google AI SDK
- **CORS**: Cross-origin resource sharing enabled

## Browser Compatibility

- Chrome (recommended)
- Edge
- Firefox
- Safari

All modern browsers are supported since the AI processing happens on the backend.

## Project Structure

```
diffusioncanvas/
├── index.html      # Main HTML structure
├── style.css       # Styling and animations
├── script.js       # Frontend node editor logic
├── server.js       # Backend API server
├── package.json    # Node.js dependencies
├── backend.py      # (Optional) Python backend alternative
└── README.md       # This file
```

## Development

For development with auto-restart on file changes:
```bash
npm run dev
```

## Troubleshooting

### "Failed to fetch" error
- Make sure the backend server is running (`npm start`)
- Check that you're accessing `http://localhost:3000`

### "API Key not set" warning
- Set the `GOOGLE_API_KEY` environment variable before running the server
- The key should be from [Google AI Studio](https://makersuite.google.com/app/apikey)

### No image generated
- Some prompts may return text instead of images
- Try being more specific in your prompt about wanting an image
- Check the console for detailed error messages

## Future Enhancements

- [ ] Save/Load workflows
- [ ] Export generated images
- [ ] Multiple image formats support
- [ ] Undo/Redo functionality
- [ ] Keyboard shortcuts
- [ ] Touch device support
- [ ] Multiple result nodes from one generation
- [ ] Chain multiple prompts together

## License

Open source - feel free to modify and use as needed.

## Notes

- Requires a valid Google API key to function
- Image generation may take a few seconds depending on complexity
- Nodes can be freely moved and reconnected
- The interface is fully interactive and responsive
- Generated images are displayed in result nodes
