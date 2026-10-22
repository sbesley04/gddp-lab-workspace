# Code signing and notarisation

Credentials never go in the repository. electron-builder reads them from environment variables or the OS keychain at build time.

## macOS (Developer ID + notarisation)

1. Enrol in the Apple Developer Program. In Keychain Access, create or import a **Developer ID Application** certificate.
2. Create an app-specific password for your Apple ID, or an App Store Connect API key.
3. Build:

   ```bash
   export APPLE_ID="you@institution.edu"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="ABCDE12345"
   npx electron-vite build && npx electron-builder --mac --arm64 --x64 -c.mac.notarize=true
   ```

   With an API key, set `APPLE_API_KEY` (the path to the `.p8` file), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` instead.
4. Verify:

   ```bash
   spctl -a -vvv "release/mac-arm64/BARI-CNS Research Workspace.app"
   ```

The hardened runtime is already enabled. `build/entitlements.mac.plist` grants only `com.apple.security.cs.allow-jit`, which V8 needs. Electron fuses (ASAR integrity, no RunAsNode) are applied before signing.

## Windows (Authenticode)

You need an OV or EV code-signing certificate. EV certificates usually sit on a hardware token or a cloud HSM.

- **PFX file:**

  ```bash
  set CSC_LINK=C:\secure\cert.pfx
  set CSC_KEY_PASSWORD=...
  npx electron-builder --win --x64
  ```

- **Azure Trusted Signing or another cloud HSM:** configure `win.azureSignOptions` (or a custom `win.sign` script) in `package.json`, according to the provider's current documentation.

Sign on Windows or in CI. Signing during a macOS cross-build needs extra tooling. Verify with `signtool verify /pa /v "BARI-CNS-Research-Workspace-Setup-0.1.0.exe"`.

## CI

`.github/workflows/build.yml` builds unsigned artefacts and runs `--self-test` on macOS and Windows. To sign in CI, add the variables above as encrypted repository secrets and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the macOS job.
