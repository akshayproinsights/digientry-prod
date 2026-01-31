# Helper script to fix Cloud Run permissions
echo "Fixing Cloud Run permissions for digientry-backend..."
gcloud run services add-iam-policy-binding digientry-backend --region=asia-south1 --member=allUsers --role=roles/run.invoker
echo "Done!"
