/* Qube Sheets — Lead Submission Plugin
 *
 * Vanilla JS, no framework, no dependencies. Drop this script on a mover's
 * site, point it at one of their existing forms, declare a field mapping,
 * and the plugin will intercept the form's submit event, POST a normalized
 * lead to /api/leads/from-embed/<configId>, and dispatch the configured
 * post-submit action (redirect to the customer-upload chooser OR inline
 * success message).
 *
 * Usage on the host page:
 *
 *   <script>
 *     window.QubeSheets = {
 *       config:        { configId: 'abc123' },
 *       formSelector:  '#quote-form',
 *       mapping: {
 *         'first-name':      { target: 'firstName',     required: true  },
 *         'last-name':       { target: 'lastName',      required: true  },
 *         'email':           { target: 'email',         required: true  },
 *         'phone':           { target: 'phone',         required: true  },
 *         'move-date':       { target: 'moveDate',      required: false },
 *         'origin-full':     { target: 'origin',        required: false },
 *         'destination-full':{ target: 'destination',   required: false },
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

  function buildPayload(form, mapping, defaults) {
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
      var err = new Error('Missing required fields: ' + missing.join(', '));
      err.code = 'QS_MISSING_REQUIRED';
      err.missing = missing;
      throw err;
    }

    // Apply defaults only when the field wasn't already populated.
    Object.keys(defaults).forEach(function (target) {
      if (payload[target] === undefined) payload[target] = defaults[target];
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

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var submitBtn = form.querySelector('[type="submit"]');

      var payload;
      try {
        payload = buildPayload(form, config.mapping, config.defaultValues);
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
