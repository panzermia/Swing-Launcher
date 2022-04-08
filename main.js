const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const log = require("electron-log");
const Store = require("electron-store");
const axios = require("axios").default;
const { File } = require("megajs");
const progress = require("progress-stream");
const AdmZip = require("adm-zip");
const regedit = require("regedit");
var splash, win;

//#region INITIALIZATION

regedit.setExternalVBSLocation("resources/regedit/vbs");
Object.assign(console, log.functions);
log.transports.file.fileName = "logs.log";
log.transports.file.getFile().clear();
console.log("Starting Swing Launcher " + app.getVersion() + " on Windows " + os.release());
console.log("Running on Electron " + process.versions.electron + " and NodeJS " + process.versions.node);

const appConfig = new Store({ defaults: {
    lastRunVersion: app.getVersion(),
    settings: {
        darkMode: true
    },
    gamePaths: {},
    installed: {},
    autoUpdate: true
}});

//#endregion

//#region WINDOWS

function createWindow() {
    splash = new BrowserWindow({
        title: "Swing Launcher",
        width: 450,
        height: 300,
        frame: false,
        resizable: false,
        fullscreen: false,
        fullscreenable: false,
        maximizable: false,
        show: false,
        icon: path.join(__dirname, "assets/logo.png"),
        sandbox: true,
        webPreferences: {
            devTools: true,
            preload: path.join(__dirname, "src/splash.js")
        }
    });
    splash.loadFile("splash.html");
    splash.once("ready-to-show", () => splash.show());

    win = new BrowserWindow({
        title: "Swing Launcher",
        width: 1000,
        height: 600,
        frame: false,
        resizable: false,
        fullscreen: false,
        fullscreenable: false,
        maximizable: false,
        show: false,
        icon: path.join(__dirname, "assets/logo.png"),
        sandbox: true,
        webPreferences: {
            devTools: true,
            preload: path.join(__dirname, "src/home.js")
        }
    });
    win.loadFile("index.html");
}

//#endregion

//#region APP EVENTS

app.on("second-instance", () => {
    if (win.isMinimized())
        win.restore();
    win.focus();
});

