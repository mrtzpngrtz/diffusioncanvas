const fs = require('fs');
const path = require('path');

// Get the JSON file path from command line arguments
const jsonFilePath = process.argv[2];

if (!jsonFilePath) {
    console.error('Please provide the path to the JSON file.');
    console.error('Usage: node extract_images.js <path_to_json_file>');
    process.exit(1);
}

// Create output directory
const outputDir = path.join(path.dirname(jsonFilePath), 'extracted_images');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

try {
    // Read and parse the JSON file
    const fileContent = fs.readFileSync(jsonFilePath, 'utf8');
    const canvasData = JSON.parse(fileContent);

    if (!canvasData.nodes || !Array.isArray(canvasData.nodes)) {
        console.error('Invalid JSON format: "nodes" array not found.');
        process.exit(1);
    }

    let count = 0;
    
    console.log(`Found ${canvasData.nodes.length} nodes. Scanning for images...`);

    canvasData.nodes.forEach(node => {
        if (node.data && node.data.imageData) {
            const imageData = node.data.imageData;
            
            // Check if it's a base64 string
            if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
                // Extract base64 data
                const base64Data = imageData.split(';base64,').pop();
                
                // Determine file extension (default to png)
                const extensionMatch = imageData.match(/data:image\/([a-zA-Z0-9]+);/);
                const extension = extensionMatch ? extensionMatch[1] : 'png';
                
                // Create filename using node ID or index
                const filename = `${node.type}_${node.id}.${extension}`;
                const filePath = path.join(outputDir, filename);
                
                // Write file
                fs.writeFileSync(filePath, base64Data, { encoding: 'base64' });
                console.log(`Saved: ${filename}`);
                count++;
            }
        }
    });

    console.log(`\nSuccess! Extracted ${count} images to "${outputDir}"`);

} catch (error) {
    console.error('Error processing file:', error.message);
}
