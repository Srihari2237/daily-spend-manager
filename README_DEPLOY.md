# Deployment Guide for Daily Spend Manager

This project is now configured to run as a standalone desktop application (Electron) and a mobile application (Capacitor), both syncing data to a central server.

## 1. Host the Server
To sync data between your phone and desktop, you must host the server online.

### Recommended: Render (Free Tier)
1. Create a [Render](https://render.com/) account.
2. Create a new **Web Service**.
3. Connect your GitHub repository.
4. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. **Persistent Disk (Important)**:
   - To keep your data when the server restarts, go to the **Disk** tab in Render.
   - Add a disk with mount path `/data`.
   - In `server.js`, ensure it looks for the database in `/data/database.json` (or set an environment variable).

## 2. Configure the Apps
Once you have your hosted URL (e.g., `https://my-spend-app.onrender.com`):

1. Open `public/app.js`.
2. Find the `API_BASE` constant at the top.
3. Replace the placeholder URL with your actual hosted URL:
   ```javascript
   const API_BASE = window.location.origin.startsWith('file') ? 'https://YOUR-APP-NAME.onrender.com' : '';
   ```

## 3. Desktop App (Windows/macOS/Linux)
To run the desktop app:
```bash
npm run electron
```
### Packaging for Distribution
To create a Windows installer (`.exe`):
1. Run: `npm run dist`
2. The installer will be generated in the `dist` folder. You can share this file with others to install the app on their Windows machines.

## 4. Mobile App (Android/iOS)
### Android
1. Install [Android Studio](https://developer.android.com/studio).
2. Sync the project: `npm run mobile:sync`.
3. Open in Android Studio: `npm run mobile:open`.
4. Build the APK/Bundle from Android Studio.

### iOS (Requires Mac)
1. Run `npx cap add ios`.
2. Sync: `npm run mobile:sync`.
3. Open in Xcode: `npx cap open ios`.
4. Build from Xcode.

## 5. Local Development
To run the server locally for testing:
```bash
npm start
```
The app will be available at `http://localhost:3000`.
