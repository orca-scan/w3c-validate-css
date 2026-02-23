/* eslint-disable import/extensions */
var path = require('path');
var fs = require('fs');
var child = require('child_process');
var http = require('http');
var validateCss = require('../index.js');

describe('w3c-validate-css: url', function () {

    var cssDir = path.join(__dirname, 'css');
    var server = null;
    var baseUrl = null;

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

    function startServer(done) {
        server = http.createServer(function (req, res) {
            if (req.url === '/' || req.url.indexOf('/?') === 0) {
                res.statusCode = 200;
                res.setHeader('content-type', 'text/html; charset=utf-8');

                /* duplicate link to confirm de duping */
                res.end([
                    '<!doctype html>',
                    '<html>',
                    '<head>',
                    '<link rel="stylesheet" href="/styles/broken.min.css">',
                    '<link rel="stylesheet" href="/styles/broken.min.css">',
                    '</head>',
                    '<body>ok</body>',
                    '</html>'
                ].join(''));
                return;
            }

            if (req.url.indexOf('/styles/broken.min.css') === 0) {
                res.statusCode = 200;
                res.setHeader('content-type', 'text/css; charset=utf-8');

                /* intentionally broken and minified */
                res.end('a{color:}');
                return;
            }

            res.statusCode = 404;
            res.end('not found');
        });

        server.listen(0, '127.0.0.1', function () {
            var addr = server.address();
            baseUrl = 'http://127.0.0.1:' + addr.port + '/';
            done();
        });
    }

    function stopServer(done) {
        if (!server) {
            done();
            return;
        }

        server.close(function () {
            server = null;
            done();
        });
    }

    beforeAll(function (done) {
        if (!hasJavaSync()) {
            pending('java not found, skipping');
            done();
            return;
        }

        startServer(done);
    });

    afterAll(function (done) {
        stopServer(done);
    });

    it('should validate css when target is a page url and de dupe stylesheet links', async function () {
        var summary = await validateCss(baseUrl, { json: true });

        expect(summary.results.length).toBe(1);
        expect(summary.failed).toBe(1);

        expect(summary.results[0].ok).toBe(false);
        expect(summary.results[0].errors.length).toBeGreaterThan(0);
    });

    it('should download url css as unminified text so the validator can report usable line numbers', async function () {
        var summary = await validateCss(baseUrl, { json: true });

        var res = summary.results[0];
        var css = fs.readFileSync(res.file, 'utf8');

        expect(css.indexOf('\n')).toBeGreaterThan(-1);

        if (res.errors && res.errors[0]) {
            expect(res.errors[0].line).toBeGreaterThan(0);
        }
    });

    it('should still validate local file targets', async function () {
        var f = file('valid.css');
        var summary = await validateCss(f, { warningLevel: 2, json: true });
        var res = findResult(summary, f);

        expect(res.ok).toBe(true);
        expect(res.errors.length).toBe(0);
        expect(res.warnings.length).toBe(0);
    });
});