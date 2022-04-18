const { shell } = require("electron");
const log = require("electron-log");
const utils = require("./utils");
const { sleep } = require("./utils");
var openPanel = null, hueRotate = 0, hueRotateTimeOut = undefined, upSideDown = 0, upSideDownTimeOut = undefined;

Object.assign(console, log.functions);
log.transports.file.fileName = "logs.log";

window.addEventListener("load", () => {
    //#region INITIALIZATION

    (async function () {
        await utils.reloadIcons();

        if (!(await utils.getSetting("settings")).darkMode) {
            document.body.setAttribute("theme", "light");
            document.getElementById("settingsAppearance").value = "0";
        }

        for (const panel of document.querySelectorAll("#appTab > *")) {
            if (panel.id != document.getElementById("appTab").children[0].id) {
                panel.style.display = "none";
                panel.style.opacity = "0";
                openPanel = document.getElementById("appTab").children[0].id;
            }
        }

        for (const element of document.querySelectorAll("button[goto], a[goto]")) {
            element.addEventListener("click", async (event) => {
                let panelToSwitch = event.currentTarget.getAttribute("goto");

                if (openPanel != panelToSwitch && !event.currentTarget.hasAttribute("disabled") && !event.currentTarget.parentElement.hasAttribute("disabled")) {
                    for (const selectedTab of document.getElementsByClassName("selected"))
                        selectedTab.classList.remove("selected");
                    if (event.currentTarget.classList.contains("sidebarOption"))
                        event.currentTarget.classList.add("selected");

                    document.getElementById(openPanel).style.opacity = "0";
                    await sleep(200);
                    document.getElementById(openPanel).style.display = "none";

                    openPanel = panelToSwitch;

                    document.getElementById(panelToSwitch).style.display = "flex";
                    await sleep(200);
                    document.getElementById(panelToSwitch).removeAttribute("style");
                }
            });
        }

        document.getElementById("settingsVersion").innerText = utils.getPackageData().version;

        setTimeout(async () => {
            if (utils.getPackageData().version != (await utils.getSetting("lastRunVersion"))) {
                utils.showPopUp("changelogPopup", "New in " + utils.getPackageData().version, null, await utils.getChanges());
                utils.setSetting("lastRunVersion", utils.getPackageData().version);
            }
        }, 500);
    }());

    utils.reloadLibrary();

    //#endregion

    //#region FRAME BAR

    document.querySelector("#frameBar > div:first-child > img").addEventListener("click", () => {
        hueRotate++;
        clearTimeout(hueRotateTimeOut);
        hueRotateTimeOut = setTimeout(() => hueRotate = 0, 400);
        if (hueRotate == 5) {
            hueRotate = 0;
            if (!document.body.hasAttribute("style"))
                document.body.style.animation = "hueRotate 5s infinite linear";
            else
                document.body.removeAttribute("style");
        }
    });

    document.getElementById("closeCircle").addEventListener("click", () => utils.closeWindow());

    document.getElementById("minimizeCircle").addEventListener("click", () => utils.minimizeWindow());

    //#endregion

    //#region ITEM PANEL

    document.getElementById("itemMore").addEventListener("click", async () => {
        if (document.getElementById("contextMenu").style.length == 0) {
            document.getElementById("contextMenu").style.maxWidth = "200px";
            document.getElementById("contextMenu").style.maxHeight = "165px";
            document.getElementById("contextMenu").style.padding = "5px";
            await sleep(300);
            for (let child of document.getElementById("contextMenu").children) {
                if (!document.getElementById("contextMenu").hasAttribute("unrestorable") || child.id != "contextBackup" && child.id != "contextRestore")
                    child.style.display = "flex";
            }
            await sleep(50);
            for (let child of document.getElementById("contextMenu").children) {
                if (!document.getElementById("contextMenu").hasAttribute("unrestorable") || child.id != "contextBackup" && child.id != "contextRestore")
                    child.style.opacity = "1";
            }
                
            document.body.addEventListener("click", closeContextMenu);
        }
    });

    async function closeContextMenu() {
        for (let child of document.getElementById("contextMenu").children) {
            if (!document.getElementById("contextMenu").hasAttribute("unrestorable") || child.id != "contextBackup" && child.id != "contextRestore")
                child.style.opacity = "0";
        }
        await sleep(100);
        for (let child of document.getElementById("contextMenu").children) {
            if (!document.getElementById("contextMenu").hasAttribute("unrestorable") || child.id != "contextBackup" && child.id != "contextRestore")
                child.removeAttribute("style");
        }
        document.getElementById("contextMenu").removeAttribute("style");
        document.body.removeEventListener("click", closeContextMenu);
    }

    document.getElementById("contextBackup").addEventListener("click", async () => {
        let pData = utils.getProductDataById(document.getElementById("goToItem").innerText);
        let backupLocation = await utils.showSaveDialog("Save this Backup", `${pData.name.replace(/ /g, "-")}-Backup-${(new Date()).toLocaleDateString().replace(/\//g, ".")}-${(new Date()).toLocaleTimeString().replace(/:/g, ".")}`, [{ name: "Backup Files (.zip)", extensions: ["zip"] }]);
        if (!backupLocation.canceled)
            utils.backupProduct(backupLocation.filePath);
    });

    document.getElementById("contextRestore").addEventListener("click", async () => {
        let restoreLocation = await utils.showOpenDialog("Select the Backup", [{ name: "Backup Files (.zip)", extensions: ["zip"] }], ["openFile"]);
        if (!restoreLocation.canceled)
            utils.restoreProduct(restoreLocation.filePaths[0]);
    });

    document.getElementById("contextDisable").addEventListener("click", () => {
        utils.disableEnableProduct(document.querySelector("#contextDisable > span").innerText == "Disable Mod");
    });

    document.getElementById("contextUninstall").addEventListener("click", utils.uninstallProduct);

    document.getElementById("itemChangelog").addEventListener("click", () => utils.showPopUp("changelogPopup", "Changelog", null, utils.getProductDataById(document.getElementById("goToItem").innerText).changelog));

    document.getElementById("itemSupport").addEventListener("click", () => shell.openExternal(utils.getProductDataById(document.getElementById("goToItem").innerText).support));

    document.getElementById("itemButton").addEventListener("click", async () => {
        if (document.getElementById("itemButton").innerText == "Install")
            utils.installProduct(false);
        else if (document.getElementById("itemButton").innerText == "Update")
            utils.installProduct(true);
        else if (document.getElementById("itemButton").innerText == "Play" || document.getElementById("itemButton").innerText == "Play Disabled") {
            document.getElementById("itemButton").disabled = true;
            utils.playProduct(document.getElementById("itemButton").innerText == "Play Disabled");
            await sleep(3000);
            document.getElementById("itemButton").disabled = false;
        }
    });

    document.getElementById("goToItem").addEventListener("click", async () => {
        let pData = utils.getProductDataById(document.getElementById("goToItem").innerText);
        
        document.querySelector("#itemHeader > h1").innerText = pData.name;
        document.getElementById("itemDescription").innerText = pData.description;
        document.querySelector("#itemVersion > span").innerText = pData.version;
        document.querySelector("#itemSize > span").innerText = pData.size;
        document.querySelector("#itemRelease > span").innerText = pData.release;

        if (pData.support != null)
            document.getElementById("itemSupport").removeAttribute("style");
        else
            document.getElementById("itemSupport").style.display = "none";

        if (!(await utils.isInstalled(pData.id))) {
            document.getElementById("itemButton").innerText = "Install";
            document.getElementById("itemMore").style.display = "none";
        }
        else {
            if (!(await utils.getSetting("installed"))[pData.id].disabled) {
                document.getElementById("itemButton").innerText = "Play";
                document.querySelector("#contextDisable > icon").setAttribute("name", "pause");
                document.querySelector("#contextDisable > span").innerText = "Disable Mod";
            }
            else {
                document.getElementById("itemButton").innerText = "Play Disabled";
                document.querySelector("#contextDisable > icon").setAttribute("name", "play");
                document.querySelector("#contextDisable > span").innerText = "Enable Mod";
            }

            if ((await utils.getSetting("installed"))[pData.id].version != pData.version)
                document.getElementById("itemButton").innerText = "Update";
            
            document.getElementById("itemMore").removeAttribute("style");
            if (pData.backup == null)
                document.getElementById("contextMenu").setAttribute("unrestorable", "");
            else
                document.getElementById("contextMenu").removeAttribute("unrestorable");
            utils.reloadIcons();
        }
        
        document.getElementById("itemButton").setAttribute("pid", pData.id);
        document.querySelector("#itemBanner > img").src = pData.banner;
    });

    //#endregion

    //#region SETTINGS PANEL

    document.getElementById("settingsAppearance").addEventListener("change", () => {
        if (Boolean(Number(document.getElementById("settingsAppearance").value)))
            document.body.setAttribute("theme", "dark");
        else
            document.body.setAttribute("theme", "light");
        utils.setSetting("settings.darkMode", Boolean(Number(document.getElementById("settingsAppearance").value)));
    });

    document.getElementById("settingsVersion").addEventListener("click", () => {
        upSideDown++;
        clearTimeout(upSideDownTimeOut);
        upSideDownTimeOut = setTimeout(() => upSideDown = 0, 400);
        if (upSideDown == 5) {
            upSideDown = 0;
            if (!document.body.hasAttribute("style"))
                document.body.style.transform = "rotateZ(180deg)";
            else
                document.body.removeAttribute("style");
        }
    });
    
    //#endregion
});