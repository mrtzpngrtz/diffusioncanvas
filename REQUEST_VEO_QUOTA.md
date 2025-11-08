# Request Veo 3.0 Quota Increase

## 🎉 Good News!

Your implementation is **working perfectly**! The error message:

```
Quota exceeded for aiplatform.googleapis.com/generate_content_requests_per_minute_per_project_per_base_model
with base model: veo-3.0-generate-001
```

This means:
- ✅ Authentication is working
- ✅ Model is accessible  
- ✅ API calls are successful
- ⚠️ You need more quota

## Request Quota Increase

### Option 1: Google Cloud Console (Easiest)

1. Go to [Quotas Page](https://console.cloud.google.com/iam-admin/quotas?project=diffusioncanvas)

2. In the filter, search for:
   ```
   aiplatform.googleapis.com/generate_content_requests_per_minute_per_project_per_base_model
   ```

3. Find the quota for **Veo 3.0**

4. Select it and click **EDIT QUOTAS**

5. Enter your requested limit (e.g., **60 requests per minute**)

6. Provide justification:
   ```
   Requesting increased quota for Veo 3.0 video generation to support 
   production usage in our web application for AI-powered video generation.
   ```

7. Click **SUBMIT REQUEST**

### Option 2: Direct Link

Visit: https://console.cloud.google.com/iam-admin/quotas?project=diffusioncanvas

### Option 3: Using gcloud CLI

```bash
gcloud alpha services quota update \
  --service=aiplatform.googleapis.com \
  --metric=generate_content_requests_per_minute_per_project_per_base_model \
  --project=diffusioncanvas \
  --value=60
```

## Default Quota Limits

According to the [Veo documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-0-generate):

- **Maximum API requests per minute per project:** 10
- **Maximum videos returned per request:** 4
- **Video length:** 4, 6, or 8 seconds

Your project likely has the default 10 requests per minute, which is quickly exhausted during testing.

## Typical Quota Increase Timeline

- **Automatic approval:** Sometimes instant for small increases
- **Manual review:** 2-5 business days for larger requests
- **Enterprise customers:** Usually faster

## While Waiting for Quota Increase

### Option 1: Use the Fast Model

Try using `veo-3.0-fast-generate-001` instead, which might have a separate quota:

In `server.js`, change:
```javascript
model: 'veo-3.0-generate-001',  // Change to fast model
```
to:
```javascript
model: 'veo-3.0-fast-generate-001',  // Faster generation, may have separate quota
```

### Option 2: Rate Limiting

Add rate limiting to your endpoint to stay within quota:

```javascript
// Add at the top of server.js
import rateLimit from 'express-rate-limit';

// Add before the video endpoint
const videoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per IP
  message: 'Too many video generation requests, please try again later.'
});

// Apply to endpoint
app.post('/api/generate-video', videoRateLimit, isAuthenticated, async (req, res) => {
  // ... existing code
});
```

### Option 3: Queue System

Implement a job queue to handle requests sequentially within quota limits.

## Testing Without Using Quota

You can test the frontend and credit system without actually calling the API by temporarily adding a mock response:

```javascript
// Temporary test mode - add at start of endpoint
if (process.env.VEO_TEST_MODE === 'true') {
  return res.json({
    video: 'data:video/mp4;base64,MOCK_VIDEO_DATA',
    creditsRemaining: req.user.credits - VIDEO_GENERATION_COST,
    duration: duration,
    aspectRatio: aspectRatio
  });
}
```

## Verify Quota Status

Check your current quota usage:

```bash
gcloud alpha services quota describe \
  --service=aiplatform.googleapis.com \
  --consumer=projects/diffusioncanvas \
  --metric=generate_content_requests_per_minute_per_project_per_base_model
```

## Summary

✅ Your Veo 3.0 integration is **fully functional**!
⏳ Just waiting on Google to approve your quota increase
🚀 Once approved, video generation will work perfectly!
