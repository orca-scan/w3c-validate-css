#!/usr/bin/env node
'use strict';

var fs = require('fs');
var fsp = fs.promises;
var path = require('path');
var url = require('url');
var os = require('os');
var fetch = require('node-fetch');
var child = require('child_process');
var chalk = require('chalk');
var glob = require('glob');
var minimist = require('minimist');

/* single, deterministic cache path in os temp */
var CACHE_DIR = path.join(os.tmpdir(), 'w3c-validate-css');
var CACHED_JAR = path.join(CACHE_DIR, 'css-validator.jar');
var CURRENT_JAR_PATH = null;

var JAR_URLS = [
    'https://github.com/w3c/css-validator/releases/latest/download/css-validator.jar',
    'https://jigsaw.w3.org/css-validator/DOWNLOAD/css-validator.jar'
];

/**
 * Ensure Java exists
 * @returns {Promise<boolean>} - resolves true if java is available
 */
async function hasJava() {
    return new Promise(function (resolve) {
        var p = child.spawn('java', ['-version']);
        var sawOutput = false;

        p.on('error', function () { resolve(false); });
        p.stderr.on('data', function () { sawOutput = true; });
        p.on('close', function (code) { resolve(code === 0 || sawOutput); });
    });
}

/**
 * Ensure a directory exists
 * @param {string} dir - directory path
 * @returns {void} - creates directory if missing
 */
function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) { /* ignore */ }
}

/**
 * Quick JAR sanity
 * @param {string} file - path to jar file
 * @returns {Promise<boolean>} - resolves true if file starts with pk zip header
 */
async function isJar(file) {
    try {
        var fd = await fsp.open(file, 'r');
        var buf = Buffer.alloc(2);
        await fd.read(buf, 0, 2, 0);
        await fd.close();
        return buf[0] === 0x50 && buf[1] === 0x4B; // 'PK'
    } catch (e) {
        return false;
    }
}

/**
 * Download file with redirects
 * @param {string} href - url to download
 * @param {string} dest - destination file path
 * @returns {Promise<void>} - resolves when file saved to disk
 */
async function download(href, dest) {
    var res = await fetch(href, { headers: { 'User-Agent': 'curl/8 (+node)' }, redirect: 'follow' });

    if (!res.ok) {
        throw new Error('download failed ' + res.status);
    }

    var tmp = dest + '.part';

    await new Promise(function (resolve, reject) {
        var out = fs.createWriteStream(tmp);
        res.body.pipe(out);
        res.body.on('error', reject);
        out.on('finish', resolve);
    });

    fs.renameSync(tmp, dest);
}

/**
 * Resolve or download validator JAR into os temp
 * @returns {Promise<string>} - returns absolute path to usable jar
 */
async function resolveJarPath() {
    if (fs.existsSync(CACHED_JAR) && await isJar(CACHED_JAR)) {
        return CACHED_JAR;
    }

    ensureDir(CACHE_DIR);
    try { fs.unlinkSync(CACHED_JAR); } catch (e) { }

    for (var i = 0; i < JAR_URLS.length; i++) {
        try {
            await download(JAR_URLS[i], CACHED_JAR);
            if (await isJar(CACHED_JAR)) {
                return CACHED_JAR;
            }
        } catch (e) {
            try { fs.unlinkSync(CACHED_JAR); } catch (e2) { }
        }
    }

    throw new Error('failed to obtain css-validator.jar');
}

/**
 * Expand a path to css files
 * @param {string} target - file or folder to scan
 * @returns {Promise<string[]>} - resolves array of absolute css file paths
 */
async function expandFiles(target) {
    var abs = path.resolve(target);

    var st;
    try {
        st = await fsp.stat(abs);
    } catch (e) {
        var msg = (e && e.code === 'ENOENT') ? ('path not found ' + target) : (e && e.message ? e.message : String(e));
        throw new Error(msg);
    }

    if (st.isFile()) {
        if (!/\.css$/i.test(abs)) {
            throw new Error('not a css file ' + target);
        }
        return [abs];
    }

    return new Promise(function (resolve, reject) {
        glob('**/*.css', { cwd: abs, nodir: true }, function (err, matches) {
            if (err) {
                reject(err);
                return;
            }

            var out = [];
            for (var i = 0; i < matches.length; i++) {
                out.push(path.join(abs, matches[i]));
            }
            resolve(out);
        });
    });
}

