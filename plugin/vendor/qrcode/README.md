# qrcode-generator (vendored)

Single-file QR encoder from [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
v1.4.4 by Kazuhiko Arase, used as `qrcode.cjs` (CommonJS, imported from ESM).

Vendored instead of installed because the plugin runs with **zero runtime
dependencies**: DSH loads it by absolute `file://` URL, where a bare specifier
would not resolve from the plugin directory.

License: MIT (see the copyright header in `qrcode.cjs`). The "QR Code" word mark
is a registered trademark of DENSO WAVE INCORPORATED.

Do not edit the vendored file; re-download the package tarball to update:
`npm pack qrcode-generator@1.4.4`, then copy `package/qrcode.js` over `qrcode.cjs`.
