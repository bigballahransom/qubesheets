/* Qube Sheets — Lead Submission Plugin
 *
 * Vanilla JS, no framework, no dependencies. Drop this script on a mover's
 * site, point it at one of their existing forms, declare a field mapping,
 * and the plugin will intercept the form's submit event, POST a normalized
 * lead to /api/leads/from-embed/<configId>, and dispatch the configured
 * post-submit action.
 *
 * MAPPING DIRECTION — the most common setup mistake:
 *
 *   mapping key  (left side)  = the id or name= attribute of an input on
 *                               YOUR page's form. It is matched with
 *                               querySelector('#key') first, then
 *                               querySelector('[name="key"]').
 *   rule.target  (right side) = the Qube Sheets field that input fills.
 *                               Valid targets: firstName, lastName, fullName,
 *                               email, phone, phoneType, moveDate, moveSize,
 *                               origin, destination, companyName, notes,
 *                               plus utm_* keys and gclid.
 *
 * If you get it backwards the plugin logs a "mapping looks reversed" error
 * in the console and blocks the submit.
 *
 * UTM / ad tracking: the plugin automatically captures utm_* parameters and
 * gclid from the page URL (persisted for the visit via sessionStorage, so
 * they survive navigation between pages) and attaches them to the lead. You
 * do NOT need hidden fields or mapping entries for them — but explicitly
 * mapped fields and defaultValues always win over auto-captured values.
 *
 * The submit response's `action` field (also passed to onSuccess as
 * `result.action`) is one of:
 *
 *   { kind: 'inline-message',  message }
 *       Show a thank-you message.
 *   { kind: 'redirect-chooser', uploadUrl }
 *       Send the customer to the hosted self-survey chooser
 *       (record video / take photos).
 *   { kind: 'schedule-call', submissionId, schedulerUrl }
 *       Send the customer to the hosted virtual-call scheduler.
 *   { kind: 'self-survey-or-schedule', uploadUrl, submissionId, schedulerUrl }
 *       "Let the customer choose" — uploadUrl hosts the full chooser
 *       (record video / take photos / schedule a call); schedulerUrl
 *       deep-links straight to the scheduler.
 *
 * Custom onSuccess handlers can render their own UI with those URLs
 * (e.g. separate buttons linking to uploadUrl and schedulerUrl). Note the
 * scheduler link expires ~30 minutes after submission; uploadUrl stays
 * valid for 30 days. Without an onSuccess handler the plugin redirects to
 * uploadUrl / schedulerUrl automatically.
 *
 * Usage on the host page (example: a form whose inputs have ids like
 * "your-first-name-input"):
 *
 *   <script>
 *     window.QubeSheets = {
 *       config:        { configId: 'abc123' },
 *       formSelector:  '#quote-form',
 *       mapping: {
 *         // '<id or name= on YOUR form>': { target: '<Qube Sheets field>' }
 *         'your-first-name-input':   { target: 'firstName',   required: true  },
 *         'your-last-name-input':    { target: 'lastName',    required: true  },
 *         'your-email-input':        { target: 'email',       required: true  },
 *         'your-phone-input':        { target: 'phone',       required: true  },
 *         'your-move-date-input':    { target: 'moveDate',    required: false },
 *         'your-origin-input':       { target: 'origin',      required: false },
 *         'your-destination-input':  { target: 'destination', required: false },
 *       },
 *       defaultValues: { },                  // optional
 *       onSuccess: function(result){},       // optional override of default redirect
 *       onError:   function(error){},        // optional error handler
 *     };
 *   </script>
 *   <script src="https://app.qubesheets.com/qs-embed.js"></script>
 */