/**
 * Build JAR args
 * @param {string} file - absolute file path
 * @param {object} cfg - validator config
 * @returns {string[]} - returns array of args for java spawn
 */
function buildArgs(file, cfg) {
    var fileUri = url.pathToFileURL(file).href;

    var args = [
        '-Djava.net.useSystemProxies=false',
        '-Dhttp.proxyHost=', '-Dhttp.proxyPort=',
        '-Dhttps.proxyHost=', '-Dhttps.proxyPort=',
        '-jar', CURRENT_JAR_PATH,
        '-output', 'json',
        '-warning', String(cfg.warningLevel || 0),
        '-profile', String(cfg.profile || 'css3'),
        '-lang', 'en',
        '-usermedium', 'all',
        fileUri
    ];

    return args;
}

/**
 * Run validator once
 * @param {string} file - css file path
 * @param {object} cfg - validator config
 * @returns {Promise<{stdout:string,stderr:string,code:number}>} - resolves process output
 */
async function runOne(file, cfg) {
    return new Promise(function (resolve) {
        var env = {};
        var k;

        for (k in process.env) {
            if (Object.prototype.hasOwnProperty.call(process.env, k)) {
                env[k] = process.env[k];
            }
        }

        env.http_proxy = '';
        env.https_proxy = '';
        env.no_proxy = '';

        var args = buildArgs(file, cfg);
        var p = child.spawn('java', args, { env: env });

        var out = '';
        var err = '';

        p.stdout.on('data', function (d) { out += String(d || ''); });
        p.stderr.on('data', function (d) { err += String(d || ''); });

        p.on('close', function (code) { resolve({ stdout: out, stderr: err, code: code || 0 }); });
        p.on('error', function () { resolve({ stdout: out, stderr: err, code: 1 }); });
    });
}

/**
 * Normalize a JAR path or file: URL to absolute path
 * @param {string} raw - raw file path or file url from jar
 * @returns {string} - returns absolute normalized path
 */
function normalizeJarPath(raw) {
    var s = String(raw || '');

    if (s.slice(0, 5).toLowerCase() === 'file:') {
        s = s.slice(5);
    }

    try {
        if (s.indexOf('///') === 0 || s.indexOf('//') === 0) {
            return path.resolve(url.fileURLToPath('file:' + s));
        }
    } catch (e) { }

    try {
        s = decodeURI(s);
    } catch (e2) { }

    return path.resolve(s);
}

/**
 * Extract first JSON object from text
 * @param {string} text - raw process output
 * @returns {object|null} - returns parsed json or null
 */
function safeParseFirstJson(text) {
    var s = String(text || '');
    var first = s.indexOf('{');
    var last = s.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
        return null;
    }
    var sub = s.slice(first, last + 1);
    try {
        return JSON.parse(sub);
    } catch (e) {
        return null;
    }
}

/**
 * Clean validator message
 * @param {string} s - raw message
 * @returns {string} - trimmed message without a trailing colon
 */
function cleanMessage(s) {
    var msg = String(s || '').trim();
    if (msg.slice(-1) === ':') {
        msg = msg.slice(0, -1).trim();
    }
    return msg;
}

/**
 * Parse comma/space separated list into array
 * @param {string|Array|undefined} v - raw input
 * @returns {Array<string>} - normalized list
 */
function toList(v) {
    if (!v) { return []; }
    if (Array.isArray(v)) { return v; }
    return String(v).split(/[,\s]+/).filter(Boolean).map(function (s) { return s.toLowerCase(); });
}

/**
 * Try to extract property name from "Property “foo-bar” doesn't exist"
 * @param {string} msg - validator message
 * @returns {string|null} - property name or null
 */
