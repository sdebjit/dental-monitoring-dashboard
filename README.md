# Dental Monitoring Dashboard

Dental Monitoring Dashboard is a shared, multiuser PDF import pipeline. Each user signs in with Google, chooses one Google Drive folder, and places exported dashboard PDFs there. Dental Monitoring Dashboard validates the report, saves structured data in Firestore, then moves each successfully imported PDF into an `archive` subfolder. Users can refresh manually or choose a daily or longer scan interval (minimum once per day).

The app does not connect to Microsoft, open the source dashboard, or take screenshots. Users export the PDF manually.

## What the sample PDF produces

The supplied October 27 report is text-readable. The parser extracts the report date, operator, shift, 243 completed cases, the exact individual score of 2065.5, benchmark scores, and eight hourly Details rows. It checks that the hourly case counts add to the reported total. A malformed or unsupported PDF stays in the input folder and appears as a scan error. Dental Monitoring Dashboard does not infer values from screenshots.

## Google Cloud & Firebase deployment

This project targets **Cloud Run (service: `daybook`) + Firebase Hosting (`dental-monitoring-dashboard`) + Firestore Standard + one Cloud Scheduler job**. 

Cloud Run runs the backend service. Firebase Hosting provides the clean public URL `https://dental-monitoring-dashboard.web.app` and proxies all traffic to Cloud Run. Firestore stores per-user settings, encrypted OAuth refresh tokens, session state, and parsed reports. The PDFs remain in each user's Google Drive folder and its `archive` child folder. One Scheduler job checks which users are due; each user's interval is stored in Firestore. No per-user Scheduler jobs are needed.

1. Create a Google Cloud project with billing enabled (e.g. `daybook-ma`). Enable Cloud Run, Cloud Build, Artifact Registry, Firestore, Cloud Scheduler, and Google Drive API. Create one Firestore Standard database, preferably in the same region as Cloud Run. Give the Cloud Run service account access to Firestore (for example, `roles/datastore.user`).
2. Configure the OAuth consent screen for the account types you need. Add scopes `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive`. Create a **Web application** OAuth client. Its authorized redirect URI must match your public URL: `https://dental-monitoring-dashboard.web.app/auth/callback` (or your direct Cloud Run address if not using Firebase Hosting).
3. Configure Cloud Run environment variables listed below. Store the client secret, encryption key, and scheduler secret in **Secret Manager** and expose them as environment variables to the Cloud Run service. Never commit them to the project or paste them into chat.
4. Deploy the Cloud Run service from this folder with:
   ```bash
   gcloud run deploy daybook --source . --region europe-southwest1 --allow-unauthenticated
   ```
5. Deploy Firebase Hosting with the Cloud Run rewrite to claim `https://dental-monitoring-dashboard.web.app`:
   ```bash
   firebase deploy --only hosting
   ```
6. Set `DAYBOOK_BASE_URL` to `https://dental-monitoring-dashboard.web.app`. Update the Cloud Run service revision and the OAuth client redirect URI to match.
7. Create one Cloud Scheduler HTTP job with a schedule such as `*/15 * * * *`, method `POST`, target `https://dental-monitoring-dashboard.web.app/api/scheduled` (or the direct `run.app` URL), and header `Authorization: Bearer YOUR_SCHEDULER_SECRET`. Put the secret in Scheduler's job configuration without checking it into source control. Configure retry as needed.
8. Add test users to the OAuth consent screen while the app is in Testing. Open `https://dental-monitoring-dashboard.web.app`, sign in, select a writable Drive folder, put a PDF directly inside it, then click **Refresh now**. Confirm the report appears and the PDF moves into `archive`. Periodic scans use the user's chosen interval.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `DAYBOOK_BASE_URL` | Exact public HTTPS origin (`https://dental-monitoring-dashboard.web.app`), without a trailing path |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |
| `DAYBOOK_ENCRYPTION_KEY` | Random 32-byte key as 64 hex characters; keep it stable across deployments |
| `DAYBOOK_SCHEDULER_SECRET` | Long random bearer secret for the Scheduler endpoint |
| `PORT` | Set by Cloud Run; defaults to 8080 |

Generate independent secrets with `openssl rand -hex 32`. Changing `DAYBOOK_ENCRYPTION_KEY` without migrating stored tokens will require users to reconnect Google. On a local machine, Google Application Default Credentials and a configured Firestore project are required in addition to these variables. Use `npm start` only after configuration. `npm test` and `npm run check` work without cloud credentials.

### Cost and OAuth constraints

Google's free quotas currently include 2 million Cloud Run requests per month with CPU and memory allowances, one Firestore database with 1 GiB storage / 50,000 reads / 20,000 writes per day, and three Cloud Scheduler jobs per billing account. Billing must still be enabled, and Cloud Build, Artifact Registry, network egress, Secret Manager, or overages may create charges. Set a budget alert in Google Cloud. See [Cloud Run pricing](https://cloud.google.com/run/pricing), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), and [Scheduler pricing](https://cloud.google.com/scheduler/pricing).

The requested automatic read-and-archive flow uses the full `drive` OAuth scope. Google classifies it as **restricted**. Dental Monitoring Dashboard's code limits operations to the selected folder, but Google's permission dialog grants broader access. Public production use may require Google verification and a third-party security assessment; this can be much more significant than cloud hosting cost. Testing-mode refresh tokens for external apps generally expire after seven days. See [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), and [OAuth token lifetimes](https://developers.google.com/identity/protocols/oauth2).

## Data handling

Users are identified by their Google account ID, not email. Reports and file statuses live under that user's Firestore document. OAuth refresh tokens use AES-256-GCM encryption with the environment key; sessions use secure, HTTP-only cookies on HTTPS. The PDF is archived only after Firestore commits the parsed report. If the Drive move fails, the next scan retries the move without importing the same file again. If parsing or saving fails, the PDF stays in the chosen folder.

**Stop syncing and disconnect Drive** removes Dental Monitoring Dashboard's stored Google access and stops future scans while preserving imported reports. Users can also revoke the app's grant from their Google Account security settings.

The pipeline currently supports the layout of the supplied dashboard PDF. Other PDF layouts may need parser adjustments. The UI shows a minimal imported-report list; dashboard metrics and visual design can be decided after the pipeline is running.
