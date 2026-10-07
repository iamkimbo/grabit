// =============================================================
// utils/merge-queue.js
// Merge-queue management: add, remove, reorder, clear.
// Stored in chrome.storage.local under key "merge_queue".
//
// Depends on: utils/storage.js (storageGet / storageSet)
// =============================================================

'use strict';

const MAX_QUEUE_SIZE = 10;

// Returns the full merge queue array from storage.
// Returns Promise<Array>
async function getQueue() {
  const s = await storageGet(['merge_queue']);
  return Array.isArray(s.merge_queue) ? s.merge_queue : [];
}

// Attempts to add a conversation to the merge queue.
// conversation: { title, platform, messages }
// Returns Promise<{ success: bool, reason?: 'full'|'duplicate', count: number }>
async function addToQueue(conversation) {
  const queue = await getQueue();

  if (queue.length >= MAX_QUEUE_SIZE) {
    return { success: false, reason: 'full', count: queue.length };
  }

  const isDuplicate = queue.some(
    item => item.title === conversation.title && item.platform === conversation.platform
  );
  if (isDuplicate) {
    return { success: false, reason: 'duplicate', count: queue.length };
  }

  const item = {
    id:       String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6),
    title:    conversation.title,
    platform: conversation.platform,
    messages: conversation.messages,
    addedAt:  Date.now()
  };

  queue.push(item);
  await storageSet({ merge_queue: queue });
  return { success: true, count: queue.length };
}

// Removes the item with the given id from the queue.
// Returns Promise<number> — new queue length
async function removeFromQueue(id) {
  const queue    = await getQueue();
  const filtered = queue.filter(item => item.id !== id);
  await storageSet({ merge_queue: filtered });
  return filtered.length;
}

// Replaces the queue with a new ordered array (called after drag-to-reorder).
// Returns Promise<void>
async function reorderQueue(newQueue) {
  await storageSet({ merge_queue: newQueue });
}

// Clears the entire merge queue.
// Returns Promise<void>
async function clearQueue() {
  await storageSet({ merge_queue: [] });
}