function extractPropFromDoesNotExist(msg) {
    var m = String(msg || '').match(/Property\s+[“"']?([a-z0-9-]+)[”"']?\s+doesn'?t\s+exist/i);
    return m && m[1] ? m[1].toLowerCase() : null;
}

/**
 * Parse JSON output from validator
 * @param {object} json - json object from validator
 * @param {string} file - absolute path of the css file
 * @param {boolean} includeWarnings - include warnings in results
 * @param {boolean} includeDeprecations - include deprecation warnings
 * @param {object} cfg - full validator config (for tolerate list)
 * @returns {{errors:Array, warnings:Array}} - returns parsed issues
 */
function parseIssuesFromJson(json, file, includeWarnings, includeDeprecations, cfg) {
    var errors = [];
    var warnings = [];
    var fileAbs = path.resolve(file);

    var tolerate = (cfg && cfg.tolerate) ? cfg.tolerate : [];

    var root = json && (json.cssvalidation || json.cssValidation || json.validation || json);
    if (!root) {
        return { errors: errors, warnings: warnings };
    }

    var jErrors = root.errors || root.error || [];
    var jWarnings = root.warnings || root.warning || [];

    if (!Array.isArray(jErrors)) { jErrors = []; }
    if (!Array.isArray(jWarnings)) { jWarnings = []; }

    var i, it, msg, line, col, src, type, prop;

    for (i = 0; i < jErrors.length; i++) {
        it = jErrors[i] || {};
        msg = cleanMessage(it.message || it.error || it.msg || '');
        line = parseInt(it.line, 10) || 0;
        col = parseInt(it.col || it.column, 10) || 0;
        src = normalizeJarPath(it.source || it.uri || fileAbs);

        if (src === fileAbs) {
            // downgrade specific "doesn't exist" errors if tolerated
            prop = extractPropFromDoesNotExist(msg);
            if (prop && tolerate.indexOf(prop) !== -1) {
                if (includeWarnings) {
                    warnings.push({ line: line, col: col, msg: msg });
                }
                continue;
            }
            errors.push({ line: line, col: col, msg: msg });
        }
    }

    if (includeWarnings) {
        for (i = 0; i < jWarnings.length; i++) {
            it = jWarnings[i] || {};
            msg = cleanMessage(it.message || it.warning || it.msg || '');
            line = parseInt(it.line, 10) || 0;
            col = parseInt(it.col || it.column, 10) || 0;
            src = normalizeJarPath(it.source || it.uri || fileAbs);
            type = String(it.type || it.category || '').toLowerCase();

            if (!includeDeprecations && type === 'deprecated') {
                continue;
            }

            if (src === fileAbs) {
                warnings.push({ line: line, col: col, msg: msg });
            }
        }
    }

    return { errors: errors, warnings: warnings };
}

/**
 * Parse validator output (JSON only)
 * @param {{stdout:string,stderr:string,code:number}} proc - process output
 * @param {string} file - absolute file path
 * @param {boolean} includeWarnings - include warnings in results
 * @param {boolean} includeDeprecations - include deprecation warnings
 * @param {object} cfg - full validator config
 * @returns {{errors:Array, warnings:Array}} - returns parsed issues
 */
function parseIssues(proc, file, includeWarnings, includeDeprecations, cfg) {
    // the validator sometimes prints to stderr; search both
    var json =
        safeParseFirstJson(proc.stdout) ||
        safeParseFirstJson(proc.stderr) ||
        safeParseFirstJson(String(proc.stdout || '') + String(proc.stderr || ''));
    if (!json) {
        throw new Error('validator did not produce JSON output');
    }
    return parseIssuesFromJson(json, file, includeWarnings, includeDeprecations, cfg);
}

/**
 * Print one file result
 * @param {{file:string,ok:boolean,errors:Array,warnings:Array}} res - file result
 * @param {object} cfg - validator config
 * @param {string} target - original target path (file or folder)
 * @returns {void} - prints to stdout/stderr
 */
function printFileResult(res, cfg, target) {
    var green = chalk.green;
    var red = chalk.red;
    var orange = chalk.hex('#FFA500');
    var dim = chalk.dim;

    var targetAbs = path.resolve(target);
    var headerPath = path.relative(targetAbs, res.file) || path.basename(res.file);
    var clickableRel = path.relative(process.cwd(), res.file) || res.file; // VS Code-friendly

    if (res.ok) {
        console.log(green('  ✔ ' + headerPath));
        return;
    }

    console.log(red('  ✖ ' + headerPath));

    var i, e, w, where;

    for (i = 0; i < res.errors.length; i++) {
        e = res.errors[i];
        where = clickableRel + ':' + (e.line || 0) + (e.col ? ':' + e.col : '');
        console.error(red('      ' + dim(where) + ' - ' + e.msg));
    }

    if (!cfg.errorsOnly && (cfg.warningLevel > 0)) {
        for (i = 0; i < res.warnings.length; i++) {
            w = res.warnings[i];
            where = clickableRel + ':' + (w.line || 0) + (w.col ? ':' + w.col : '');
            console.error(orange('      ' + dim(where) + ' - ' + w.msg));
        }
    }
}

/**
 * Validate entry point
 * @param {string} target - file or folder to validate
 * @param {object} cfg - validator config
 * @returns {Promise<{passed:number,failed:number,results:Array}>} - returns summary and per-file results
 */
async function validate(target, cfg) {
    cfg = cfg || {};

    if (!(await hasJava())) {
        throw new Error('java not found');
    }

    if (!CURRENT_JAR_PATH) {
        CURRENT_JAR_PATH = await resolveJarPath();
    }

    var files = await expandFiles(target);

    // print banner (only if not JSON mode)
    if (!cfg.json) {
        var cyan = chalk.cyan;
        var bold = chalk.bold;
        console.log('');
        console.log(bold(cyan('w3c validating ' + files.length + ' CSS files in ' + target)));
        console.log('');
    }

    var results = [];
    var passed = 0;
    var failed = 0;

    for (var i = 0; i < files.length; i++) {
        var res = await validateFileRaw(files[i], cfg);

        if (!cfg.json) {
            printFileResult(res, cfg, target);
        }

        results.push(res);

        if (res.ok) {
            passed++;
        } else {
            failed++;
        }
    }

    console.log('');

    return { passed: passed, failed: failed, results: results };
}

/**
 * Validate file and produce result object
 * @param {string} file - css file path
 * @param {object} cfg - validator config
 * @returns {Promise<{file:string,ok:boolean,errors:Array,warnings:Array}>} - returns file result
 */
async function validateFileRaw(file, cfg) {
    var proc = await runOne(file, cfg);

    var includeWarnings = !cfg.errorsOnly && (cfg.warningLevel > 0);
    var issues = parseIssues(proc, file, includeWarnings, !!cfg.showDeprecations, cfg);

    var ok = (issues.errors.length === 0 && (!includeWarnings || issues.warnings.length === 0));

    return {
        file: file,
        ok: ok,
        errors: issues.errors,
        warnings: issues.warnings
    };
}

/* cli vs module */
if (require.main === module) {

    var argv = minimist(process.argv.slice(2), {
        string: ['target', 'profile', 'warnings', 'tolerate'],
        boolean: ['deprecations', 'errors-only', 'json'],
        alias: { t: 'target', p: 'profile', w: 'warnings', d: 'deprecations', e: 'errors-only' },
        default: { profile: 'css3', warnings: '2', deprecations: false, 'errors-only': false, json: false, tolerate: '' }
    });

    if (!argv.target) {
        console.error('usage: w3c-validate-css --target <file|folder> [--profile css3] [--warnings 0|1|2] [--deprecations] [--errors-only] [--tolerate "prop,prop2"] [--json]');
        process.exit(1);
    }

    var cfg = {
        profile: argv.profile,
        warningLevel: parseInt(argv.warnings, 10) || 0,
        showDeprecations: argv.deprecations,
        errorsOnly: argv['errors-only'],
        json: !!argv.json,
        tolerate: toList(argv.tolerate)
    };

    validate(argv.target, cfg).then(function (summary) {
        if (argv.json) {
            try { console.log(JSON.stringify(summary)); }
            catch (e) { console.error('{"error":"failed to stringify results"}'); }
        }
        process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch(function (err) {
        console.error(chalk.red('error') + ' ' + (err && err.message ? err.message : String(err)));
        process.exit(1);
    });

}
else {
    module.exports = validate;
}