app.whenReady().then(() => {
    createWindow();
    
    globalShortcut.register("CommandOrControl+Shift+I", () => {
        return false;
    });
    
    globalShortcut.register("CommandOrControl+F12", () => {
        if (BrowserWindow.getFocusedWindow())
            BrowserWindow.getFocusedWindow().webContents.openDevTools();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
});

//#endregion

//#region RENDER EVENTS

ipcMain.on("WinClose", () => app.exit());

ipcMain.on("WinMinimize", () => BrowserWindow.getAllWindows()[0].minimize());

ipcMain.on("OpenMain", () => {
    splash.close();
    win.show();
});

ipcMain.on("GetPackageData", (event) => event.returnValue = getPackageData());

function getPackageData() { 
    return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
}

ipcMain.on("GetPaths", (event, name) => event.returnValue = app.getPath(name));

ipcMain.on("GetSetting", (event, name) => event.returnValue = appConfig.get(name));

ipcMain.on("SetSetting", (_, name, value) => appConfig.set(name, value));

ipcMain.on("CheckForUpdates", async (_, version) => {
    try {
        let ghInfo = await axios.get(getPackageData().releases + "/releases/latest");
        if (version == ghInfo.data.tag_name)
            splash.webContents.send("CheckForUpdatesComplete", false);
        else
            splash.webContents.send("CheckForUpdatesComplete", true, ghInfo.data.assets[1].browser_download_url);
    }
    catch (err) {
        console.error("There was an error while checking for launcher updates: " + err);
        splash.webContents.send("CheckForUpdatesComplete", false);
    }
});

ipcMain.on("InstallUpdate", async (_, url) => {
    let writer = fs.createWriteStream(app.getPath("temp") + "\\Swing-Updater.exe");
    let ghFile = await axios.get(url, {
        responseType: "stream"
    });

    ghFile.data.pipe(writer);
    writer.on("close", async () => {
        await shell.openPath(app.getPath("temp") + "\\Swing-Updater.exe");
        app.exit();
    });
});

ipcMain.on("GetChanges", async (event) => {
    let ghChanges = await axios.get(getPackageData().releases + "/releases/tags/" + getPackageData().version);
    event.returnValue = ghChanges.data.body;
});

ipcMain.on("ExpandPath", (event, shortPath, pPath) => event.returnValue = expandPath(shortPath, pPath));

function expandPath(shortPath, pPath) {
    return shortPath.replace("%AppData%", app.getPath("appData")).replace("%LocalAppData%", path.join(app.getPath("appData"), "../Local")).replace("%Game%", pPath);
}

ipcMain.on("DownloadProduct", async (_, pData) => {
    try {
        let fileStream = fs.createWriteStream(app.getPath("temp") + "\\" + pData.id + ".zip");
        let megaFile = (await File.fromURL(pData.download).loadAttributes()).children[0];
        let streamProgress = progress({ length: Number(megaFile.size), time: 100 });

        let filePipe = megaFile.download().pipe(streamProgress).pipe(fileStream);
        streamProgress.on("progress", (pgss) => {
            win.webContents.send("DownloadProgress", (pgss.percentage * 60) / 100, pgss.speed, pgss.eta);
            win.setProgressBar((pgss.percentage * 60) / 10000);
        });
        filePipe.on("finish", () => win.webContents.send("DownloadComplete", true));
    }
    catch (err) {
        win.webContents.send("DownloadComplete", false, err);
    }
});

ipcMain.on("InstallProduct", async (_, pData, pPath) => {
    try {
        let pgssStep = 40 / pData.install.length, pgssTotal = 60;
        let pZip = new AdmZip(app.getPath("temp") + "\\" + pData.id + ".zip");

        for (const task of pData.install) {
            let args = task.split(" ");
            if (pZip.getEntry(args[1] + "/") != null) {
                args[2] = expandPath(args[2], pPath);
                pZip.extractEntryTo(pZip.getEntry(args[1] + "/").entryName, args[2], false, true);
                pgssTotal += pgssStep;
                win.webContents.send("InstallationProgress", pgssTotal);
                win.setProgressBar(pgssTotal / 100);
            }
        }

        let installedObject = appConfig.get("installed");
        installedObject[pData.id] = {
            version: pData.version,
            disabled: false
        };
        appConfig.set("installed", installedObject);
        win.setProgressBar(-1);
        win.webContents.send("InstallationComplete", true);
    }
    catch (err) {
        win.webContents.send("InstallationComplete", false, err);
    }
});

ipcMain.on("DisableEnableProduct", async (_, disable, pData, pPath) => {
    try {
        for (const task of pData.disable) {
            let args = task.split(" ");
            args[1] = expandPath(args[1], pPath);

            if (disable && fs.existsSync(args[1]))
                fs.renameSync(args[1], args[1] + ".disabled");
            else if (!disable && fs.existsSync(args[1] + ".disabled"))
                fs.renameSync(args[1] + ".disabled", args[1]);
        }

        let installedObject = appConfig.get("installed");
        installedObject[pData.id].disabled = disable;
        appConfig.set("installed", installedObject);

        win.webContents.send("DisableEnableProductComplete", true);
    }
    catch (err) {
        win.webContents.send("DisableEnableProductComplete", false, err);
    }
});

ipcMain.on("UninstallProduct", async (_, pData, pPath) => {
    try {
        for (const task of pData.uninstall) {
            let args = task.split(" ");
            args[1] = expandPath(args[1], pPath);

            if (fs.existsSync(args[1]))
                fs.unlinkSync(args[1]);
        }

        let installedObject = appConfig.get("installed");
        delete installedObject[pData.id];
        appConfig.set("installed", installedObject);

        win.webContents.send("UninstallComplete", true);
    }
    catch (err) {
        win.webContents.send("UninstallComplete", false, err);
    }
});

ipcMain.on("ShowDialog", async (event, type, options) => {
    if (type == "OPEN")
        event.returnValue = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], options);
    else if (type == "SAVE")
        event.returnValue = await dialog.showSaveDialog(BrowserWindow.getAllWindows()[0], options);
});

//#endregion