(function () {
  'use strict';

  var QS_API_BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) {
      try { return new URL(s.src).origin; } catch (e) { /* fall through */ }
    }
    return 'https://app.qubesheets.com';
  })();

  // Payload fields the submission endpoint understands. Anything else
  // (except utm_* / gclid) is silently dropped server-side, so an unknown
  // target is almost always a mapping written in the wrong direction.
  var KNOWN_TARGETS = [
    'firstName', 'lastName', 'fullName', 'email', 'phone', 'phoneType',
    'moveDate', 'moveSize', 'origin', 'destination', 'companyName',
    'notes', 'referrer',
  ];

  // Server caps utm values at 200 chars; anything longer would 400 the
  // whole submission, so truncate client-side.
  var TRACKING_VALUE_MAX = 200;

  function isTrackingTarget(target) {
    return target === 'gclid' || /^utm[A-Z]/.test(target) || target.indexOf('utm_') === 0;
  }

  function getConfig() {
    var qs = window.QubeSheets || {};
    return {
      configId:      (qs.config && qs.config.configId) || qs.configId,
      formSelector:  qs.formSelector,
      mapping:       qs.mapping || {},
      defaultValues: qs.defaultValues || {},
      onSuccess:     typeof qs.onSuccess === 'function' ? qs.onSuccess : null,
      onError:       typeof qs.onError   === 'function' ? qs.onError   : null,
    };
  }

  function safeQuerySelector(root, key) {
    // Try by id first, then by [name] — covers the two common conventions.
    var escape = (window.CSS && CSS.escape) ? CSS.escape : function (v) { return v; };
    var el = root.querySelector('#' + escape(key));
    if (el) return el;
    return root.querySelector('[name="' + key.replace(/"/g, '\\"') + '"]');
  }

  function readValue(el) {
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'radio') {
      var name = el.name;
      var checked = el.form ? el.form.querySelector('input[name="' + name + '"]:checked') : null;
      return checked ? checked.value : undefined;
    }
    return el.value;
  }

  // Capture utm_* and gclid from the page URL, persisted for the visit so
  // the values survive navigation from the landing page to the form page.
  function collectTracking() {
    var fromUrl = {};
    try {
      new URLSearchParams(window.location.search).forEach(function (value, key) {
        if (!value) return;
        var lower = key.toLowerCase();
        if (lower.indexOf('utm_') === 0 || lower === 'gclid') {
          fromUrl[lower] = value.slice(0, TRACKING_VALUE_MAX);
        }
      });
    } catch (e) { /* very old browser — skip auto-capture */ }

    try {
      var stored = JSON.parse(sessionStorage.getItem('qsTracking') || '{}') || {};
      var merged = {};
      Object.keys(stored).forEach(function (k) { merged[k] = stored[k]; });
      Object.keys(fromUrl).forEach(function (k) { merged[k] = fromUrl[k]; });
      if (Object.keys(fromUrl).length) {
        sessionStorage.setItem('qsTracking', JSON.stringify(merged));
      }
      return merged;
    } catch (e) {
      // sessionStorage unavailable (private mode / blocked) — use URL only.
      return fromUrl;
    }
  }

  // One-time sanity check of the mapping against the live form. Warnings
  // only — fields injected later can still resolve at submit time.
  function auditMapping(form, mapping, formSelector) {
    var reversed = [];
    var missing = [];

    Object.keys(mapping).forEach(function (key) {
      var rule = mapping[key] || {};
      var target = rule.target;

      if (target && KNOWN_TARGETS.indexOf(target) === -1 && !isTrackingTarget(target)) {
        console.warn(
          '[QubeSheets] mapping "' + key + '" has unknown target "' + target +
          '" — the server will ignore it. Valid targets: ' + KNOWN_TARGETS.join(', ') +
          ', utm_* keys, and gclid.'
        );
      }

      if (!safeQuerySelector(form, key)) {
        if (target && safeQuerySelector(form, target)) reversed.push(key);
        else missing.push({ key: key, required: !!rule.required });
      }
    });

    if (reversed.length) {
      console.error(
        '[QubeSheets] Your mapping looks REVERSED for: ' + reversed.join(', ') +
        '. The LEFT side of each mapping entry must be the id or name= of an input on YOUR form ' +
        '(e.g. "' + (mapping[reversed[0]] && mapping[reversed[0]].target) + '"), and target must be the Qube Sheets ' +
        'field it fills (' + KNOWN_TARGETS.join(', ') + '). ' +
        'Example fix: \'' + (mapping[reversed[0]] && mapping[reversed[0]].target) + '\': { target: \'firstName\' }.'
      );
    }
    missing.forEach(function (m) {
      console.warn(
        '[QubeSheets] No input with id or name "' + m.key + '" found in ' + formSelector +
        '. That field will be omitted from submissions' +
        (m.required ? ' and, because it is marked required, submits will be BLOCKED until it resolves.' : '.')
      );
    });
  }

  function buildPayload(form, mapping, defaults, tracking) {
    var payload = {};
    var missing = [];

    Object.keys(mapping).forEach(function (key) {
      var rule = mapping[key];
      var el = safeQuerySelector(form, key);
      var value = readValue(el);

      var empty = value === undefined || value === null || value === '' || value === false;
      if (empty) {
        if (rule && rule.required) missing.push(key);
        return;
      }
      payload[rule.target] = value;
    });

    if (missing.length) {
      var err = new Error(
        'Missing required fields: ' + missing.join(', ') +
        ' (each mapping key must match the id or name= of an input inside the form)'
      );
      err.code = 'QS_MISSING_REQUIRED';
      err.missing = missing;
      throw err;
    }

    // Apply defaults only when the field wasn't already populated.
    Object.keys(defaults).forEach(function (target) {
      if (payload[target] === undefined) payload[target] = defaults[target];
    });

    // Auto-captured utm_* / gclid fill any remaining gaps — explicitly
    // mapped fields and defaultValues always win.
    Object.keys(tracking || {}).forEach(function (key) {
      if (payload[key] === undefined) payload[key] = tracking[key];
    });

    return payload;
  }

  function dispatchEvent(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (e) { /* IE — not supported, swallow */ }
  }

  function attach(form, config) {
    if (form.dataset.qsAttached === '1') return;
    form.dataset.qsAttached = '1';

    var tracking = collectTracking();
    auditMapping(form, config.mapping, config.formSelector);

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var submitBtn = form.querySelector('[type="submit"]');

      var payload;
      try {
        payload = buildPayload(form, config.mapping, config.defaultValues, tracking);
      } catch (err) {
        console.error('[QubeSheets]', err.message);
        dispatchEvent('qs:lead-error', { error: err });
        if (config.onError) config.onError(err);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;

      fetch(QS_API_BASE + '/api/leads/from-embed/' + encodeURIComponent(config.configId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
        })
        .then(function (result) {
          if (submitBtn) submitBtn.disabled = false;

          if (!result.ok || !result.data || !result.data.ok) {
            var err = new Error((result.data && result.data.error) || ('Submission failed (' + result.status + ')'));
            console.error('[QubeSheets]', err.message);
            dispatchEvent('qs:lead-error', { error: err, response: result.data });
            if (config.onError) config.onError(err);
            return;
          }

          dispatchEvent('qs:lead-submitted', { response: result.data });

          if (config.onSuccess) {
            config.onSuccess(result.data);
            return;
          }

          var action = result.data.action;
          if (action && action.kind === 'redirect-chooser' && action.uploadUrl) {
            window.location.href = action.uploadUrl;
            return;
          }
          // "Let the customer choose" — the hosted page at uploadUrl offers
          // all three options (record / photos / schedule a call).
          if (action && action.kind === 'self-survey-or-schedule' && action.uploadUrl) {
            window.location.href = action.uploadUrl;
            return;
          }
          if (action && action.kind === 'schedule-call' && action.schedulerUrl) {
            window.location.href = action.schedulerUrl;
            return;
          }
          if (action && action.kind === 'inline-message') {
            // Replace the form with a simple success message. Movers wanting
            // custom UI should provide an onSuccess handler.
            var msg = document.createElement('div');
            msg.className = 'qs-success-message';
            msg.textContent = action.message || 'Thanks — we received your request.';
            if (form.parentNode) form.parentNode.replaceChild(msg, form);
          }
        })
        .catch(function (err) {
          if (submitBtn) submitBtn.disabled = false;
          console.error('[QubeSheets]', err);
          dispatchEvent('qs:lead-error', { error: err });
          if (config.onError) config.onError(err);
        });
    });
  }

  function init() {
    var config = getConfig();

    if (!config.configId) {
      console.error('[QubeSheets] window.QubeSheets.config.configId is required');
      return;
    }
    if (!config.formSelector) {
      console.error('[QubeSheets] window.QubeSheets.formSelector is required (e.g. "#quote-form")');
      return;
    }

    var form = document.querySelector(config.formSelector);
    if (!form) {
      console.error('[QubeSheets] Form not found for selector', config.formSelector);
      return;
    }
    if (form.tagName !== 'FORM') {
      console.warn('[QubeSheets] formSelector matched a non-FORM element; the plugin will still attempt to attach.');
    }

    attach(form, config);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
