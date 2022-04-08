const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const log = require("electron-log");
const axios = require("axios").default;
const regedit = require("regedit");
const vdfplus = require("vdfplus");
const AdmZip = require("adm-zip");
const showdown = require("showdown");
const { spawn } = require("child_process");
var libraryData;

regedit.setExternalVBSLocation("resources/regedit/vbs");
Object.assign(console, log.functions);
log.transports.file.fileName = "logs.log";

//#region FUNCTIONS

function closeWindow() {
    ipcRenderer.send("WinClose");
}

function minimizeWindow() {
    ipcRenderer.send("WinMinimize");
}

async function reloadIcons() {
    for (const icon of document.getElementsByTagName("icon")) {
        let iconXML = await fetch("./assets/icons/" + icon.getAttribute("name") + ".svg");
        icon.innerHTML = await iconXML.text();
    }
}

function openMain() {
    ipcRenderer.send("OpenMain");
}

async function reloadPlay() {
    document.getElementById("playItems").replaceChildren();
    document.getElementById("playItems").removeAttribute("style");
    for (const product of libraryData) {
        if (await isInstalled(product.id)) {
            let card = document.createElement("div"), banner = document.createElement("img"), info = document.createElement("div"), name = document.createElement("h2"), version = document.createElement("p");

            banner.src = product.banner;
            name.innerText = product.name;
            if ((await getSetting("installed"))[product.id].version == product.version)
                version.innerText = "Version " + product.version;
            else {
                card.setAttribute("update", "");
                version.innerText = "Update available!";
            }

            info.appendChild(name);
            info.appendChild(version);
            card.appendChild(banner);
            card.appendChild(info);
            document.getElementById("playItems").appendChild(card);

            card.addEventListener("click", () => {
                document.getElementById("goToItem").innerText = product.id;
                document.getElementById("goToItem").click();
            });
        }
    }

    if (document.getElementById("playItems").children.length == 0) {
        document.getElementById("playItems").style.height = "100%";
        document.getElementById("playItems").style.justifyContent = "center";
        document.getElementById("playItems").style.alignItems = "center";
        let emptyP = document.createElement("p");
        emptyP.innerText = "Your shelf seems to be empty, time to add some stuff!"
        document.getElementById("playItems").appendChild(emptyP);
    }
}

async function reloadLibrary() {
    document.getElementById("playLoading").style.display = "unset";
    document.getElementById("libraryLoading").style.display = "unset";
    console.log("Loading library products");

    let library = (await axios.get(getPackageData().library)).data;
    libraryData = library.products;

    reloadPlay();
    document.getElementById("libraryItems").replaceChildren();
    for (const product of libraryData) {
        let card = document.createElement("div"), banner = document.createElement("img"), info = document.createElement("div"), name = document.createElement("h2"), version = document.createElement("p");

        banner.src = product.banner;
        name.innerText = product.name;

        if (!(await isInstalled(product.id)) || (await getSetting("installed"))[product.id].version == product.version)
            version.innerText = "Version " + product.version;
        else {
            card.setAttribute("update", "");
            version.innerText = "Update available!";
        }

        info.appendChild(name);
        info.appendChild(version);
        card.appendChild(banner);
        card.appendChild(info);
        document.getElementById("libraryItems").appendChild(card);

        card.addEventListener("click", () => {
            document.getElementById("goToItem").innerText = product.id;
            document.getElementById("goToItem").click();
        });
    }
    document.getElementById("playLoading").removeAttribute("style");
    document.getElementById("libraryLoading").removeAttribute("style");
    console.log("Successfully loaded the library");
}

async function isInstalled(pID) {
    let installedObject = await getSetting("installed");

    if (installedObject[pID] != undefined)
        return true;
    else
        return false;
}

function getProductDataById(pID) {
    for (const product of libraryData) {
        if (product.id == pID)
            return product;
    }
}

function getPackageData() {
    return ipcRenderer.sendSync("GetPackageData");
}

async function getPaths(name) {
    return await ipcRenderer.sendSync("GetPaths", name);
}

async function getSetting(name) {
    return await ipcRenderer.sendSync("GetSetting", name);
}

function setSetting(name, value) {
    return ipcRenderer.send("SetSetting", name, value);
}

async function getChanges() {
    return await ipcRenderer.sendSync("GetChanges");
}

async function expandPath(path, pPath) {
    return await ipcRenderer.sendSync("ExpandPath", path, pPath);
}

