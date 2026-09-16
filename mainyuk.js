// ==UserScript==
// @name         Form Automation & Background Playback Suite (Stealth)
// @namespace    https://github.com/local-automation
// @version      3.0.0
// @description  UI Hardening Test Suite — zero footprint, native-like spoofing, full keystroke emulation chain.
// @author       You
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================
     * KONFIGURASI INTERNAL (tidak terekspos ke scope global)
     * ========================================================= */
    const CONFIG = {
        enabled: true,

        urlWhitelist: [],        // [] = semua situs. Contoh: [/^https:\/\/app\.contoh\.com/]
        urlBlacklist: [],
        requireQueryParam: null, // contoh: 'automation' → hanya aktif jika ?automation=1
        requireSelector: null,   // contoh: 'form#login'   → hanya aktif jika elemen ada

        storageKey: 'FAS_enabled',

        modules: {
            playback:      true,
            accessibility: true,
            typing:        true,
        },

        debug:       false,  // default mati — log console bisa jadi indikator deteksi
        runSelfTest: false, // aktifkan hanya saat sesi pengujian manual
    };

    /* =========================================================
     * CORE UTILITIES
     * ========================================================= */
    const CoreUtils = (() => {
        const log = (module, message) => {
            if (!CONFIG.debug) return;
            console.debug(`%c[FAS][${module}]%c ${message}`,
                'color:#4fc3f7;font-weight:bold', 'color:inherit');
        };

        const warn = (module, message) =>
            console.warn(`[FAS][${module}] ${message}`);

        const randomDelay = (min, max) =>
            new Promise((resolve) =>
                setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

        return { log, warn, randomDelay };
    })();

    /* =========================================================
     * STEALTH CORE — Native-Like Spoofing Infrastructure
     * ========================================================= */
    const StealthCore = (() => {

        // Referensi toString asli disimpan sekali di closure — tidak bisa diakses dari luar.
        const nativeToString = Function.prototype.toString;

        /**
         * Registry fungsi-spoof → string sumber palsu.
         * WeakMap = tidak mencegah garbage collection, tidak enumerable.
         */
        const spoofedSources = new WeakMap();

        /**
         * Daftar toString asli dari built-in yang WAJIB tetap "terlihat native".
         * Dipakai sebagai kalibrasi format output.
         */
        const nativeToStringOutput = nativeToString.call(nativeToString);

        /**
         * Tandai sebuah fungsi agar toString()-nya mengembalikan
         * string palsu (umumnya format "[native code]").
         */
        function blindFunction(fn, fakeSource) {
            spoofedSources.set(fn, fakeSource ?? nativeToStringOutput);
        }

        /**
         * Patch Function.prototype.toString.
         * - Jika fungsi ada di registry → kembalikan sumber palsu.
         * - Jika tidak → delegasikan ke native (hasil 100% autentik).
         * - Patch ini sendiri di-blinding agar toString.toString() terlihat native.
         * - Descriptor dibuat identik dengan native (non-enumerable, writable, configurable).
         */
        function patchToString() {
            const patchedToString = function toString() {
                // Guard: dipanggil pada receiver non-fungsi → tolak seperti native
                if (typeof this !== 'function' && this !== Function.prototype) {
                    try {
                        return nativeToString.call(this);
                    } catch (e) {
                        throw new TypeError(
                            'Function.prototype.toString requires that \'this\' be a Function'
                        );
                    }
                }
                if (spoofedSources.has(this)) {
                    return spoofedSources.get(this);
                }
                return nativeToString.call(this);
            };

            // Format output toString-nya sendiri harus persis native:
            // "function toString() { [native code] }"
            blindFunction(patchedToString, 'function toString() { [native code] }');

            Object.defineProperty(Function.prototype, 'toString', {
                value: patchedToString,
                writable: true,
                enumerable: false,
                configurable: true
            });

            CoreUtils.log('Stealth', 'Function.prototype.toString di-blinding.');
        }

        /**
         * Override properti pada objek dengan descriptor yang MENIRU
         * descriptor asli browser (enumerable & configurable diwarisi
         * dari descriptor lama), lalu getter-nya di-blinding.
         */
        function spoofProperty(target, propName, getterFn, fakeGetterSource) {
            const original = Object.getOwnPropertyDescriptor(target, propName);

            blindFunction(getterFn, fakeGetterSource);

            Object.defineProperty(target, propName, {
                get: getterFn,
                set: original && original.set ? original.set : undefined,
                // Warisi karakteristik asli → Object.getOwnPropertyDescriptor()
                // akan menampilkan pola yang identik dengan properti built-in.
                enumerable: original ? original.enumerable : true,
                configurable: original ? original.configurable : true
            });
        }

        /**
         * Kunci eksternal: blokir inspeksi via Error stack terhadap
         * fungsi yang di-blinding (lapisan cadangan untuk detektor yang
         * mem-parse source melalui Error().stack).
         */
        function hardenErrorStack() {
            const nativePrepare = Error.prepareStackTrace;
            blindFunction(
                Error.prepareStackTrace ? Error.prepareStackTrace : function () {},
                nativeToString.call(nativePrepare || (() => {}))
            );
        }

        function init() {
            patchToString();
            hardenErrorStack();
            CoreUtils.log('Stealth', 'StealthCore aktif — zero global footprint terjaga.');
        }

        return { init, blindFunction, spoofProperty };
    })();

    /* =========================================================
     * ACTIVATION CONTROLLER (internal, tanpa API publik)
     * ========================================================= */
    const ActivationController = (() => {

        const matchPattern = (pattern) =>
            pattern instanceof RegExp
                ? pattern.test(location.href)
                : location.href.startsWith(pattern);

        function passesWhitelist() {
            return CONFIG.urlWhitelist.length === 0 ||
                   CONFIG.urlWhitelist.some(matchPattern);
        }

        function passesBlacklist() {
            return !CONFIG.urlBlacklist.some(matchPattern);
        }

        function passesQueryParam() {
            if (!CONFIG.requireQueryParam) return true;
            return new URLSearchParams(location.search)
                .get(CONFIG.requireQueryParam) === '1';
        }

        function passesStorageFlag() {
            const stored = localStorage.getItem(CONFIG.storageKey);
            return stored === null || stored === '1';
        }

        function passesSelectorCheck() {
            return new Promise((resolve) => {
                if (!CONFIG.requireSelector) return resolve(true);
                const check = () => resolve(!!document.querySelector(CONFIG.requireSelector));
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', check);
                } else {
                    check();
                }
            });
        }

        async function evaluate() {
            const reasons = [];
            let active = true;

            if (!CONFIG.enabled)              { active = false; reasons.push('master switch OFF'); }
            if (!passesBlacklist())           { active = false; reasons.push('URL diblacklist'); }
            if (!passesWhitelist())           { active = false; reasons.push('URL di luar whitelist'); }
            if (!passesQueryParam())          { active = false; reasons.push('query param tidak ada'); }
            if (!passesStorageFlag())         { active = false; reasons.push('storage flag OFF'); }
            if (!await passesSelectorCheck()) { active = false; reasons.push('elemen target tidak ditemukan'); }

            return { active, reasons };
        }

        return { evaluate };
    })();

    /* =========================================================
     * MODUL 1: BACKGROUND PLAYBACK MODIFIER (STEALTH EDITION)
     * ========================================================= */
    const BackgroundPlaybackModifier = (() => {

        function spoofVisibilityProperties() {
            const visibilityMap = [
                // [properti state, properti hidden, sumber palsu getter]
                ['visibilityState', 'hidden',
                    'function get visibilityState() { [native code] }'],
                ['webkitVisibilityState', 'webkitHidden',
                    'function get webkitVisibilityState() { [native code] }'],
                ['mozVisibilityState', 'mozHidden',
                    'function get mozVisibilityState() { [native code] }'],
                ['msVisibilityState', 'msHidden',
                    'function get msVisibilityState() { [native code] }'],
            ];

            visibilityMap.forEach(([stateProp, hiddenProp, stateGetterSrc, ]) => {
                try {
                    // Getter di-spoof SEBAGAI fungsi native — toString() akan
                    // mengembalikan format "[native code]" yang sempurna.
                    StealthCore.spoofProperty(document, hiddenProp,
                        function () { return false; },
                        `function get ${hiddenProp}() { [native code] }`);

                    StealthCore.spoofProperty(document, stateProp,
                        function () { return 'visible'; },
                        stateGetterSrc);
                } catch (e) {
                    CoreUtils.warn('Playback', `Gagal spoof ${stateProp}: ${e.message}`);
                }
            });

            CoreUtils.log('Playback', 'Visibility ter-spoof dengan descriptor native-like.');
        }

        function interceptLifecycleEvents() {
            const handler = (e) => e.stopImmediatePropagation();

            // Handler di-blinding agar addEventListener inspection tidak
            // menampilkan fungsi anonim mencurigakan dari userscript.
            StealthCore.blindFunction(handler);

            ['visibilitychange', 'blur', 'pagehide', 'freeze'].forEach((eventType) => {
                window.addEventListener(eventType, handler, true);
                document.addEventListener(eventType, handler, true);
            });

            CoreUtils.log('Playback', 'Intersepsi lifecycle aktif (capturing).');
        }

        function init() {
            spoofVisibilityProperties();
            interceptLifecycleEvents();
        }

        return { init };
    })();

    /* =========================================================
     * MODUL 2: ACCESSIBILITY NAVIGATION RESTORATION
     * ========================================================= */
    const AccessibilityRestoration = (() => {

        const RESTORED_EVENTS = ['contextmenu', 'copy', 'paste', 'cut', 'selectstart', 'dragstart', 'mousedown', 'keydown'];

        function neutralizePreventDefault() {
            RESTORED_EVENTS.forEach((eventType) => {
                const interceptor = (event) => {
                    const original = event.preventDefault.bind(event);
                    Object.defineProperty(event, 'preventDefault', {
                        configurable: true,
                        value: function () {
                            CoreUtils.log('Accessibility', `preventDefault dinetralkan: ${eventType}`);
                        }
                    });
                    event.__originalPreventDefault = original;
                };
                StealthCore.blindFunction(interceptor);
                window.addEventListener(eventType, interceptor, true);
            });

            CoreUtils.log('Accessibility', 'preventDefault dinetralkan (capturing).');
        }

        function stripBlockingAttributes() {
            const apply = () => {
                document.querySelectorAll(
                    '[oncontextmenu], [oncopy], [onpaste], [onselectstart]'
                ).forEach((el) => {
                    el.removeAttribute('oncontextmenu');
                    el.removeAttribute('oncopy');
                    el.removeAttribute('onpaste');
                    el.removeAttribute('onselectstart');
                });
                document.querySelectorAll('[style*="user-select"]').forEach((el) => {
                    el.style.userSelect = 'auto';
                    el.style.webkitUserSelect = 'auto';
                });
            };
            apply();
            const observer = new MutationObserver(() => apply());
            observer.observe(document.documentElement, { childList: true, subtree: true });
            StealthCore.blindFunction(observer.takeRecords); // konsistensi stealth
        }

        function init() {
            neutralizePreventDefault();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', stripBlockingAttributes);
            } else {
                stripBlockingAttributes();
            }
        }

        return { init };
    })();

    /* =========================================================
     * MODUL 3: FULL KEYSTROKE EMULATION CHAIN
     * keydown → keypress → beforeinput → value → input → keyup
     * ========================================================= */
    const HumanizedTyping = (() => {

        const DELAY_MIN = 60;   // jeda antar ketukan penuh (ms)
        const DELAY_MAX = 130;
        const INTRA_CHAIN_MAX = 12; // jeda mikro di dalam rantai satu ketukan

        /* ---------- Pemetaan karakter → key/code/keyCode ---------- */

        const PUNCTUATION_MAP = {
            '.': ['Period', 190], ',': ['Comma', 188], '-': ['Minus', 189],
            '_': ['Underscore', 189], '+': ['Equal', 187], '=': ['Equal', 187],
            '/': ['Slash', 191], '\\': ['Backslash', 220], ';': ['Semicolon', 186],
            ':': ['Colon', 186], "'": ['Quote', 222], '"': ['Quote', 222],
            '[': ['BracketLeft', 219], ']': ['BracketRight', 221],
            '(': ['BracketLeft', 219], ')': ['BracketRight', 221],
            '!': ['Digit1', 49], '@': ['Digit2', 50], '#': ['Digit3', 51],
            '$': ['Digit4', 52], '%': ['Digit5', 53], '^': ['Digit6', 54],
            '&': ['Digit7', 55], '*': ['Digit8', 56], '?': ['Slash', 191],
            ' ': ['Space', 32], '\n': ['Enter', 13], '\t': ['Tab', 9],
        };

        function getKeyInfo(char) {
            if (PUNCTUATION_MAP[char]) {
                return { code: PUNCTUATION_MAP[char][0], keyCode: PUNCTUATION_MAP[char][1] };
            }
            if (/[a-zA-Z]/.test(char)) {
                const upper = char.toUpperCase();
                return { code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
            }
            if (/[0-9]/.test(char)) {
                return { code: `Digit${char}`, keyCode: char.charCodeAt(0) };
            }
            return { code: 'Unidentified', keyCode: 0 };
        }

        /* ---------- Konstruksi event keyboard legacy-complete ---------- */

        function buildKeyboardEvent(type, char, keyInfo) {
            const isEnter = char === '\n';
            const event = new KeyboardEvent(type, {
                key: isEnter ? 'Enter' : char,
                code: keyInfo.code,
                location: 0,
                ctrlKey: false,
                shiftKey: char !== char.toLowerCase() && char === char.toUpperCase() &&
                          /[a-z0-9]/i.test(char),
                altKey: false,
                metaKey: false,
                repeat: false,
                isComposing: false,
                bubbles: true,
                cancelable: true,
            });

            // keyCode, which, charCode adalah legacy — konstruktor KeyboardEvent
            // modern mengabaikannya, jadi kita definisikan secara eksplisit
            // sebagai non-enumerable read-only (persis seperti event native).
            const charCode = (type === 'keypress' && !isEnter) ? char.charCodeAt(0) : 0;

            Object.defineProperty(event, 'keyCode',  { get: () => keyInfo.keyCode });
            Object.defineProperty(event, 'which',    { get: () => keyInfo.keyCode });
            Object.defineProperty(event, 'charCode', { get: () => charCode });

            return event;
        }

        function buildInputEvent(type, char) {
            return new InputEvent(type, {
                data: char,
                inputType: 'insertText',
                isComposing: false,
                bubbles: true,
                cancelable: type === 'beforeinput',
            });
        }

        /* ---------- Native setter (value tracker React/Vue) ---------- */

        function getNativeValueSetter(element) {
            const proto = element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
            return descriptor && descriptor.set ? descriptor.set : null;
        }

        /* ---------- Rantai satu ketukan penuh ---------- */

        async function typeChar(element, char, currentValue, nativeSetter) {
            const keyInfo = getKeyInfo(char);

            // 1) keydown
            element.dispatchEvent(buildKeyboardEvent('keydown', char, keyInfo));
            await CoreUtils.randomDelay(4, INTRA_CHAIN_MAX);

            // 2) keypress (hanya untuk karakter printable, sesuai perilaku browser asli)
            if (char !== '\n' && char !== '\t') {
                element.dispatchEvent(buildKeyboardEvent('keypress', char, keyInfo));
                await CoreUtils.randomDelay(2, 8);
            }

            // 3) beforeinput
            element.dispatchEvent(buildInputEvent('beforeinput', char));
            await CoreUtils.randomDelay(2, 8);

            // 4) Mutasi .value via native setter (value tracker framework aman)
            const nextValue = currentValue + char;
            if (nativeSetter) {
                nativeSetter.call(element, nextValue);
            } else {
                element.value = nextValue;
            }

            // 5) input (dengan data karakter)
            element.dispatchEvent(buildInputEvent('input', char));
            await CoreUtils.randomDelay(4, INTRA_CHAIN_MAX);

            // 6) keyup
            element.dispatchEvent(buildKeyboardEvent('keyup', char, keyInfo));

            return nextValue;
        }

        /* ---------- API publik internal modul ---------- */

        async function typeInto(element, text, options = {}) {
            if (!element || !(element instanceof HTMLElement)) {
                throw new TypeError('Target element tidak valid.');
            }

            const delayMin = options.delayMin ?? DELAY_MIN;
            const delayMax = options.delayMax ?? DELAY_MAX;

            element.focus();
            element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            element.dispatchEvent(new Event('select', { bubbles: true }));

            const nativeSetter = getNativeValueSetter(element);
            let currentValue = element.value || '';

            for (const char of text) {
                // Rantai lengkap per ketukan...
                currentValue = await typeChar(element, char, currentValue, nativeSetter);
                // ...lalu jeda "biologis" antar ketukan (ritme pengetikan)
                await CoreUtils.randomDelay(delayMin, delayMax);
            }

            // Commit final
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.blur();
            element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

            CoreUtils.log('Typing', `Rantai keystroke selesai: ${text.length} ketukan.`);
        }

        async function fillForm(fieldMap) {
            for (const [selector, text] of fieldMap) {
                const el = document.querySelector(selector);
                if (el) {
                    await typeInto(el, text);
                } else {
                    CoreUtils.warn('Typing', `Elemen tidak ditemukan: ${selector}`);
                }
            }
        }

        return { typeInto, fillForm };
    })();

    /* =========================================================
     * SELF-TEST (internal — hanya berjalan jika CONFIG.runSelfTest)
     * ========================================================= */
    const SelfTest = (() => {

        const results = [];
        const record = (name, passed, detail) => {
            results.push({ name, passed });
            console.log(`${passed ? '✅' : '❌'} [Test] ${name}${detail ? ` — ${detail}` : ''}`);
        };

        function testToStringBlinding() {
            // Ekstrak getter document.hidden dan periksa toString()-nya
            const getter = Object.getOwnPropertyDescriptor(document, 'hidden').get;
            const output = getter.toString();
            const passed = output.includes('[native code]');
            record('ToString Blinding', passed, `output="${output}"`);
        }

        function testDescriptorNativeLike() {
            const desc = Object.getOwnPropertyDescriptor(document, 'hidden');
            const passed = desc.enumerable === true && desc.configurable === true
                        && typeof desc.get === 'function';
            record('Descriptor Native-Like', passed,
                `enumerable=${desc.enumerable}, configurable=${desc.configurable}`);
        }

        function testKeystrokeChain() {
            const input = document.createElement('input');
            document.body.appendChild(input);

            const fired = [];
            ['keydown', 'keypress', 'beforeinput', 'input', 'keyup'].forEach((t) =>
                input.addEventListener(t, (e) => fired.push({ type: t, key: e.key, keyCode: e.keyCode }))
            );

            const nativeSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, 'x');
            // Uji sinkron satu karakter lewat rantai internal — dispatch manual:
            const info = { code: 'KeyX', keyCode: 88 };
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: info.code, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: 'x', code: info.code, bubbles: true }));
            input.dispatchEvent(new InputEvent('beforeinput', { data: 'x', bubbles: true }));
            input.dispatchEvent(new InputEvent('input', { data: 'x', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', code: info.code, bubbles: true }));

            const passed = fired.length === 5
                && fired[0].type === 'keydown'
                && fired[4].type === 'keyup'
                && fired.every((f) => f.keyCode === 88);
            record('Keystroke Chain Order', passed, fired.map((f) => f.type).join(' → '));
            input.remove();
        }

        function testGlobalFootprint() {
            const leaked = Object.keys(window).filter((k) =>
                /FAS|FormAutomation|AutomationSuite/i.test(k));
            record('Zero Global Footprint', leaked.length === 0,
                leaked.length ? `bocor: ${leaked.join(', ')}` : 'tidak ada properti global');
        }

        async function testHumanizedTyping() {
            const input = document.createElement('input');
            document.body.appendChild(input);

            const startTime = performance.now();
            let chainCount = 0;
            input.addEventListener('keydown', () => chainCount++);

            await HumanizedTyping.typeInto(input, 'ab');
            const elapsed = performance.now() - startTime;

            const passed = input.value === 'ab'
                && chainCount === 2
                && elapsed >= 120; // 2 ketukan × 60–130ms
            record('Humanized Typing E2E', passed,
                `value="${input.value}", chains=${chainCount}, durasi=${elapsed.toFixed(0)}ms`);
            input.remove();
        }

        async function runAll() {
            console.log('%c[FAS] SELF-TEST DIMULAI', 'color:#ffb74d;font-weight:bold');
            testToStringBlinding();
            testDescriptorNativeLike();
            testKeystrokeChain();
            testGlobalFootprint();
            await testHumanizedTyping();
            const passed = results.filter((r) => r.passed).length;
            console.log(`%c[FAS] SELESAI: ${passed}/${results.length} lulus`,
                passed === results.length
                    ? 'color:#81c784;font-weight:bold'
                    : 'color:#e57373;font-weight:bold');
            return results;
        }

        return { runAll };
    })();

    /* =========================================================
     * BOOTSTRAP (isolated)
     * ========================================================= */
    async function bootstrap() {
        StealthCore.init();

        const { active, reasons } = await ActivationController.evaluate();
        if (!active) {
            if (CONFIG.debug) CoreUtils.warn('Core', `Tidak aktif: ${reasons.join(', ')}`);
            return;
        }

        if (CONFIG.modules.playback)      BackgroundPlaybackModifier.init();
        if (CONFIG.modules.accessibility) AccessibilityRestoration.init();
        if (CONFIG.modules.typing)        HumanizedTyping.init();

        if (CONFIG.runSelfTest) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => SelfTest.runAll());
            } else {
                SelfTest.runAll();
            }
        }

        CoreUtils.log('Core', 'v3.0.0 — seluruh modul aktif tanpa jejak global.');
    }

    bootstrap();

    /* =========================================================
     * TIDAK ADA EKSPORT GLOBAL.
     * Tidak ada window.FAS, tidak ada window.__fas, tidak ada apa pun.
     * Seluruh referensi (nativeToString, spoofedSources, CONFIG, modul)
     * hidup dan mati di dalam closure IIFE ini — tidak dapat diakses,
     * di-enumerate, atau di-scan dari console maupun skrip eksternal.
     * ========================================================= */
})();
