# Hosting on the lab server (NAS)

This guide is for whoever maintains the app. It covers moving this repository from GitHub to the lab NAS, and publishing installers so researchers can download them from the lab server.

## The plan in one picture

```
Lab NAS
├── git/bari-cns-workspace.git     source code (a bare Git repository)    maintainers: read/write
├── software/BARI-CNS/             download folder (index.html + installers) everyone in the lab: read only
│   ├── index.html                   the download page
│   ├── HOW-TO-INSTALL.txt           the same, as plain text
│   ├── 0.3.1/                       one folder per version, never changed once published
│   └── 0.4.0/
└── <study data area>/             project backups (*.bariproj.zip)        only people on the study
```

| What | Where it lives |
| --- | --- |
| Source code | `git/` on the NAS |
| Installers | `software/BARI-CNS/` on the NAS, shared read-only or served as a web page |
| Active projects | Each researcher's own disk. **Never** open a live project from the NAS: the database can be corrupted over a network share, and the app warns about it. |
| Project backups | A NAS folder approved for study data, with access limited to the study team |
| Real workbooks and study notes | Never in the repository (see `.gitignore` and `docs/private/`) |

## Fill these in once

Write the lab's real addresses here, and replace "ask the lab's data manager" in [README.md](../README.md) and [INSTALL.md](INSTALL.md) with the download page address.

| Item | Example | Lab value |
| --- | --- | --- |
| NAS host name | `lab-nas.local` | |
| Git repository | `ssh://maintainer@lab-nas.local/volume1/git/bari-cns-workspace.git` | |
| Download folder, as a share | `smb://lab-nas.local/software/BARI-CNS` (Mac) or `\\lab-nas\software\BARI-CNS` (Windows) | |
| Download page | `http://lab-nas.local/bari-cns/` | |
| Who to ask | the lab's data manager | |

## 1. Move the repository to the NAS

You need Git on the NAS and SSH access to it. Most NAS systems offer Git as a package (for example "Git Server"); turn on SSH in the NAS settings.

1. Create an empty repository on the NAS:

   ```bash
   ssh maintainer@lab-nas.local "git init --bare /volume1/git/bari-cns-workspace.git"
   ```

2. Copy everything from GitHub, with all branches and tags:

   ```bash
   git clone --mirror https://github.com/sbesley04/gddp-lab-workspace.git
   ```

   ```bash
   cd gddp-lab-workspace.git && git push --mirror ssh://maintainer@lab-nas.local/volume1/git/bari-cns-workspace.git
   ```

3. Point existing working copies at the NAS:

   ```bash
   git remote set-url origin ssh://maintainer@lab-nas.local/volume1/git/bari-cns-workspace.git
   ```

   New maintainers clone with `git clone ssh://maintainer@lab-nas.local/volume1/git/bari-cns-workspace.git`, onto a **local** disk.

No SSH? A bare repository on a mounted share also works for one or two maintainers: `git init --bare "/Volumes/git/bari-cns-workspace.git"`, then use that path as the remote. Avoid pushing from two computers at the same moment.

### What does not move with `--mirror`

- **Continuous integration.** `.github/workflows/build.yml` runs only on GitHub. It is the only place the Windows installer is currently tested automatically. Choose one:
  - keep a private GitHub copy just for CI and push to both (`git remote add github https://github.com/sbesley04/gddp-lab-workspace.git`, then `git push github main`); or
  - drop CI and follow the manual checklist in section 2, including the Windows check on a lab PC. The workflow file is harmless on the NAS.
- **Issues, pull requests and release pages.** Save anything you need from them before archiving the GitHub repository.
- **The 0.3.1 installers.** Move them to the download folder with step 4 below.

When the NAS copy is in use, archive the GitHub repository (Settings → Archive) so nobody pushes to the old copy by mistake.

## 2. Publish a new version

Do the building on a Mac, on a local disk (not on the NAS share: building there is slow and can fail). One Mac can build both installers.

1. Set the version and record what changed:

   ```bash
   npm version 0.4.0 --no-git-tag-version
   ```

   Add the version to [STATUS.md](STATUS.md), and write two or three plain sentences for researchers in a text file, for example `notes-0.4.0.txt`.