async function installProduct() {
    let pData = getProductDataById(document.querySelector("#itemContent > div > button").getAttribute("pid")), gamePath = null;

    console.log("Starting to download the product " + pData.id);
    document.getElementById("itemButton").disabled = true;
    document.getElementById("appSidebar").setAttribute("disabled", "");
    document.querySelector("#itemContentBottomBar > div").style.opacity = "1";
    document.querySelector("#itemContentBottomBar > div > div > div").style.opacity = "1";

    async function unlockLauncher() {
        document.getElementById("itemStatus").innerText = "Loading";
        document.getElementById("itemButton").disabled = false;
        document.getElementById("appSidebar").removeAttribute("disabled");
        document.querySelector("#itemContentBottomBar > div").removeAttribute("style");
        document.querySelector("#itemContentBottomBar > div > div > div").removeAttribute("style");

        await reloadLibrary();
    }

    let gamePaths = await getSetting("gamePaths");
    for (const gPath of Object.keys(gamePaths)) {
        if (gPath == pData.store)
            gamePath = gamePaths[gPath];
    }
    if (gamePath == null) {
        let steamPath = null, libraryObj = undefined;

        try {
            steamPath = (await regedit.promisified.list("HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam"))["HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam"].values.InstallPath.value.replace(/\\/g, "/");
        }
        catch {
            try {
                steamPath = (await regedit.promisified.list("HKLM\\SOFTWARE\\Valve\\Steam"))["HKLM\\SOFTWARE\\Valve\\Steam"].values.InstallPath.value.replace(/\\/g, "/");
            }
            catch {
                showPopUp("alertPopup", "Error", "Looks like there was a problem detecting your Steam installation. Try to repair it and try again.");
                console.error("The Steam path wasn't found on regedit");
                unlockLauncher();
                return;
            }
        }

        libraryObj = vdfplus.parse(fs.readFileSync(steamPath + "/config/libraryfolders.vdf", "utf8"));
        for (let i = 0; i < Object.keys(libraryObj.libraryfolders).length - 1; i++) {
            if (Object.keys(libraryObj.libraryfolders[String(i)].apps).includes(String(pData.id))) {
                gamePaths[String(pData.id)] = gamePath = libraryObj.libraryfolders[String(i)].path.replace(/\\\\/g, "/") + "/steamapps/common/" + pData.path;
                setSetting("gamePaths", gamePaths);
                break;
            }
        }
        if (gamePath == null) {
            showPopUp("alertPopup", "Error", "Looks like there was a problem detecting your game installation. Check if you have the game installed from the store and try again.");
            console.error("Game path couldn't be found on the store files");
            unlockLauncher();
            return; 
        }
    }

    console.log("Download started");
    document.getElementById("itemStatus").innerText = "Downloading";
    ipcRenderer.send("DownloadProduct", pData);
    
    ipcRenderer.on("DownloadProgress", (_, progress, speed, eta) => {
        document.getElementById("itemProgress").style.setProperty("--value", progress + "%");
        document.querySelector("#itemSpeed > span").innerText = Math.round((speed / 1024 / 1024) * 100) / 100 + " MB/s";
        document.querySelector("#itemEta > span").innerText = eta + " sec";
    });

    ipcRenderer.on("DownloadComplete", (_, status, err) => {
        if (!status) {
            showPopUp("crashPopup", "Error", "Something happened while downloading this product:", err);
            console.error("There was an error while downloading this product: " + err);
            unlockLauncher();
            return;
        }

        console.log("Download complete!");
        console.log("Starting to install the product " + pData.id);
        document.getElementById("itemStatus").innerText = "Installing";
        document.querySelector("#itemContent > div > div > div > div").style.opacity = "0";
        ipcRenderer.send("InstallProduct", pData, gamePath);

        ipcRenderer.on("InstallationProgress", (_, progress) => document.getElementById("itemProgress").style.setProperty("--value", progress + "%"));

        ipcRenderer.on("InstallationComplete", async (_, status, err) => {
            if (!status) {
                showPopUp("crashPopup", "Error", "Something happened while installing this product:", err);
                console.error("There was an error while installing this product: " + err);
                unlockLauncher();
                return;
            }
            console.log("Installation complete!");
            
            await unlockLauncher();
            document.getElementById("goToItem").click();
            if (fs.existsSync((await getPaths("temp")) + "\\" + pData.id + ".zip"))
                fs.unlinkSync((await getPaths("temp")) + "\\" + pData.id + ".zip");
        });
    });
}

