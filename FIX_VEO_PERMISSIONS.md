# Fix Veo 3.1 Permissions Error

## Error You're Seeing

```
Permission 'aiplatform.endpoints.predict' denied on resource
'//aiplatform.googleapis.com/projects/diffusioncanvas/locations/us-central1/publishers/google/models/veo-3.1'
```

## Solution: Add Required Permissions to Service Account

Your service account needs the **Vertex AI User** role to access Veo 3.1.

### Option 1: Using gcloud CLI (Recommended)

```bash
gcloud projects add-iam-policy-binding diffusioncanvas \
  --member="serviceAccount:diffusioncanvas@diffusioncanvas.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### Option 2: Using Google Cloud Console

1. Go to [IAM & Admin → IAM](https://console.cloud.google.com/iam-admin/iam?project=diffusioncanvas)

2. Find your service account in the list:
   - Name: `diffusioncanvas@diffusioncanvas.iam.gserviceaccount.com`

3. Click the **Edit** (pencil) icon next to it

4. Click **+ ADD ANOTHER ROLE**

5. Search for and select: **Vertex AI User**

6. Click **SAVE**

### Verify the Role Was Added

```bash
gcloud projects get-iam-policy diffusioncanvas \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:diffusioncanvas@diffusioncanvas.iam.gserviceaccount.com"
```

You should see `roles/aiplatform.user` in the output.

## After Adding the Role

The changes take effect immediately. Try generating a video again!

## Required Roles Summary

Your service account should have these roles:
- ✅ **Vertex AI User** - For Veo 3.1 video generation
- ✅ **Service Account Token Creator** (if using for auth)

## Troubleshooting

If you still get errors after adding the role:

1. **Wait a few seconds** - IAM changes can take a moment to propagate
2. **Check the service account email** - Make sure it matches exactly
3. **Verify the project ID** - Should be `diffusioncanvas`
4. **Check Vertex AI is enabled**:
   ```bash
   gcloud services list --enabled --project=diffusioncanvas | grep aiplatform
   ```

## Alternative: Create a New Service Account with Correct Roles

If you prefer to start fresh:

```bash
# Create new service account
gcloud iam service-accounts create diffusioncanvas-video \
  --display-name="Diffusion Canvas Video Generation" \
  --project=diffusioncanvas

# Add Vertex AI User role
gcloud projects add-iam-policy-binding diffusioncanvas \
  --member="serviceAccount:diffusioncanvas-video@diffusioncanvas.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Create and download new key
gcloud iam service-accounts keys create diffusioncanvas-video-key.json \
  --iam-account=diffusioncanvas-video@diffusioncanvas.iam.gserviceaccount.com

# Update Vercel environment variable with contents of new key file
