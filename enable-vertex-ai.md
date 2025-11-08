# Enable Vertex AI API via Command Line

Run this command to enable the Vertex AI API:

```bash
gcloud services enable aiplatform.googleapis.com --project=diffusioncanvas
```

This will enable the Vertex AI API for your project.

## Verify it's enabled:

```bash
gcloud services list --enabled --project=diffusioncanvas | grep aiplatform
```

You should see: `aiplatform.googleapis.com`
