// =============================================================
// utils/storage.js
// Promise-based wrappers around chrome.storage.local.
// Loaded before gate.js and popup.js so all scripts can call
// storageGet / storageSet / storageRemove without callback boilerplate.
// =============================================================

'use strict';

// Reads one or more keys from chrome.storage.local.
// keys may be a string, an array of strings, or an object (default values map).
// Returns a Promise that resolves to the result object.
function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, resolve);
  });
}

// Writes items to chrome.storage.local.
// items is a plain object { key: value, ... }.
// Returns a Promise that resolves on success and rejects on error.
function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Removes one or more keys from chrome.storage.local.
// keys may be a string or an array of strings.
// Returns a Promise that resolves on success and rejects on error.
function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}
