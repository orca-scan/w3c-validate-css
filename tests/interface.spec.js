var validateCss = require('../index.js');

describe('w3c-validate-css: interface', function () {

    it('should export a function', function () {
        expect(typeof validateCss).toEqual('function');
    });

    it('should accept (target, options)', function () {
        expect(validateCss.length).toBe(2);
    });
});