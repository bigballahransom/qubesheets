(function () {
  'use strict';

  var scripts = document.getElementsByTagName('script');
  var currentScript = scripts[scripts.length - 1];
  var orgId = currentScript.getAttribute('data-org-id');
  var containerId = currentScript.getAttribute('data-container') || null;

  // Derive base URL from the script src
  var scriptSrc = currentScript.src || '';
  var baseUrl = scriptSrc.replace(/\/embed-form\.js.*$/, '');

  if (!orgId) {
    console.error('QubeSheets Form: data-org-id attribute is required');
    return;
  }

  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.src = baseUrl + '/form/' + encodeURIComponent(orgId);
  iframe.style.width = '100%';
  iframe.style.minHeight = '500px';
  iframe.style.border = 'none';
  iframe.style.overflow = 'hidden';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');
  iframe.title = 'Contact Form';

  // Handle dynamic height via postMessage
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'qubesheets-form-resize') {
      iframe.style.height = event.data.height + 'px';
    }
  });

  // Insert iframe
  if (containerId) {
    var container = document.getElementById(containerId);
    if (container) {
      container.appendChild(iframe);
    } else {
      console.error('QubeSheets Form: container element "' + containerId + '" not found');
    }
  } else {
    currentScript.parentNode.insertBefore(iframe, currentScript.nextSibling);
  }
})();
