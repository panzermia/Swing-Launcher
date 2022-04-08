const { ipcRenderer } = require("electron");
const fs = require("fs");
const axios = require("axios").default;
const log = require("electron-log");
const utils = require("./utils");

Object.assign(console, log.functions);
log.transports.file.fileName = "logs.log";

window.addEventListener("load", async () => {
    document.getElementById("splashMessage").innerText = "Initializing";
    document.getElementById("splashProgress").style.setProperty("--value", "25%");
    await utils.reloadIcons();
    
    if (!(await utils.getSetting("settings")).darkMode)
        document.body.setAttribute("theme", "light");

    try {
        await axios.get("https://google.com", { timeout: 3000 });

        if (!navigator.onLine)
            throw new Error();
    }
    catch {
        console.error("No internet connection found!");
        document.getElementById("splashMessage").innerText = "No Internet Connection";
        document.getElementById("splashProgress").style.opacity = "0";
        return;
    }
    
    document.getElementById("splashMessage").innerText = "Checking for Updates";
    document.getElementById("splashProgress").style.setProperty("--value", "50%");
    ipcRenderer.send("CheckForUpdates", utils.getPackageData().version);

    ipcRenderer.on("CheckForUpdatesComplete", async (_, status, url) => {
        if (!status || !(await utils.getSetting("autoUpdate"))) {
            document.getElementById("splashMessage").innerText = "Finishing up!";
            document.getElementById("splashProgress").style.setProperty("--value", "100%");
            if (fs.existsSync((await utils.getPaths("temp")) + "\\Swing-Updater.exe"))
                fs.unlinkSync((await utils.getPaths("temp")) + "\\Swing-Updater.exe");

            utils.openMain();
        }
        else {
            document.getElementById("splashMessage").innerText = "Updating";
            document.getElementById("splashProgress").style.setProperty("--value", "75%");
            ipcRenderer.send("InstallUpdate", url);
        }
    });
});