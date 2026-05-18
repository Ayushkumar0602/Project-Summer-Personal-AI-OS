(function () {
    const modules = {};
    const cache = {};

    function normalize(id) {
        return id.replace(/^\.\//, '').replace(/\.js$/, '') + '.js';
    }

    function resolve(request, from) {
        if (request.startsWith('.')) {
            const base = from ? from.replace(/[^/]+$/, '') : '';
            const parts = (base + request).split('/');
            const out = [];
            for (const p of parts) {
                if (p === '..') out.pop();
                else if (p !== '.' && p !== '') out.push(p);
            }
            return normalize(out.join('/'));
        }
        return normalize(request);
    }

    window.require = function (request) {
        const from = window.__cjsCurrentModule || null;
        const id = resolve(request, from);
        if (cache[id]) return cache[id];
        if (!modules[id]) throw new Error('Cannot find module "' + request + '" (resolved: ' + id + ')');
        const module = { exports: {} };
        cache[id] = module.exports;
        const prev = window.__cjsCurrentModule;
        window.__cjsCurrentModule = id;
        modules[id](module, module.exports, window.require);
        window.__cjsCurrentModule = prev;
        cache[id] = module.exports;
        return module.exports;
    };

    window.__cjsRegister = function (id, factory) {
        modules[normalize(id)] = factory;
    };
})();

var require = window.require;
var __cjsRegister = window.__cjsRegister;
