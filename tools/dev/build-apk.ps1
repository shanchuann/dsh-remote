<#
Build the DSH Remote Android APK locally.

Prerequisites:
  - Node 20+ (this repo was built with Node 24)
  - JDK 17+ (Android Studio JBR 21 works): e.g.
      $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
  - Android SDK with platform-tools/build-tools and platform android-36/37
      $env:ANDROID_HOME = 'D:\Android\Sdk'
  - Gradle dependencies need network. On a machine behind a local proxy, export
    the proxy for Gradle too (this is what unblocks the 171 MB react-android AAR):
      -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890

Usage:
  powershell -ExecutionPolicy Bypass -File tools/dev/build-apk.ps1 [-Abis "x86_64,arm64-v8a"]

Notes:
  - The app talks plain HTTP to the LAN host, so the release manifest must allow
    cleartext. app.json carries the expo-build-properties plugin setting; when
    the android/ folder was generated before that setting, either re-run
    "npx expo prebuild --platform android --clean" or keep the checked-in
    AndroidManifest android:usesCleartextTraffic="true" (already applied here).
#>
param(
  [string]$Abis = "x86_64,arm64-v8a",
  [string]$ProxyHost = "",
  [string]$ProxyPort = "7890"
)

$ErrorActionPreference = 'Stop'
$appDir = Resolve-Path (Join-Path $PSScriptRoot '..\..\app')
Push-Location $appDir
try {
  if (-not $env:JAVA_HOME) {
    $studioJbr = 'C:\Program Files\Android\Android Studio\jbr'
    if (Test-Path $studioJbr) { $env:JAVA_HOME = $studioJbr }
  }
  $env:ANDROID_HOME = $env:ANDROID_HOME ?? 'D:\Android\Sdk'
  $env:ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT ?? $env:ANDROID_HOME

  Write-Host '== expo prebuild (regenerates android/ from app.json)'
  npx expo prebuild --platform android --clean --no-install

  Write-Host '== gradle assembleRelease'
  Push-Location (Join-Path $appDir 'android')
  try {
    $args = @('assembleRelease', '--console=plain', "-PreactNativeArchitectures=$Abis")
    if ($ProxyHost) {
      $args += "-Dhttps.proxyHost=$ProxyHost", "-Dhttps.proxyPort=$ProxyPort",
               "-Dhttp.proxyHost=$ProxyHost", "-Dhttp.proxyPort=$ProxyPort"
    }
    & .\gradlew.bat @args
    if ($LASTEXITCODE -ne 0) { throw "gradle failed with exit code $LASTEXITCODE" }
    Get-ChildItem 'app\build\outputs\apk\release' -Filter '*.apk' | ForEach-Object {
      Write-Host ("APK: " + $_.FullName + " (" + [math]::Round($_.Length / 1MB, 1) + " MB)")
    }
  } finally { Pop-Location }
} finally { Pop-Location }
