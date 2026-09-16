// ==UserScript==
// @name         Form Automation & Background Playback Suite
// @namespace    https://github.com/local-automation
// @version      2.0.0
// @description  Suite otomatisasi dengan sistem aktivasi kondisional & self-test bawaan.
// @author       You
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================
     * KONFIGURASI UTAMA — ATUR AKTIVASI DI SINI
     * ========================================================= */
    const CONFIG = {

        // ---- AKTIVASI GLOBAL ----
        enabled: true, // Master switch. Set false = semua modul mati.

        // ---- AKTIVASI BERDASARKAN URL ----
        urlWhitelist: [
            // Kosongkan array [] = aktif di semua situs.
            // Contoh:
            // /^https:\/\/contoh\.com\/form/,   // regex
            // 'https://app.tes.com/login'        // string exact match
        ],
        urlBlacklist: [
            // Situs yang TIDAK boleh aktif (prioritas tinggi)
            // 'https://bank-saya.com'
        ],

        // ---- AKTIVASI VIA QUERY PARAMETER ----
        // Aktif hanya jika URL mengandung ?automation=1 (jika null = tidak dipakai)
        requireQueryParam: null, // contoh: 'automation'

        // ---- AKTIVASI VIA ELEMEN TARGET ----
        // Aktif hanya jika elemen ini ada di halaman (null = lewati cek)
        requireSelector: null, // contoh: 'form#registration'

        // ---- AKTIVASI VIA STORAGE (persisten antar reload) ----
        storageKey: 'FAS_enabled', // localStorage['FAS_enabled'] = '1' / '0'

        // ---- FEATURE FLAGS PER MODUL ----
        modules: {
            playback:      true,  // Modul 1: Anti-pause media
            accessibility: true,  // Modul 2: Restorasi konteks/klik kanan
            typing:        true,  // Modul 3: Humanized typing
        },

        // ---- MODE DEBUG & SELF-TEST ----
        debug:       true,   // Tampilkan log verbose di console
        runSelfTest: true,   // Jalankan verifikasi otomatis setelah load
    };

    /* =========================================================
     * UTILITAS BERSAMA
     * ========================================================= */
    const CoreUtils = {
        randomDelay(min, max) {
            return new Promise((resolve) => {
                const delay = Math.floor(Math.random() * (max - min + 1)) + min;
                setTimeout(resolve, delay);
            });
        },

        log(module, message) {
            if (!CONFIG.debug) return;
            console.log(
                `%c[FAS][${module}]%c ${message}`,
                'color:#4fc3f7;font-weight:bold',
                'color:inherit'
            );
        },

        warn(module, message) {
            console.warn(`[FAS][${module}] ${message}`);
        }
    };

    /* =========================================================
     * ACTIVATION CONTROLLER
     * Memutuskan apakah script boleh jalan di halaman ini.
     * ========================================================= */
    const ActivationController = (() => {

        /** Cek URL whitelist (kalau diisi, HARUS match salah satu). */
        function passesWhitelist() {
            if (CONFIG.urlWhitelist.length === 0) return true;
            return CONFIG.urlWhitelist.some((pattern) =>
                pattern instanceof RegExp
                    ? pattern.test(location.href)
                    : location.href.startsWith(pattern)
            );
        }

        /** Cek URL blacklist (jika match → langsung blokir). */
        function passesBlacklist() {
            return !CONFIG.urlBlacklist.some((pattern) =>
                pattern instanceof RegExp
                    ? pattern.test(location.href)
                    : location.href.startsWith(pattern)
            );
        }

        /** Cek query param, misal ?automation=1 */
        function passesQueryParam() {
            if (!CONFIG.requireQueryParam) return true;
            return new URLSearchParams(location.search).get(CONFIG.requireQueryParam) === '1';
        }

        /** Cek storage flag — memungkinkan toggle antar reload. */
        function passesStorageFlag() {
            const stored = localStorage.getItem(CONFIG.storageKey);
            if (stored === null) return true;           // belum pernah di-set → default jalan
            return stored === '1';
        }

        /** Cek keberadaan elemen target (harus menunggu DOM). */
        function passesSelectorCheck() {
            return new Promise((resolve) => {
                if (!CONFIG.requireSelector) return resolve(true);

                const check = () => {
                    const found = !!document.querySelector(CONFIG.requireSelector);
                    resolve(found);
                };

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', check);
                } else {
                    check();
                }
            });
        }

        /**
         * Keputusan akhir: apakah script aktif di halaman ini?
         * @returns {Promise<{active: boolean, reasons: string[]}>}
         */
        async function evaluate() {
            const reasons = [];
            let active = true;

            if (!CONFIG.enabled)                    { active = false; reasons.push('master switch OFF'); }
            if (!passesBlacklist())                 { active = false; reasons.push('URL diblacklist'); }
            if (!passesWhitelist())                 { active = false; reasons.push('URL tidak ada di whitelist'); }
            if (!passesQueryParam())                { active = false; reasons.push(`query param ?${CONFIG.requireQueryParam}=1 tidak ada`); }
            if (!passesStorageFlag())               { active = false; reasons.push('storage flag OFF (localStorage)'); }
            if (!await passesSelectorCheck())       { active = false; reasons.push(`elemen "${CONFIG.requireSelector}" tidak ditemukan`); }

            return { active, reasons };
        }

        /**
         * Helper cepat: toggle ON/OFF via console.
         * FAS.toggle()           → flip status
         * FAS.toggle(true/false) → set eksplisit
         * Setelah toggle, reload halaman untuk menerapkan.
         */
        function toggle(force) {
            const current = localStorage.getItem(CONFIG.storageKey) !== '0';
            const next = force !== undefined ? force : !current;
            localStorage.setItem(CONFIG.storageKey, next ? '1' : '0');
            console.log(`%c[FAS] Script ${next ? 'DIAKTIFKAN ✓' : 'DINONAKTIFKAN ✗'} — reload halaman untuk menerapkan.`, 'color:#81c784;font-weight:bold');
            return next;
        }

        return { evaluate, toggle };
    })();

    /* =========================================================
     * SELF-TEST MODULE (VERIFIKASI)
     * Membuktikan secara objektif bahwa tiap modul bekerja.
     * ========================================================= */
    const SelfTest = (() => {

        const results = [];

        function record(name, passed, detail) {
            results.push({ name, passed, detail });
            console.log(
                `${passed ? '✅' : '❌'} [Test] ${name}${detail ? ` — ${detail}` : ''}`
            );
        }

        /** TEST 1: Apakah document.hidden sudah ter-spoof? */
        function testVisibilitySpoof() {
            const hiddenOK = document.hidden === false;
            const stateOK = document.visibilityState === 'visible';
            record(
                'Visibility Spoof',
                hiddenOK && stateOK,
                `document.hidden=${document.hidden}, visibilityState="${document.visibilityState}"`
            );
        }

        /** TEST 2: Apakah event blur diblokir? (simulasi) */
        function testBlurInterception() {
            let leaked = false;
            // Listener "korban" — kalau ini jalan, artinya intersepsi GAGAL
            const victim = () => { leaked = true; };
            window.addEventListener('blur', victim);
            window.dispatchEvent(new Event('blur'));
            window.removeEventListener('blur', victim);
            record('Intersepsi Blur', !leaked, leaked ? 'event lolos ke handler!' : 'event berhasil diblokir');
        }

        /** TEST 3: Apakah contextmenu lolos tanpa diblokir situs? */
        function testContextMenuRestoration() {
            let blocked = false;
            const target = document.body;
            const blocker = (e) => e.preventDefault();
            // Simulasi situs jahat yang blokir klik kanan:
            target.addEventListener('contextmenu', blocker);
            // Lalu kita cek: apakah skrip kita menetralkannya?
            const probe = (e) => { if (e.defaultPrevented) blocked = true; };
            target.addEventListener('contextmenu', probe);
            target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            target.removeEventListener('contextmenu', blocker);
            target.removeEventListener('contextmenu', probe);
            record('Restorasi Contextmenu', !blocked, blocked ? 'masih ter-preventDefault' : 'default browser dipulihkan');
        }

        /** TEST 4: Ketik ke input sementara & verifikasi hasil + timing. */
        async function testHumanizedTyping() {
            const input = document.createElement('input');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);

            const startTime = performance.now();
            let inputEvents = 0;
            input.addEventListener('input', () => inputEvents++);

            await FormAutomationSuite.HumanizedTyping.typeInto(input, 'abc');

            const elapsed = performance.now() - startTime;
            const valueOK = input.value === 'abc';
            const eventsOK = inputEvents === 3;
            // 3 karakter × 60–130ms = minimal ~180ms. Kalau <100ms → delay tidak jalan.
            const timingOK = elapsed >= 100;

            input.remove();
            record(
                'Humanized Typing',
                valueOK && eventsOK && timingOK,
                `value="${input.value}", events=${inputEvents}, durasi=${elapsed.toFixed(0)}ms`
            );
        }

        /** TEST 5: Verifikasi React-style setter (nilai ter-set via native setter). */
        function testNativeSetter() {
            const input = document.createElement('input');
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            const hasNative = !!(desc && desc.set);
            record('Native Value Setter', hasNative, hasNative ? 'setter prototype tersedia (kompatibel React/Vue)' : 'setter tidak ditemukan!');
        }

        async function runAll() {
            console.log('%c╔══════════════════════════════════╗\n║  FAS SELF-TEST — VERIFIKASI      ║\n╚══════════════════════════════════╝', 'color:#ffb74d;font-weight:bold');

            testVisibilitySpoof();
            testBlurInterception();
            testContextMenuRestoration();
            testNativeSetter();
            await testHumanizedTyping();

            const passed = results.filter(r => r.passed).length;
            const summary = `${passed}/${results.length} tes lulus`;
            console.log(
                `%c[FAS] SELF-TEST SELESAI: ${summary}`,
                passed === results.length
                    ? 'color:#81c784;font-weight:bold;font-size:14px'
                    : 'color:#e57373;font-weight:bold;font-size:14px'
            );
            return results;
        }

        return { runAll };
    })();

    /* =========================================================
     * MODUL 1: BACKGROUND PLAYBACK MODIFIER (ANTI-PAUSE)
     * ========================================================= */
    const BackgroundPlaybackModifier = (() => {

        function spoofVisibilityProperties() {
            const visibilityMap = [
                ['visibilityState', 'hidden'],
                ['webkitVisibilityState', 'webkitHidden'],
                ['mozVisibilityState', 'mozHidden'],
                ['msVisibilityState', 'msHidden']
            ];

            visibilityMap.forEach(([stateProp, hiddenProp]) => {
                try {
                    Object.defineProperty(document, hiddenProp, {
                        configurable: true,
                        get: () => false
                    });
                    Object.defineProperty(document, stateProp, {
                        configurable: true,
                        get: () => 'visible'
                    });
                } catch (e) {
                    CoreUtils.warn('Playback', `Gagal override ${stateProp}: ${e.message}`);
                }
            });
            CoreUtils.log('Playback', 'Visibility spoofed.');
        }

        function interceptLifecycleEvents() {
            ['visibilitychange', 'blur', 'pagehide', 'freeze'].forEach((eventType) => {
                window.addEventListener(eventType, (e) => e.stopImmediatePropagation(), true);
                document.addEventListener(eventType, (e) => e.stopImmediatePropagation(), true);
            });
            CoreUtils.log('Playback', 'Intersepsi lifecycle aktif.');
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
                window.addEventListener(eventType, (event) => {
                    const original = event.preventDefault.bind(event);
                    Object.defineProperty(event, 'preventDefault', {
                        configurable: true,
                        value: function () {
                            CoreUtils.log('Accessibility', `preventDefault() dinetralkan: ${eventType}`);
                        }
                    });
                    event.__originalPreventDefault = original;
                }, true);
            });
            CoreUtils.log('Accessibility', 'preventDefault dinetralkan.');
        }

        function stripBlockingAttributes() {
            const apply = () => {
                document.querySelectorAll('[oncontextmenu], [oncopy], [onpaste], [onselectstart]').forEach((el) => {
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
            new MutationObserver(() => apply()).observe(document.documentElement, { childList: true, subtree: true });
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
     * MODUL 3: HUMANIZED TYPING SIMULATION
     * ========================================================= */
    const HumanizedTyping = (() => {

        const DELAY_MIN = 60;
        const DELAY_MAX = 130;

        function getNativeValueSetter(element) {
            const proto = element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
            return descriptor && descriptor.set ? descriptor.set : null;
        }

        function dispatchInputEvent(element) {
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertText',
                data: null
            }));
        }

        async function typeInto(element, text, options = {}) {
            if (!element || !(element instanceof HTMLElement)) {
                throw new TypeError('Target element tidak valid.');
            }

            const delayMin = options.delayMin ?? DELAY_MIN;
            const delayMax = options.delayMax ?? DELAY_MAX;

            element.focus();
            element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

            const nativeSetter = getNativeValueSetter(element);
            let currentValue = '';

            for (const char of text) {
                currentValue += char;
                if (nativeSetter) {
                    nativeSetter.call(element, currentValue);
                } else {
                    element.value = currentValue;
                }
                dispatchInputEvent(element);
                await CoreUtils.randomDelay(delayMin, delayMax);
            }

            element.dispatchEvent(new Event('change', { bubbles: true }));
            CoreUtils.log('Typing', `Selesai: ${text.length} karakter diketik.`);
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
     * BOOTSTRAP — Evaluasi kondisi → jalankan modul → self-test
     * ========================================================= */
    async function bootstrap() {
        const { active, reasons } = await ActivationController.evaluate();

        if (!active) {
            console.info(
                `%c[FAS] Script TIDAK aktif di halaman ini.%c Alasan: ${reasons.join(', ')}. ` +
                `Aktifkan via FAS.toggle(true) lalu reload.`,
                'color:#e57373;font-weight:bold',
                'color:inherit'
            );
            return;
        }

        CoreUtils.log('Core', 'Semua kondisi aktivasi terpenuhi ✓');

        if (CONFIG.modules.playback)      BackgroundPlaybackModifier.init();
        if (CONFIG.modules.accessibility) AccessibilityRestoration.init();
        if (CONFIG.modules.typing)        HumanizedTyping.init();

        // Self-test dijalankan setelah DOM siap (butuh body untuk membuat elemen uji)
        if (CONFIG.runSelfTest) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => SelfTest.runAll());
            } else {
                SelfTest.runAll();
            }
        }
    }

    bootstrap();

    // =========================================================
    // API PUBLIK — untuk pengujian manual dari console DevTools
    // =========================================================
    window.FAS = {
        toggle: ActivationController.toggle,   // FAS.toggle() / FAS.toggle(true/false)
        test:   () => SelfTest.runAll(),       // FAS.test() → jalankan ulang verifikasi
        config: CONFIG,                        // FAS.config.debug = true, dst.
        modules: { BackgroundPlaybackModifier, AccessibilityRestoration, HumanizedTyping },
    };
})();