async function disableEnableProduct(disable) {
    let pData = getProductDataById(document.querySelector("#itemContent > div > button").getAttribute("pid"));

    console.log("Starting to " + (disable ? "disable" : "enable") + " the product " + pData.id);
    let gamePaths = await getSetting("gamePaths"), gamePath = null;
    for (const gPath of Object.keys(gamePaths)) {
        if (gPath == pData.store)
            gamePath = gamePaths[gPath];
    }
    ipcRenderer.send("DisableEnableProduct", disable, pData, gamePath);
    
    ipcRenderer.on("DisableEnableProductComplete", async (_, status, err) => {
        if (!status) {
            showPopUp("crashPopup", "Error", "Something happened while " + (disable ? "deactivating" : "enabling") + " this product:", err);
            console.error("There was an error while " + (disable ? "deactivating" : "enabling") + " this product: " + err);
            return;
        }
        console.log((disable ? "Disable" : "Enable") + " complete!");

        await reloadLibrary();
        document.getElementById("goToItem").click();
    });
}

async function uninstallProduct() {
    let pData = getProductDataById(document.querySelector("#itemContent > div > button").getAttribute("pid"));
    
    showPopUp("askPopup", "Uninstall", "Are you sure you want to uninstall " + pData.name + "?", null, async () => {
        console.log("Starting to uninstall the product " + pData.id);
        let gamePaths = await getSetting("gamePaths"), gamePath = null;
        for (const gPath of Object.keys(gamePaths)) {
            if (gPath == pData.store)
                gamePath = gamePaths[gPath];
        }
        ipcRenderer.send("UninstallProduct", pData, gamePath);
        
        ipcRenderer.on("UninstallComplete", async (_, status, err) => {
            if (!status) {
                showPopUp("crashPopup", "Error", "Something happened while uninstalling this product:", err);
                console.error("There was an error while uninstalling this product: " + err);
                return;
            }
            console.log("Uninstall complete!");

            await reloadLibrary();
            document.getElementById("goToItem").click();
        });
    });
}

async function playProduct(disabled) {
    let pData = getProductDataById(document.querySelector("#itemContent > div > button").getAttribute("pid")), steamPath = null, args = ["-gameidlaunch " + pData.id];

    console.log("Running the product " + pData.id + (disabled ? " on disabled mode" : ""));
    try {
        steamPath = (await regedit.promisified.list("HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam"))["HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam"].values.InstallPath.value.replace(/\\/g, "/");
    }
    catch {
        try {
            steamPath = (await regedit.promisified.list("HKLM\\SOFTWARE\\Valve\\Steam"))["HKLM\\SOFTWARE\\Valve\\Steam"].values.InstallPath.value.replace(/\\/g, "/");
        }
        catch {
            showPopUp("alertPopup", "Error", "Looks like there was a problem detecting your Steam installation. Try to repair it and try again.");
            console.error("The Steam path wasn't found on regedit");
            return;
        }
    }

    spawn("\"" + steamPath + "/steam.exe\"", (disabled ? args : args.concat(pData.arguments)), { detached: true, shell: true, stdio: "ignore" }).unref();
    console.log("Product started!");
}

async function backupProduct(pPath) {
    try {
        let pData = getProductDataById(document.querySelector("#itemContent > div > button").getAttribute("pid")), backup = new AdmZip();

        console.log("Starting backup for game " + pData.store);
        let gamePaths = await getSetting("gamePaths"), gamePath = null;
        for (const gPath of Object.keys(gamePaths)) {
            if (gPath == pData.store)
                gamePath = gamePaths[gPath];
        }
        backup.addLocalFolder(await expandPath(pData.backup, gamePath));
        backup.addFile("bckInfo.json", Buffer.from(JSON.stringify({ "pID": pData.store }), "utf8"));
        backup.writeZip(pPath);
        console.log("Backup completed!");
    }
    catch (err) {
        showPopUp("crashPopup", "Error", "The backup wasn't completed successfully:", err);
        console.error("The backup wasn't completed successfully: " + err);
    }
}

async function restoreProduct(pPath) {
    try {
        let pData = getProductDataById(document.querySelector("#itemContent > div > button").getAttribute("pid")), restore = new AdmZip(pPath);

        console.log("Starting restore for game " + pData.store);
        let gamePaths = await getSetting("gamePaths"), gamePath = null;
        for (const gPath of Object.keys(gamePaths)) {
            if (gPath == pData.store)
                gamePath = gamePaths[gPath];
        }

        if (restore.readAsText("bckInfo.json").length == 0) {
            showPopUp("alertPopup", "Invalid backup", "The selected zip file is not a backup. Please select a backup instead.");
            console.error("The zip selected wasn't a backup");
            return;
        }
        let bckInfo = JSON.parse(restore.readAsText("bckInfo.json"));
        if (bckInfo.pID != pData.store) {
            showPopUp("alertPopup", "Wrong backup", "This backup doesn't belong to this game. Please try another backup.");
            console.error("The backup selected didn't belong to the game " + pData.store);
            return;
        }
        let expandedGamePath = await expandPath(pData.backup, gamePath), oldFiles = fs.readdirSync(expandedGamePath);
        for (const file of oldFiles)
            fs.unlinkSync(path.join(expandedGamePath, file));
        restore.extractAllTo(expandedGamePath);
        fs.unlinkSync(path.join(expandedGamePath, "bckInfo.json"));
        console.log("Restore completed!");
    }
    catch (err) {
        showPopUp("crashPopup", "Error", "The restore wasn't completed successfully:", err);
        console.error("The restore wasn't completed successfully: " + err);
    }
}

