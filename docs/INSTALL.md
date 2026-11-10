# Installing the app

Everything here is also on the lab download page and in `HOW-TO-INSTALL.txt` next to the installers.

## 1. Download

Open the **lab download page** on the lab server (ask the lab's data manager for the address). It highlights the right file for the computer you are using. You can also copy the file straight from the lab share in Finder or File Explorer.

| Your computer | File |
| --- | --- |
| Any Mac, Apple Silicon or Intel, macOS 13 Ventura or newer | `BARI-CNS-Research-Workspace-<version>-mac.dmg` |
| Windows 10 or 11, 64-bit | `BARI-CNS-Research-Workspace-<version>-windows-setup.exe` |

Version 0.3.1 still has two Mac files. If you need it: Apple menu → **About This Mac**. "Chip: Apple M…" means **apple-silicon**, "Processor: Intel" means **intel**.

## 2. Install on a Mac

1. Double-click the `.dmg` file. A window opens showing the app and an **Applications** folder.
2. Drag **BARI-CNS Research Workspace** onto **Applications**. Then eject the disk image (the ⏏ button next to it in the Finder sidebar).
3. Open the app from **Applications**. The first time, macOS says it cannot verify the app. This is because the lab does not pay for an Apple signing certificate. Click **Done**.
4. Open **System Settings → Privacy & Security**. Scroll down to the message about the app, click **Open Anyway**, and confirm with your password.

You only do steps 3–4 once for each new version.

## 3. Install on Windows

1. Double-click the `…-windows-setup.exe` file.
2. If a blue **Windows protected your PC** box appears, click **More info**, then **Run anyway**. (The app is not signed with a paid certificate.)
3. Follow the installer. It installs for your user account only, so you do not need administrator rights.
4. Start **BARI-CNS Research Workspace** from the Start menu.

## Updating

Quit the app, then install the new version the same way. On a Mac, choose **Replace** when asked. Your projects are separate folders, so updating never touches them. A project opened in a newer version may no longer open in an older one, so update everyone in a team together.

## Uninstalling

- **Mac:** drag the app from Applications to the Bin.
- **Windows:** Settings → Apps → BARI-CNS Research Workspace → Uninstall.

Your project folders stay where you put them.

## If something goes wrong

**macOS says the app "is damaged and can't be opened."**
This usually means the download did not finish. Delete the `.dmg`, download it again, and check that its size matches the size on the download page. If the message stays, open **Terminal** and run the command below, then open the app again. Only do this for the file from the lab download page.

```bash
xattr -dr com.apple.quarantine "/Applications/BARI-CNS Research Workspace.app"
```

**There is no Open Anyway button.**
Try to open the app once first (step 3), then look in Privacy & Security again within an hour. On macOS 14 Sonoma or older you can instead Control-click the app in Applications and choose **Open**.

**The download stops, or the file is smaller than the page says.**
Download it again while on the lab network (or VPN), or copy it from the lab share.

**Is my file intact?**
Each version folder on the lab server has a `SHA256SUMS.txt`. Compare the long code for your file with the output of:

- Mac (Terminal): `shasum -a 256 ~/Downloads/BARI-CNS-Research-Workspace-*-mac.dmg`
- Windows (PowerShell): `Get-FileHash $HOME\Downloads\BARI-CNS-Research-Workspace-*-windows-setup.exe`

They must match exactly. If not, download again.

**The app does not start, or behaves oddly.**
Run the built-in self-test. It uses invented data in a temporary folder and never touches your projects.

- Mac (Terminal):

  ```bash
  "/Applications/BARI-CNS Research Workspace.app/Contents/MacOS/BARI-CNS Research Workspace" --self-test ~/Desktop
  ```

- Windows (PowerShell):

  ```powershell
  & "$env:LOCALAPPDATA\Programs\BARI-CNS Research Workspace\BARI-CNS Research Workspace.exe" --self-test $HOME\Desktop
  ```

It writes `bari-self-test.json` to your Desktop. `"ok": true` means everything passed. If it says `false`, send that file to the lab's data manager; it contains no study data.

**The app says a project is open in another session.**
Only one copy of the app can open a project at a time. Close the app in the other window or on the other computer. After a crash on your own computer the lock clears by itself. If the folder was copied from another computer and nobody has it open there, delete the hidden `.lock` file inside the project folder (on a Mac, press ⌘ Shift . in Finder to show hidden files). To move a project between computers, use **Backup** and **Restore a backup** rather than copying the folder.

**The app warns that the project folder is on a network or sync folder.**
Move the project to your own disk (for example, Documents), or restore a backup there. Live projects on a NAS or sync folder can be corrupted.

## What gets installed where

| | Mac | Windows |
| --- | --- | --- |
| App | `/Applications/BARI-CNS Research Workspace.app` | `%LOCALAPPDATA%\Programs\BARI-CNS Research Workspace\` |
| Settings (recent projects, author label) | `~/Library/Application Support/BARI-CNS Research Workspace/` | `%APPDATA%\BARI-CNS Research Workspace\` |
| Your projects | Wherever you chose (`<Name>.bariproj` folders) | Same |
