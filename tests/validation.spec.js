/* eslint-disable import/extensions */
var path = require('path');
var child = require('child_process');
var validateCss = require('../index.js');

describe('w3c-validate-css: module validation (async)', function () {
    var cssDir = path.join(__dirname, 'css');
    var skipAll = false;

    function hasJavaSync() {
        try {
            var out = child.spawnSync('java', ['-version'], { encoding: 'utf8' });
            return !!(out.stdout || out.stderr);
        } catch (e) {
            return false;
        }
    }

    function file(name) {
        return path.join(cssDir, name);
    }

    function findResult(summary, filePath) {
        var i;
        for (i = 0; i < summary.results.length; i++) {
            if (summary.results[i].file === filePath) {
                return summary.results[i];
            }
        }
        return null;
    }

    beforeAll(function () {
        if (!hasJavaSync()) {
            skipAll = true;
        }
    });

    it('should detect parse errors in incomplete declarations', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('parse-error.css');
        var summary = await validateCss(f, { json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
    });

    it('should detect parse errors for bare identifiers', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('bare-identifier.css');
        var summary = await validateCss(f, { json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid property values', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('invalid-value.css');
        var summary = await validateCss(f, { json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
    });

    it('should detect unknown properties as errors', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('unknown-prop.css');
        var summary = await validateCss(f, { json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
    });

    it('should report vendor extensions as warnings (and fail when warnings enabled)', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('vendor-warning.css');
        var summary = await validateCss(f, { warningLevel: 2, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false); // warnings present => fail
        expect(res.errors.length).toBe(0);
        expect(res.warnings.length).toBeGreaterThan(0);
    });

    it('should include deprecation warnings when enabled (and fail when warnings enabled)', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('deprecation.css');
        var summary = await validateCss(f, { warningLevel: 2, showDeprecations: true, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false); // warnings present => fail
        expect(res.errors.length).toBe(0);
        expect(res.warnings.length).toBeGreaterThan(0);
    });

    it('should suppress warnings when warningLevel=0', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('vendor-warning.css');
        var summary = await validateCss(f, { warningLevel: 0, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(true);
        expect(res.errors.length).toBe(0);
        expect(res.warnings.length).toBe(0);
    });

    it('should ignore warnings for pass/fail when errorsOnly=true', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('vendor-warning.css');
        var summary = await validateCss(f, { warningLevel: 2, errorsOnly: true, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(true);   // pass because no errors
        expect(res.errors.length).toBe(0);
        expect(res.warnings.length).toBe(0);
    });

    it('should capture both errors and warnings in a mixed file', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('mixed.css');
        var summary = await validateCss(f, { warningLevel: 2, showDeprecations: true, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
        expect(res.warnings.length).toBeGreaterThan(0);
    });

    it('should pass on valid css', async function () {
        if (skipAll) { pending('java not found, skipping'); return; }

        var f = file('valid.css');
        var summary = await validateCss(f, { warningLevel: 2, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(true);
        expect(res.errors.length).toBe(0);
        expect(res.warnings.length).toBe(0);
    });
});