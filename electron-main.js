const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Daily Spend Manager",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // In production, you would point this to your hosted URL
  // For now, we can load the local server or local files
  // If we want it to be a standalone desktop app that runs the server locally:
  // win.loadURL('http://localhost:3000');
  
  // Or load the local index.html if we want it to talk to a remote API
  win.loadFile(path.join(__dirname, 'public', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
