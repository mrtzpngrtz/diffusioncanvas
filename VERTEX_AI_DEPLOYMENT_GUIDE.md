# Vertex AI Video Generation - Deployment Guide

## ✅ Completed Steps

1. ✅ Created Google Cloud project: `diffusioncanvas`
2. ✅ Enabled Vertex AI API
3. ✅ Created service account with credentials
4. ✅ Updated code to use Vertex AI for Veo 3.1
5. ✅ Removed placeholder error message

## 🚀 Final Deployment Steps

### Step 1: Set Environment Variables in Vercel

Go to your Vercel project settings and add these environment variables:

1. **GOOGLE_CLOUD_PROJECT_ID**
   - Value: `diffusioncanvas`

2. **GOOGLE_APPLICATION_CREDENTIALS_JSON**
   - Value: Copy the ENTIRE contents of your service account JSON file
   - Location: `C:\Users\mrtz\Downloads\diffusioncanvas-f000174f3c58.json`
   - Important: Copy as a single-line JSON string (Vercel will handle it)

### Step 2: Deploy to Vercel

```bash
# Commit your changes
git add .
git commit -m "Add Vertex AI video generation support"
git push

# Or redeploy via Vercel CLI
vercel --prod
```

### Step 3: Test Video Generation

Once deployed:

1. Log into your application
2. Add a Veo 3.1 Video node
3. Enter a video prompt (e.g., "A beautiful sunset over the ocean")
4. Optionally connect 1-3 images for frame guidance
5. Click "Generate Video"

## ⚠️ IMPORTANT: Veo 3.1 Model Status

**Current Issue:** The model `veo-3.1` returns a "404 Not Found" error, which means:

1. **Veo 3.1 may not be publicly available yet** - It might be in private preview
2. **The model name might be different** - Google may use a different identifier
3. **Special access might be required** - You may need to apply for early access

### Possible Solutions

#### Option 1: Check Veo Model Availability
Visit [Google Cloud Vertex AI Models](https://console.cloud.google.com/vertex-ai/publishers/google/model-garden) and search for available video generation models.

#### Option 2: Request Access to Veo
If Veo is in private preview, you may need to:
1. Fill out an access request form
2. Join a waitlist
3. Contact Google Cloud sales

#### Option 3: Use Alternative Model (Imagen Video)
Check if `imagen-video` or similar models are available in your region.

## 📋 Technical Details (When Model is Available)

### Video Generation Costs
- **5 credits** per video generation
- Ensure users have sufficient credits before attempting generation

### Supported Parameters
- **Duration**: 5, 8, or 10 seconds
- **Aspect Ratios**: 16:9 (Landscape), 9:16 (Portrait), 1:1 (Square)
- **Frame Guidance**: Optional 1-3 reference images (first, middle, last frames)

### API Endpoint
- Implemented in `server.js` at `/api/generate-video`
- Uses Vertex AI with service account credentials

### Authentication
- Uses Vertex AI with service account credentials
- Credentials loaded from `GOOGLE_APPLICATION_CREDENTIALS_JSON` environment variable
- Model: `veo-3.1` in `us-central1` region (when available)

## 🔍 Troubleshooting

### Error: "Vertex AI API not enabled"
- Run: `gcloud services enable aiplatform.googleapis.com --project=diffusioncanvas`
- Verify: `gcloud services list --enabled --project=diffusioncanvas | grep aiplatform`

### Error: "Authentication failed"
- Check that `GOOGLE_APPLICATION_CREDENTIALS_JSON` is set correctly in Vercel
- Ensure the JSON is valid and contains all required fields
- Verify service account has "Vertex AI User" role

### Error: "Insufficient credits"
- Video generation requires 5 credits
- Admin can add credits via the admin panel

### Error: "No video generated"
- Check Vercel function logs for detailed error messages
- Ensure the prompt is clear and descriptive
- Try different video durations or aspect ratios

## 📚 Resources

- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)
- [Veo Model Guide](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/veo)
- [Google Cloud Setup](https://cloud.google.com/docs/authentication/getting-started)

## 🎯 Next Steps

After successful deployment:

1. Test with various prompts and settings
2. Monitor credit usage
3. Adjust video generation costs if needed
4. Consider adding video preview/download functionality
5. Add video storage/gallery feature (optional)
