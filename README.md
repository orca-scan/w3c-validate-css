# w3c-validate-css

[![Tests](https://github.com/orca-scan/w3c-validate-css/actions/workflows/ci.yml/badge.svg)](https://github.com/orca-scan/w3c-validate-css/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/orca-scan/w3c-validate-css)](https://github.com/orca-scan/w3c-validate-css/blob/master/LICENSE)
[![npm](https://img.shields.io/npm/v/w3c-validate-css)](https://www.npmjs.com/package/w3c-validate-css)

A simple CSS validator for Node and the CLI that uses the official W3C validator _(offline)_.

**Why?** modern build tools can introduce CSS bugs that slip into production. w3c-validate-css runs locally with the official W3C validator JAR and prints concise, clickable errors with line numbers using the same rules as the online validator, but entirely offline.

## CLI

The easiest way to use this is from the cli using `npx`, for example:

```bash
# Validate a single file
npx w3c-validate-css --target dist/styles.css

# Validate a folder, fail only on errors, tolerate a property
npx w3c-validate-css --target dist/css --errors-only --tolerate "pointer-events"

# Validate using the SVG profile (recognizes pointer-events)
npx w3c-validate-css --target dist/css --profile svg
```

Output:

```bash
✗ dist/styles.css
  dist/styles.css:14:8 - Parse Error: Declaration dropped
  dist/styles.css:45 - Unknown pseudo-element or pseudo-class :where()
✓ dist/reset.css
```

Exits with code 1 if validation fails.

### options

Flag             | Alias | Value                    | Default | Description
:----------------|:------|:-------------------------|:--------|:--------------------------------------------
`--target`       | `-t`  | `<path>`                 |         | File or folder to validate **(required)**
`--profile`      | `-p`  | `css3\|css21\|css1\|svg` | `css3`  | Validation profile
`--warnings`     | `-w`  | `0\|1\|2`                | `2`     | Warning level: `0` none, `1` normal, `2` all
`--deprecations` | `-d`  |                          | `false` | Include deprecation warnings
`--errors-only`  | `-e`  |                          | `false` | Show only errors; ignore warnings
`--json`         |       |                          | `false` | Output JSON summary
`--tolerate`     |       | `"prop1,prop2"`          | `""`    | Downgrade properties to warnings

## Node module

```bash
npm i w3c-validate-css --save-dev
```

```js
var validateCss = require('w3c-validate-css');

validateCss('dist/', {
  profile: 'css3',
  warningLevel: 2,
  showDeprecations: false,
  errorsOnly: false,
  json: false
})
.then(function (summary) {
  if (summary.failed > 0) process.exitCode = 1;
})
.catch(function (err) {
  console.error('w3c-validate-css error:', err && err.message ? err.message : String(err));
});
```

JSON result:

```json
{
  "passed": 1,
  "failed": 1,
  "results": [
    {
      "file": "dist/styles.css",
      "ok": false,
      "errors": [{ "line": 14, "col": 8, "msg": "Parse Error: Declaration dropped" }],
      "warnings": [{ "line": 45, "col": 0, "msg": "Unknown pseudo-element or pseudo-class :where()" }]
    },
    { "file": "dist/reset.css", "ok": true, "errors": [], "warnings": [] }
  ]
}
```

## GitHub Action

```yaml
name: css-validate
on: [push, pull_request]
jobs:
  css-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npx w3c-validate-css --target dist/ --json > css-report.json
      - uses: actions/upload-artifact@v4
        with:
          name: css-report
          path: css-report.json
```

## License

[MIT License](LICENSE) © Orca Scan - a [barcode app](https://orcascan.com) with simple [barcode tracking APIs](https://orcascan.com/guides?tag=for-developers).