async function showOpenDialog(title, filters, properties) {
    return await ipcRenderer.sendSync("ShowDialog", "OPEN", {
        title: title,
        filters: filters,
        properties: properties
    });
}

async function showSaveDialog(title, defaultPath, filters) {
    return await ipcRenderer.sendSync("ShowDialog", "SAVE", {
        title: title,
        defaultPath: defaultPath,
        filters: filters
    });
}

async function showPopUp(type, title, text, boxText, yesFunc) {
    document.querySelector("#" + type + " > h1").innerText = title;
    if (type == "alertPopup" || type == "askPopup")
        document.querySelector("#" + type + " > p").innerText = text;
    if (type == "changelogPopup")
        document.querySelector("#" + type + " > div").innerHTML = new showdown.Converter().makeHtml(boxText);
    if (type == "crashPopup") {
        document.querySelector("#" + type + " > p").innerText = text;
        document.querySelector("#" + type + " > div").innerText = boxText;
    }

    async function closePopUp(event) {
        if (event.currentTarget == event.target) {
            document.getElementById("popups").removeEventListener("click", closePopUp);
            if (type == "alertPopup")
                document.querySelector("#" + type + " > button").removeEventListener("click", closePopUp);
            else if (type == "askPopup") {
                let oldYesButton = document.querySelector("#" + type + " > div > button:first-child");
                let newYesButton = oldYesButton.cloneNode(true);
                oldYesButton.parentNode.replaceChild(newYesButton, oldYesButton);
                document.querySelector("#" + type + " > div > button:last-child").removeEventListener("click", closePopUp);
            }
            else if (type == "changelogPopup")
                document.querySelector("#" + type + " > button").removeEventListener("click", closePopUp);
            else if (type == "crashPopup")
                document.querySelector("#" + type + " > button").removeEventListener("click", closePopUp);
            document.getElementById("popups").style.opacity = "0";
            document.getElementById(type).style.opacity = "0";
            document.getElementById(type).style.transform = "scale(0.5)";
            await sleep(200);
            document.getElementById(type).removeAttribute("style");
            document.getElementById("popups").removeAttribute("style");
        }
    }

    document.getElementById("popups").style.display = "flex";
    await sleep(50);
    document.getElementById("popups").style.opacity = "1";
    document.getElementById(type).style.display = "block";
    await sleep(50);
    document.getElementById(type).style.opacity = "1";
    document.getElementById(type).style.transform = "scale(1)";
    document.getElementById("popups").addEventListener("click", closePopUp);
    if (type == "alertPopup")
        document.querySelector("#" + type + " > button").addEventListener("click", closePopUp);
    else if (type == "askPopup") {
        document.querySelector("#" + type + " > div > button:first-child").addEventListener("click", closePopUp);
        document.querySelector("#" + type + " > div > button:first-child").addEventListener("click", yesFunc);
        document.querySelector("#" + type + " > div > button:last-child").addEventListener("click", closePopUp);
    }
    else if (type == "changelogPopup")
        document.querySelector("#" + type + " > button").addEventListener("click", closePopUp);
    else if (type == "crashPopup")
        document.querySelector("#" + type + " > button").addEventListener("click", closePopUp);
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

//#endregion

exports.closeWindow = closeWindow;
exports.minimizeWindow = minimizeWindow;
exports.reloadIcons = reloadIcons;
exports.openMain = openMain;
exports.reloadPlay = reloadPlay;
exports.reloadLibrary = reloadLibrary;
exports.isInstalled = isInstalled;
exports.getProductDataById = getProductDataById;
exports.getPackageData = getPackageData;
exports.getPaths = getPaths;
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.getChanges = getChanges;
exports.expandPath = expandPath;
exports.installProduct = installProduct;
exports.disableEnableProduct = disableEnableProduct;
exports.uninstallProduct = uninstallProduct;
exports.playProduct = playProduct;
exports.backupProduct = backupProduct;
exports.restoreProduct = restoreProduct;
exports.showOpenDialog = showOpenDialog;
exports.showSaveDialog = showSaveDialog;
exports.showPopUp = showPopUp;
exports.sleep = sleep;