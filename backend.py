from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from google import genai
from google.genai import types
from PIL import Image
from io import BytesIO
import base64
import os

app = Flask(__name__, static_folder='.')
CORS(app)

# Initialize the Genai client
# Make sure to set your API key as an environment variable:
# export GOOGLE_API_KEY='your-api-key-here'
client = genai.Client(api_key=os.environ.get('GOOGLE_API_KEY'))

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/generate', methods=['POST'])
def generate_image():
    try:
        data = request.json
        prompt = data.get('prompt', '')
        input_image_data = data.get('image', '')
        
        if not prompt:
            return jsonify({'error': 'No prompt provided'}), 400
        
        # If an input image is provided, include it in the prompt
        contents = []
        
        if input_image_data:
            # Remove the data:image/... prefix if present
            if 'base64,' in input_image_data:
                input_image_data = input_image_data.split('base64,')[1]
            
            # Decode the base64 image
            image_bytes = base64.b64decode(input_image_data)
            
            # Create prompt with image context
            full_prompt = f"Based on this input image, {prompt}"
            contents = [
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type='image/png'
                ),
                full_prompt
            ]
        else:
            contents = [prompt]
        
        # Generate image using Gemini 2.0 Flash Image model
        response = client.models.generate_content(
            model='gemini-2.0-flash-exp',
            contents=contents,
        )
        
        # Process the response
        result_data = {
            'text': None,
            'image': None
        }
        
        for part in response.candidates[0].content.parts:
            if part.text is not None:
                result_data['text'] = part.text
            elif part.inline_data is not None:
                # Convert image to base64
                image = Image.open(BytesIO(part.inline_data.data))
                buffered = BytesIO()
                image.save(buffered, format="PNG")
                img_str = base64.b64encode(buffered.getvalue()).decode()
                result_data['image'] = f"data:image/png;base64,{img_str}"
        
        return jsonify(result_data)
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Check if API key is set
    if not os.environ.get('GOOGLE_API_KEY'):
        print("WARNING: GOOGLE_API_KEY environment variable not set!")
        print("Set it with: export GOOGLE_API_KEY='your-api-key-here'")
    
    print("Starting Flask server on http://localhost:5000")
    print("Make sure to set GOOGLE_API_KEY environment variable")
    app.run(debug=True, port=5000)