2. Check the code:

   ```bash
   npm ci && npm run typecheck && npm test
   ```

3. Build the installers into `release/`:

   ```bash
   npm run dist:mac
   ```

   ```bash
   npm run dist:win
   ```

   These make `BARI-CNS-Research-Workspace-0.4.0-mac.dmg` (works on every Mac) and `BARI-CNS-Research-Workspace-0.4.0-windows-setup.exe`.

   If GitHub CI is still in use, you can instead download the **lab-server-folder** artifact from the CI run on `main` (or start one with Actions → build → Run workflow). It already contains steps 3–5 for both platforms, tested. Artifacts are kept for 30 days. If uploads fail with "Artifact storage quota has been hit", delete old artifacts on the Actions page; usage is recounted within 12 hours.

4. Test the files researchers will get. Open the DMG, drag the app to a test folder, and run its self-test:

   ```bash
   "/path/to/BARI-CNS Research Workspace.app/Contents/MacOS/BARI-CNS Research Workspace" --self-test ~/Desktop
   ```

   `~/Desktop/bari-self-test.json` must say `"ok": true`. Install the Windows file on a lab PC and run the same check (the command is in [INSTALL.md](INSTALL.md)). Without CI, this is the only Windows test.

5. Publish to the download folder. Mount the NAS share first (Finder → Go → Connect to Server):

   ```bash
   npm run release:lab -- --out "/Volumes/software/BARI-CNS" --notes notes-0.4.0.txt
   ```

   The script:
   - finds this version's installers in `release/` and stops with a clear message if one is missing or has the wrong version;
   - copies each file under a temporary name, re-reads the copy and checks it against the original before giving it its real name, so a dropped connection never leaves a broken installer on the share;
   - writes `SHA256SUMS.txt` and `release.json`, and rebuilds `index.html` and `HOW-TO-INSTALL.txt` with the newest version first;
   - refuses to overwrite a version that is already published with different files. Give a new build a new version number; use `--replace` only to fix a broken upload.

   Run `node tools/lab-release.mjs --help` for every option. Without `--out`, it writes to `release/lab-server/` so you can look first.

6. Open `index.html` on the share from a researcher's computer and download each file once.

7. Tag the release and tell the lab:

   ```bash
   git tag v0.4.0 && git push origin main v0.4.0
   ```

## 3. Serve the download folder

Pick either or both.

**As a read-only share (simplest).** Share `software/` with read access for the lab and write access for maintainers only. Researchers open `index.html` in Finder or File Explorer, or copy the installer straight off the share. The page has no external links or scripts, so it works without internet.

**As a web page.** Point the NAS's built-in web server (or nginx/Apache on the lab server) at `software/BARI-CNS/`, for example at `http://lab-nas.local/bari-cns/`. Only static files are served; no PHP or database is needed. Check that:

- files of about 250 MB are allowed and are not compressed or rewritten on the way;
- `.dmg` and `.exe` are served as downloads (`application/x-apple-diskimage` and `application/octet-stream` are fine);
- the site is reachable only on the lab network or VPN.

A minimal nginx block:

```nginx
location /bari-cns/ {
    alias /volume1/software/BARI-CNS/;
    autoindex off;
    types { text/html html; text/plain txt; application/json json; application/x-apple-diskimage dmg; application/octet-stream exe; }
    gzip off;
}
```

## 4. Move the existing 0.3.1 installers

Download the four files from the GitHub release `v0.3.1` (both DMGs, the Windows setup and `SHA256SUMS.txt`) into one folder, then:

```bash
node tools/lab-release.mjs --version 0.3.1 --date 2026-10-26 --from ~/Downloads/bari-0.3.1 --out "/Volumes/software/BARI-CNS"
```

The script checks each file against GitHub's `SHA256SUMS.txt` before publishing it. Version 0.3.1 has separate Apple Silicon and Intel Mac files; the page explains how to tell them apart. Later versions have one Mac file.

## 5. Things that still point at GitHub

- `.github/workflows/build.yml` (see section 1).
- [STATUS.md](STATUS.md) cites GitHub Actions run numbers as historical test evidence. Leave them.
- The commands in section 1 and 4 use the GitHub address once, to copy from it.
